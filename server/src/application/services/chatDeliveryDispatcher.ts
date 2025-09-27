import { z } from 'zod';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { recordChatMessage, chatMessagesTotal } from '../../infra/monitoring/metrics';
import { BlockListMiddleware, BlockCheckResult } from '../middleware/blockList';

// Chat delivery schemas
export const MessageDeliveryTierSchema = z.enum(['exactly_once', 'at_least_once', 'best_effort']);

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  senderId: z.string().uuid(),
  recipientId: z.string().uuid().optional(), // Undefined for broadcast
  channelType: z.enum(['private', 'arena', 'global', 'guild']),
  content: z.string().min(1).max(1000),
  timestamp: z.date(),
  deliveryTier: MessageDeliveryTierSchema,
  metadata: z.record(z.string(), z.any()).optional(),
});

export const DeliveryReceiptSchema = z.object({
  messageId: z.string().uuid(),
  recipientId: z.string().uuid(),
  status: z.enum(['delivered', 'failed', 'pending']),
  timestamp: z.date(),
  attempts: z.number().int().min(0).default(0),
  lastError: z.string().optional(),
});

export const DeliveryGuaranteeConfigSchema = z.object({
  exactlyOnce: z.object({
    maxRetries: z.number().int().min(0).default(3),
    timeoutMs: z.number().int().min(1000).default(10000),
    deduplicationWindowMs: z.number().int().min(60000).default(300000), // 5 minutes
  }),
  atLeastOnce: z.object({
    maxRetries: z.number().int().min(1).default(5),
    timeoutMs: z.number().int().min(500).default(5000),
    backoffMultiplier: z.number().min(1).default(1.5),
  }),
  bestEffort: z.object({
    timeoutMs: z.number().int().min(100).default(1000),
    skipOnOverload: z.boolean().default(true),
  }),
});

export type MessageDeliveryTier = z.infer<typeof MessageDeliveryTierSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;
export type DeliveryGuaranteeConfig = z.infer<typeof DeliveryGuaranteeConfigSchema>;

export interface MessageDeliveryStats {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  averageLatencyMs: number;
  byTier: {
    exactly_once: { sent: number; delivered: number; failed: number };
    at_least_once: { sent: number; delivered: number; failed: number };
    best_effort: { sent: number; delivered: number; failed: number };
  };
  byChannel: {
    private: number;
    arena: number;
    global: number;
    guild: number;
  };
}

/**
 * Chat delivery dispatcher implementing FR-007
 * Handles chat message delivery with tiered guarantees
 */
export class ChatDeliveryDispatcher {
  private readonly serviceLogger = createServiceLogger('ChatDeliveryDispatcher');

  // In-memory tracking (would be Redis in production)
  private readonly pendingMessages = new Map<string, ChatMessage>();
  private readonly deliveryReceipts = new Map<string, DeliveryReceipt[]>();
  private readonly deduplicationCache = new Set<string>(); // For exactly-once delivery
  private readonly retryQueue = new Map<string, { message: ChatMessage; attempt: number; nextRetry: Date }>();

  // Performance tracking
  private readonly deliveryStats: MessageDeliveryStats = {
    totalSent: 0,
    totalDelivered: 0,
    totalFailed: 0,
    averageLatencyMs: 0,
    byTier: {
      exactly_once: { sent: 0, delivered: 0, failed: 0 },
      at_least_once: { sent: 0, delivered: 0, failed: 0 },
      best_effort: { sent: 0, delivered: 0, failed: 0 },
    },
    byChannel: {
      private: 0,
      arena: 0,
      global: 0,
      guild: 0,
    },
  };

  constructor(
    private readonly config: DeliveryGuaranteeConfig = DeliveryGuaranteeConfigSchema.parse({}),
    private readonly blockListMiddleware?: BlockListMiddleware
  ) {
    // Start background retry processor
    this.startRetryProcessor();
    // Start deduplication cache cleanup
    this.startDeduplicationCleanup();
  }

