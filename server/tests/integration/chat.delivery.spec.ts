import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createChatDeliveryDispatcher, ChatDeliveryDispatcher, MessageDeliveryTier } from '../../src/application/services/chatDeliveryDispatcher';
import { createServiceLogger } from '../../src/infra/monitoring/logger';
import { randomUUID } from 'crypto';

const logger = createServiceLogger('ChatDeliveryIntegrationTest');

describe('Chat Tiered Delivery Integration', () => {
  let chatDispatcher: ChatDeliveryDispatcher;
  const testStartTime = Date.now();
  
  beforeAll(async () => {
    // Initialize chat delivery dispatcher with test configuration
    chatDispatcher = createChatDeliveryDispatcher({
      exactlyOnce: {
        maxRetries: 3,
        timeoutMs: 5000,
        deduplicationWindowMs: 300000,
      },
      atLeastOnce: {
        maxRetries: 5,
        timeoutMs: 3000,
        backoffMultiplier: 1.5,
      },
      bestEffort: {
        timeoutMs: 1000,
        skipOnOverload: false,
      },
    });
    
    logger.info('Chat delivery dispatcher initialized for integration testing');
  });

  afterAll(async () => {
    if (chatDispatcher) {
      logger.info('Chat delivery dispatcher test cleanup complete');
    }
  });

  beforeEach(() => {
    // Reset any test state if needed
  });

  describe('FR-007: Tiered Delivery Semantics', () => {
    it('should handle private messages with exactly-once delivery tier', async () => {
      const testStart = Date.now();
      const senderId = randomUUID();
      const recipientId = randomUUID();
      const messageId = randomUUID();
      const content = `Private test message ${testStart}`;

      logger.info({
        event: 'test_start',
        testCase: 'private_exactly_once',
        metadata: {
          senderId,
          recipientId,
          messageId,
          content,
          testStart,
        },
      }, 'Starting private exactly-once delivery test');

      const message = {
        id: messageId,
        senderId,
        recipientId,
        channelType: 'private' as const,
        content,
        timestamp: new Date(),
        deliveryTier: 'exactly_once' as MessageDeliveryTier,
        metadata: {
          testCase: 'private_exactly_once',
        },
      };

      const deliveryResult = await chatDispatcher.sendMessage(message);
      
      expect(deliveryResult.success).toBe(true);
      expect(deliveryResult.messageId).toBe(messageId);
      expect(deliveryResult.error).toBeUndefined();
      
      // Verify message was processed (check stats)
      const stats = chatDispatcher.getDeliveryStats();
      expect(stats.totalSent).toBeGreaterThan(0);
      expect(stats.byChannel.private).toBeGreaterThan(0);
      expect(stats.byTier.exactly_once.sent).toBeGreaterThan(0);
      
      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'private_exactly_once',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          totalSent: stats.totalSent,
          privateMessages: stats.byChannel.private,
        },
      }, 'Private exactly-once delivery test completed successfully');
    });

    it('should handle guild messages with exactly-once delivery tier', async () => {
      const testStart = Date.now();
      const senderId = randomUUID();
      const guildId = randomUUID();
      const messageId = randomUUID();
      const content = `Guild test message ${testStart}`;

      logger.info({
        event: 'test_start',
        testCase: 'guild_exactly_once',
        metadata: {
          senderId,
          guildId,
          messageId,
          content,
          testStart,
        },
      }, 'Starting guild exactly-once delivery test');

      const message = {
        id: messageId,
        senderId,
        recipientId: guildId, // Guild messages use recipientId for guild targeting
        channelType: 'guild' as const,
        content,
        timestamp: new Date(),
        deliveryTier: 'exactly_once' as MessageDeliveryTier,
        metadata: {
          testCase: 'guild_exactly_once',
        },
      };

      const result = await chatDispatcher.sendMessage(message);
      
      expect(result.success).toBe(true);
      expect(result.messageId).toBe(messageId);
      expect(result.error).toBeUndefined();
      
      // Verify guild channel stats
      const stats = chatDispatcher.getDeliveryStats();
      expect(stats.byChannel.guild).toBeGreaterThan(0);
      expect(stats.byTier.exactly_once.sent).toBeGreaterThan(0);
      
      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'guild_exactly_once',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          guildMessages: stats.byChannel.guild,
        },
      }, 'Guild exactly-once delivery test completed successfully');
    });

    it('should handle guild party messages with exactly-once delivery and duplicate detection', async () => {
      const testStart = Date.now();
      const senderId = randomUUID();
      const guildId = randomUUID(); 
      const messageId = randomUUID();
      const content = `Guild party test message ${testStart}`;

      logger.info({
        event: 'test_start',
        testCase: 'guild_party_exactly_once',
        metadata: {
          senderId,
          guildId,
          messageId,
          content,
          testStart,
        },
      }, 'Starting guild party exactly-once delivery test');

      const message = {
        id: messageId,
        senderId,
        recipientId: guildId, // Guild messages use recipientId
        channelType: 'guild' as const,
        content,
        timestamp: new Date(),
        deliveryTier: 'exactly_once' as MessageDeliveryTier,
        metadata: {
          testCase: 'guild_party_exactly_once',
        },
      };

      const firstResult = await chatDispatcher.sendMessage(message);
      
      expect(firstResult.success).toBe(true);
      expect(firstResult.messageId).toBe(messageId);
      
      // Test duplicate detection for exactly-once semantics
      const duplicateResult = await chatDispatcher.sendMessage(message);
      expect(duplicateResult.success).toBe(false);
      expect(duplicateResult.error).toContain('Duplicate');
      
      const stats = chatDispatcher.getDeliveryStats();
      expect(stats.byChannel.guild).toBeGreaterThan(0);
      
      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'guild_party_exactly_once',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          guildMessages: stats.byChannel.guild,
        },
      }, 'Guild party exactly-once delivery test completed successfully');
    });

    it('should handle arena messages with at-least-once delivery tier', async () => {
      const testStart = Date.now();
      const senderId = randomUUID();
      const arenaId = randomUUID();
      const messageId = randomUUID();
      const content = `Arena test message ${testStart}`;

      logger.info({
        event: 'test_start',
        testCase: 'arena_at_least_once',
        metadata: {
          senderId,
          arenaId,
          messageId,
          content,
          testStart,
        },
      }, 'Starting arena at-least-once delivery test');

      const message = {
        id: messageId,
        senderId,
        recipientId: arenaId, // Arena targeting via recipientId
        channelType: 'arena' as const,
        content,
        timestamp: new Date(),
        deliveryTier: 'at_least_once' as MessageDeliveryTier,
        metadata: {
          testCase: 'arena_at_least_once',
        },
      };

      // Try multiple times to handle the probabilistic nature of the service (90% success rate)
      let firstResult;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        firstResult = await chatDispatcher.sendMessage(message);
        if (firstResult.success) break;
        attempts++;
        
        // Use a different message ID for retry to avoid any potential caching
        message.id = randomUUID();
      }
      
      expect(firstResult).toBeDefined();
      expect(firstResult!.success).toBe(true);
      expect(firstResult!.messageId).toBe(message.id);
      
      // For at-least-once, duplicate messages should be allowed 
      // Try sending a different message to test the semantics
      const secondMessage = {
        ...message,
        id: randomUUID(), // Different ID
        content: `Arena second message ${testStart}`,
      };
      
      let secondResult;
      attempts = 0;
      while (attempts < maxAttempts) {
        secondResult = await chatDispatcher.sendMessage(secondMessage);
        if (secondResult.success) break;
        attempts++;
        secondMessage.id = randomUUID();
      }
      
      expect(secondResult).toBeDefined();
      expect(secondResult!.success).toBe(true);
      
      const stats = chatDispatcher.getDeliveryStats();
      expect(stats.byChannel.arena).toBeGreaterThanOrEqual(2);
      expect(stats.byTier.at_least_once.sent).toBeGreaterThanOrEqual(2);
      
      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'arena_at_least_once',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          arenaMessages: stats.byChannel.arena,
          totalAtLeastOnce: stats.byTier.at_least_once.sent,
          attemptsNeeded: attempts,
        },
      }, 'Arena at-least-once delivery test completed successfully');
    });

    it('should handle global messages with at-least-once delivery tier', async () => {
      const testStart = Date.now();
      const senderId = randomUUID(); // Use UUID instead of 'SYSTEM'
      const messageId = randomUUID();
      const content = `Global broadcast ${testStart}`;

      logger.info({
        event: 'test_start',
        testCase: 'global_at_least_once',
        metadata: {
          senderId,
          messageId,
          content,
          testStart,
        },
      }, 'Starting global at-least-once delivery test');

      const message = {
        id: messageId,
        senderId,
        channelType: 'global' as const,
        content,
        timestamp: new Date(),
        deliveryTier: 'at_least_once' as MessageDeliveryTier,
        metadata: {
          testCase: 'global_at_least_once',
        },
      };

      // Try multiple times to handle the probabilistic nature of the service (90% success rate)
      let deliveryResult;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        deliveryResult = await chatDispatcher.sendMessage(message);
        if (deliveryResult.success) break;
        attempts++;
        
        // Use a different message ID for retry
        message.id = randomUUID();
      }
      
      expect(deliveryResult).toBeDefined();
      expect(deliveryResult!.success).toBe(true);
      expect(deliveryResult!.messageId).toBe(message.id);
      
      const stats = chatDispatcher.getDeliveryStats();
      expect(stats.byChannel.global).toBeGreaterThan(0);
      expect(stats.byTier.at_least_once.sent).toBeGreaterThan(0);
      
      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'global_at_least_once',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          globalMessages: stats.byChannel.global,
          attemptsNeeded: attempts,
        },
      }, 'Global at-least-once delivery test completed successfully');
    });

    it('should handle concurrent message delivery correctly', async () => {
      const testStart = Date.now();
      const senderId = randomUUID();
      const messageCount = 5;
      
      logger.info({
        event: 'test_start',
        testCase: 'concurrent_delivery',
        metadata: {
          senderId,
          messageCount,
          testStart,
        },
      }, 'Starting concurrent delivery test');

      const messages = Array.from({ length: messageCount }, (_, i) => ({
        id: randomUUID(),
        senderId,
        recipientId: randomUUID(),
        channelType: 'private' as const,
        content: `Concurrent message ${i + 1}`,
        timestamp: new Date(),
        deliveryTier: 'exactly_once' as MessageDeliveryTier,
        metadata: {
          testCase: 'concurrent_delivery',
          messageIndex: i,
        },
      }));

      const results = await Promise.all(
        messages.map(message => chatDispatcher.sendMessage(message))
      );

      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.messageId).toBe(messages[index].id);
        expect(result.error).toBeUndefined();
      });
      
      const stats = chatDispatcher.getDeliveryStats();
      expect(stats.byChannel.private).toBeGreaterThanOrEqual(messageCount);
      
      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'concurrent_delivery',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          successCount: results.filter(r => r.success).length,
          totalMessages: messageCount,
        },
      }, 'Concurrent delivery test completed successfully');
    });

    it('should maintain separate statistics for different channel types', async () => {
      const testStart = Date.now();
      const senderId = randomUUID();
      
      // Create messages for different channel types
      const privateMessage = {
        id: randomUUID(),
        senderId,
        recipientId: randomUUID(),
        channelType: 'private' as const,
        content: 'Private stats test',
        timestamp: new Date(),
        deliveryTier: 'exactly_once' as MessageDeliveryTier,
      };
      
      const arenaMessage = {
        id: randomUUID(),
        senderId,
        recipientId: randomUUID(),
        channelType: 'arena' as const,
        content: 'Arena stats test',
        timestamp: new Date(),
        deliveryTier: 'at_least_once' as MessageDeliveryTier,
      };
      
      const globalMessage = {
        id: randomUUID(),
        senderId: randomUUID(), // Use UUID instead of 'SYSTEM'
        channelType: 'global' as const,
        content: 'Global stats test',
        timestamp: new Date(),
        deliveryTier: 'at_least_once' as MessageDeliveryTier,
      };

      // Send messages to different channels with retry logic for probabilistic success
      const maxAttempts = 3;
      
      // Send private message (95% success rate, should work reliably)
      let privateResult = await chatDispatcher.sendMessage(privateMessage);
      expect(privateResult.success).toBe(true);
      
      // Send arena message with retries (90% success rate)
      let arenaResult;
      for (let i = 0; i < maxAttempts; i++) {
        arenaResult = await chatDispatcher.sendMessage({...arenaMessage, id: randomUUID()});
        if (arenaResult.success) break;
      }
      expect(arenaResult!.success).toBe(true);
      
      // Send global message with retries (90% success rate)
      let globalResult;
      for (let i = 0; i < maxAttempts; i++) {
        globalResult = await chatDispatcher.sendMessage({...globalMessage, id: randomUUID()});
        if (globalResult.success) break;
      }
      expect(globalResult!.success).toBe(true);
      
      const stats = chatDispatcher.getDeliveryStats();
      
      // Verify separate channel statistics - at least one message per channel
      expect(stats.byChannel.private).toBeGreaterThan(0);
      expect(stats.byChannel.arena).toBeGreaterThan(0);
      expect(stats.byChannel.global).toBeGreaterThan(0);
      
      // Verify delivery tier statistics
      expect(stats.byTier.exactly_once.sent).toBeGreaterThan(0);
      expect(stats.byTier.at_least_once.sent).toBeGreaterThanOrEqual(2);
      
      const processingTime = Date.now() - testStart;
      
      logger.info({
        event: 'test_complete',
        testCase: 'channel_statistics',
        processingTimeMs: processingTime,
        outcome: 'success',
        metadata: {
          privateMessages: stats.byChannel.private,
          arenaMessages: stats.byChannel.arena,
          globalMessages: stats.byChannel.global,
          exactlyOnce: stats.byTier.exactly_once.sent,
          atLeastOnce: stats.byTier.at_least_once.sent,
        },
      }, 'Channel statistics test completed successfully');
    });
  });
});