  /**
   * Send a chat message with the specified delivery tier
   */
  async sendMessage(message: ChatMessage): Promise<{ success: boolean; messageId: string; error?: string }> {
    try {
      // Validate message
      const validMessage = ChatMessageSchema.parse(message);
      
      this.serviceLogger.debug({
        event: 'message_send_started',
        messageId: validMessage.id,
        senderId: validMessage.senderId,
        channelType: validMessage.channelType,
        deliveryTier: validMessage.deliveryTier,
        recipientId: validMessage.recipientId,
      }, `Sending message ${validMessage.id}`);

      // Check block list for private messages
      if (validMessage.recipientId && this.blockListMiddleware) {
        const blockCheck: BlockCheckResult = await this.blockListMiddleware.checkBlock(
          validMessage.senderId,
          validMessage.recipientId
        );
        
        if (blockCheck.blocked) {
          this.serviceLogger.warn({
            event: 'message_blocked',
            messageId: validMessage.id,
            senderId: validMessage.senderId,
            recipientId: validMessage.recipientId,
            reason: blockCheck.reason,
            blockedBy: blockCheck.blockedBy,
          }, `Message blocked: ${blockCheck.reason || 'User blocked'}`);
          
          return { 
            success: false, 
            messageId: validMessage.id, 
            error: 'Message blocked by recipient' 
          };
        }
      }

      // Check for duplicates in exactly-once tier
      if (validMessage.deliveryTier === 'exactly_once') {
        const deduplicationKey = `${validMessage.senderId}-${validMessage.content}-${validMessage.timestamp.getTime()}`;
        if (this.deduplicationCache.has(deduplicationKey)) {
          this.serviceLogger.warn({
            event: 'duplicate_message_rejected',
            messageId: validMessage.id,
            senderId: validMessage.senderId,
          }, 'Duplicate message rejected');
          
          return { success: false, messageId: validMessage.id, error: 'Duplicate message' };
        }
        this.deduplicationCache.add(deduplicationKey);
      }

      // Store message as pending
      this.pendingMessages.set(validMessage.id, validMessage);

      // Update stats
      this.deliveryStats.totalSent++;
      this.deliveryStats.byTier[validMessage.deliveryTier].sent++;
      this.deliveryStats.byChannel[validMessage.channelType]++;

      // Update metrics (handle best_effort separately)
      if (validMessage.deliveryTier !== 'best_effort') {
        recordChatMessage(validMessage.channelType, validMessage.deliveryTier);
      }
      chatMessagesTotal.inc({ 
        channel_type: validMessage.channelType, 
        delivery_tier: validMessage.deliveryTier 
      });

      // Dispatch based on delivery tier
      const result = await this.dispatchMessage(validMessage);

      if (result.success) {
        this.deliveryStats.totalDelivered++;
        this.deliveryStats.byTier[validMessage.deliveryTier].delivered++;
        this.pendingMessages.delete(validMessage.id);
      } else {
        // Add to retry queue if appropriate
        await this.handleDeliveryFailure(validMessage, result.error || 'Unknown error');
      }

      return { ...result, messageId: validMessage.id };

    } catch (error) {
      this.serviceLogger.error({
        event: 'message_send_error',
        messageId: message.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to send message');

      return { 
        success: false, 
        messageId: message.id, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Get delivery status for a message
   */
  async getDeliveryStatus(messageId: string): Promise<DeliveryReceipt[]> {
    return this.deliveryReceipts.get(messageId) || [];
  }

  /**
   * Acknowledge message delivery
   */
  async acknowledgeDelivery(messageId: string, recipientId: string): Promise<boolean> {
    try {
      const receipts = this.deliveryReceipts.get(messageId) || [];
      const receipt = receipts.find(r => r.recipientId === recipientId);

      if (receipt) {
        receipt.status = 'delivered';
        receipt.timestamp = new Date();
        
        this.serviceLogger.debug({
          event: 'delivery_acknowledged',
          messageId,
          recipientId,
        }, `Delivery acknowledged for message ${messageId}`);

        return true;
      }

      return false;

    } catch (error) {
      this.serviceLogger.error({
        event: 'acknowledge_delivery_error',
        messageId,
        recipientId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to acknowledge delivery');
      
      return false;
    }
  }

  /**
   * Get current delivery statistics
   */
  getDeliveryStats(): MessageDeliveryStats {
    return { ...this.deliveryStats };
  }

  /**
   * Get pending messages count
   */
  getPendingMessagesCount(): number {
    return this.pendingMessages.size;
  }

  /**
   * Get retry queue status
   */
  getRetryQueueStatus(): { 
    pendingRetries: number; 
    nextRetryTime: Date | null; 
    byTier: Record<MessageDeliveryTier, number> 
  } {
    const retries = Array.from(this.retryQueue.values());
    const nextRetry = retries.length > 0 
      ? new Date(Math.min(...retries.map(r => r.nextRetry.getTime())))
      : null;

    const byTier: Record<MessageDeliveryTier, number> = {
      exactly_once: 0,
      at_least_once: 0,
      best_effort: 0,
    };

    for (const retry of retries) {
      byTier[retry.message.deliveryTier]++;
    }

    return {
      pendingRetries: retries.length,
      nextRetryTime: nextRetry,
      byTier,
    };
  }

  /**
   * Cleanup old tracking data
   */
  async cleanup(): Promise<void> {
    try {
      const now = Date.now();
      const oldMessageThreshold = now - (24 * 60 * 60 * 1000); // 24 hours

      // Clean up old delivery receipts
      let cleanedReceipts = 0;
      for (const [messageId, receipts] of this.deliveryReceipts.entries()) {
        const validReceipts = receipts.filter(r => r.timestamp.getTime() > oldMessageThreshold);
        if (validReceipts.length !== receipts.length) {
          if (validReceipts.length === 0) {
            this.deliveryReceipts.delete(messageId);
          } else {
            this.deliveryReceipts.set(messageId, validReceipts);
          }
          cleanedReceipts++;
        }
      }

      // Clean up old pending messages
      let cleanedPending = 0;
      for (const [messageId, message] of this.pendingMessages.entries()) {
        if (message.timestamp.getTime() < oldMessageThreshold) {
          this.pendingMessages.delete(messageId);
          cleanedPending++;
        }
      }

      this.serviceLogger.debug({
        event: 'cleanup_completed',
        cleanedReceipts,
        cleanedPending,
        remainingReceipts: this.deliveryReceipts.size,
        remainingPending: this.pendingMessages.size,
      }, 'Cleanup completed');

    } catch (error) {
      this.serviceLogger.error({
        event: 'cleanup_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Cleanup failed');
    }
  }

  // Private helper methods

  private async dispatchMessage(message: ChatMessage): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();

    try {
      // Simulate message delivery based on tier
      const deliveryResult = await this.executeDelivery(message);
      
      const latency = Date.now() - startTime;
      this.updateAverageLatency(latency);

      if (deliveryResult.success) {
        // Create delivery receipt(s)
        await this.createDeliveryReceipts(message, 'delivered');
      }

      return deliveryResult;

    } catch (error) {
      const latency = Date.now() - startTime;
      this.updateAverageLatency(latency);

      this.serviceLogger.error({
        event: 'message_dispatch_error',
        messageId: message.id,
        deliveryTier: message.deliveryTier,
        latency,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Message dispatch failed: ${message.id}`);

      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async executeDelivery(message: ChatMessage): Promise<{ success: boolean; error?: string }> {
    // Get timeout based on delivery tier
    let timeout: number;
    switch (message.deliveryTier) {
      case 'exactly_once':
        timeout = this.config.exactlyOnce.timeoutMs;
        break;
      case 'at_least_once':
        timeout = this.config.atLeastOnce.timeoutMs;
        break;
      case 'best_effort':
        timeout = this.config.bestEffort.timeoutMs;
        break;
    }

    // Simulate network delivery with different reliability by tier
    return new Promise((resolve) => {
      setTimeout(() => {
        // Simulate different success rates by tier
        let successRate: number;
        switch (message.deliveryTier) {
          case 'exactly_once':
            successRate = 0.95; // 95% success rate
            break;
          case 'at_least_once':
            successRate = 0.90; // 90% success rate  
            break;
          case 'best_effort':
            successRate = 0.80; // 80% success rate
            break;
        }

        const success = Math.random() < successRate;
        
        if (success) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `Network delivery failed (tier: ${message.deliveryTier})` });
        }
      }, Math.random() * timeout / 2); // Random delivery time up to half the timeout
    });
  }

  private async createDeliveryReceipts(message: ChatMessage, status: 'delivered' | 'failed' | 'pending'): Promise<void> {
    const receipts: DeliveryReceipt[] = [];

    if (message.recipientId) {
      // Direct message - single recipient
      receipts.push({
        messageId: message.id,
        recipientId: message.recipientId,
        status,
        timestamp: new Date(),
        attempts: 1,
      });
    } else {
      // Broadcast message - create receipts for all recipients in channel
      // TODO: Get actual recipient list from channel membership
      // For now, create dummy receipts for simulation
      const simulatedRecipientCount = this.getSimulatedRecipientCount(message.channelType);
      
      for (let i = 0; i < simulatedRecipientCount; i++) {
        receipts.push({
          messageId: message.id,
          recipientId: `recipient-${i}`, // Would be actual player IDs
          status,
          timestamp: new Date(),
          attempts: 1,
        });
      }
    }

    this.deliveryReceipts.set(message.id, receipts);
  }

  private getSimulatedRecipientCount(channelType: string): number {
    // Simulate different audience sizes by channel type
    switch (channelType) {
      case 'private':
        return 1;
      case 'arena':
        return Math.floor(Math.random() * 20) + 5; // 5-25 players
      case 'guild':
        return Math.floor(Math.random() * 50) + 10; // 10-60 players
      case 'global':
        return Math.floor(Math.random() * 200) + 50; // 50-250 players
      default:
        return 1;
    }
  }

  private async handleDeliveryFailure(message: ChatMessage, error: string): Promise<void> {
    // Determine if we should retry based on delivery tier
    let shouldRetry = false;
    let maxRetries = 0;

    switch (message.deliveryTier) {
      case 'exactly_once':
        maxRetries = this.config.exactlyOnce.maxRetries;
        shouldRetry = true;
        break;
      case 'at_least_once':
        maxRetries = this.config.atLeastOnce.maxRetries;
        shouldRetry = true;
        break;
      case 'best_effort':
        shouldRetry = false; // No retries for best effort
        break;
    }

    if (shouldRetry && maxRetries > 0) {
      const currentAttempt = (this.retryQueue.get(message.id)?.attempt || 0) + 1;
      
      if (currentAttempt <= maxRetries) {
        // Calculate next retry time with exponential backoff
        let backoffMs: number;
        if (message.deliveryTier === 'at_least_once') {
          const atLeastOnceConfig = this.config.atLeastOnce;
          backoffMs = atLeastOnceConfig.timeoutMs * Math.pow(atLeastOnceConfig.backoffMultiplier, currentAttempt - 1);
        } else {
          // exactly_once tier
          backoffMs = this.config.exactlyOnce.timeoutMs;
        }

        const nextRetry = new Date(Date.now() + backoffMs);

        this.retryQueue.set(message.id, {
          message,
          attempt: currentAttempt,
          nextRetry,
        });

        this.serviceLogger.warn({
          event: 'message_queued_for_retry',
          messageId: message.id,
          attempt: currentAttempt,
          maxRetries,
          nextRetryTime: nextRetry,
          error,
        }, `Message queued for retry: ${message.id} (attempt ${currentAttempt}/${maxRetries})`);
      } else {
        // Max retries exceeded
        this.deliveryStats.totalFailed++;
        this.deliveryStats.byTier[message.deliveryTier].failed++;
        
        await this.createDeliveryReceipts(message, 'failed');
        
        this.serviceLogger.error({
          event: 'message_delivery_failed',
          messageId: message.id,
          attempts: currentAttempt,
          finalError: error,
        }, `Message delivery failed after ${currentAttempt} attempts: ${message.id}`);
      }
    } else {
      // No retries - mark as failed
      this.deliveryStats.totalFailed++;
      this.deliveryStats.byTier[message.deliveryTier].failed++;
      
      await this.createDeliveryReceipts(message, 'failed');
    }
  }

  private updateAverageLatency(latencyMs: number): void {
    // Simple moving average approximation
    const alpha = 0.1; // Weight for new sample
    this.deliveryStats.averageLatencyMs = this.deliveryStats.averageLatencyMs === 0
      ? latencyMs
      : this.deliveryStats.averageLatencyMs * (1 - alpha) + latencyMs * alpha;
  }

  private startRetryProcessor(): void {
    // Process retry queue every 5 seconds
    setInterval(async () => {
      await this.processRetryQueue();
    }, 5000);
  }

  private async processRetryQueue(): Promise<void> {
    const now = new Date();
    const retryList: Array<{ messageId: string; retry: { message: ChatMessage; attempt: number; nextRetry: Date } }> = [];

    // Find messages ready for retry
    for (const [messageId, retry] of this.retryQueue.entries()) {
      if (retry.nextRetry <= now) {
        retryList.push({ messageId, retry });
      }
    }

    // Process retries
    for (const { messageId, retry } of retryList) {
      this.retryQueue.delete(messageId);
      
      this.serviceLogger.debug({
        event: 'retrying_message_delivery',
        messageId,
        attempt: retry.attempt,
      }, `Retrying message delivery: ${messageId}`);

      // Retry the delivery
      const result = await this.dispatchMessage(retry.message);
      
      if (result.success) {
        this.deliveryStats.totalDelivered++;
        this.deliveryStats.byTier[retry.message.deliveryTier].delivered++;
        this.pendingMessages.delete(messageId);
      } else {
        // Handle retry failure
        await this.handleDeliveryFailure(retry.message, result.error || 'Retry failed');
      }
    }
  }

  private startDeduplicationCleanup(): void {
    // Clean up deduplication cache every 10 minutes
    setInterval(() => {
      // For now, just clear the cache periodically
      // In production, would implement time-based expiry
      if (this.deduplicationCache.size > 10000) {
        this.deduplicationCache.clear();
        this.serviceLogger.debug({
          event: 'deduplication_cache_cleared',
        }, 'Deduplication cache cleared due to size limit');
      }
    }, 10 * 60 * 1000); // 10 minutes
  }
}

// Factory function
export function createChatDeliveryDispatcher(config?: Partial<DeliveryGuaranteeConfig>): ChatDeliveryDispatcher {
  const fullConfig = DeliveryGuaranteeConfigSchema.parse(config || {});
  return new ChatDeliveryDispatcher(fullConfig);
}