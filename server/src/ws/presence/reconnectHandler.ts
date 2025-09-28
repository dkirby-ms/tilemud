/**
 * WebSocket reconnection token handling
 * Integrates with session service for graceful reconnection
 */

import WebSocket from 'ws';
import { logger } from '../../infra/monitoring/logger';
import { SessionService } from '../../application/services/session/sessionService';

export interface ReconnectHandlerConfig {
  tokenValiditySeconds: number;  // Default: 300 (5 minutes)
  maxReconnectAttempts: number; // Default: 3
  backoffMultiplier: number;    // Default: 2
}

export interface ReconnectionContext {
  ws: WebSocket;
  reconnectionToken: string;
  instanceId: string;
  characterId?: string;
  attemptNumber: number;
  originalConnectionTime: number;
}

export interface ReconnectionResult {
  success: boolean;
  sessionId?: string;
  reason?: string;
  retryAfterMs?: number;
}

const DEFAULT_CONFIG: ReconnectHandlerConfig = {
  tokenValiditySeconds: 300,    // 5 minutes
  maxReconnectAttempts: 3,
  backoffMultiplier: 2
};

export class ReconnectHandler {
  private sessionService: SessionService;
  private config: ReconnectHandlerConfig;

  constructor(sessionService: SessionService, config: Partial<ReconnectHandlerConfig> = {}) {
    this.sessionService = sessionService;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Handle WebSocket reconnection attempt using token
   */
  async handleReconnection(context: ReconnectionContext): Promise<ReconnectionResult> {
    const startTime = Date.now();
    
    try {
      logger.info({
        event: 'websocket_reconnection_attempt',
        reconnectionToken: context.reconnectionToken,
        instanceId: context.instanceId,
        attemptNumber: context.attemptNumber,
        originalConnectionTime: context.originalConnectionTime
      }, 'Processing WebSocket reconnection attempt');

      // Validate attempt limits
      if (context.attemptNumber > this.config.maxReconnectAttempts) {
        logger.warn({
          event: 'websocket_reconnection_limit_exceeded',
          reconnectionToken: context.reconnectionToken,
          attemptNumber: context.attemptNumber,
          maxAttempts: this.config.maxReconnectAttempts
        }, 'Reconnection attempt limit exceeded');

        return {
          success: false,
          reason: 'MAX_ATTEMPTS_EXCEEDED'
        };
      }

      // Validate token age
      const tokenAge = Date.now() - context.originalConnectionTime;
      const maxTokenAge = this.config.tokenValiditySeconds * 1000;
      
      if (tokenAge > maxTokenAge) {
        logger.warn({
          event: 'websocket_reconnection_token_expired',
          reconnectionToken: context.reconnectionToken,
          tokenAgeMs: tokenAge,
          maxTokenAgeMs: maxTokenAge
        }, 'Reconnection token expired');

        return {
          success: false,
          reason: 'TOKEN_EXPIRED'
        };
      }

      // Attempt reconnection with session service
      const reconnectionResult = await this.sessionService.reconnectWithToken(
        context.reconnectionToken
      );

      if (reconnectionResult.success && reconnectionResult.session) {
        // Successful reconnection
        logger.info({
          event: 'websocket_reconnection_success',
          sessionId: reconnectionResult.session.sessionId,
          characterId: reconnectionResult.session.characterId,
          instanceId: context.instanceId,
          attemptNumber: context.attemptNumber,
          processingTimeMs: Date.now() - startTime
        }, 'WebSocket reconnection successful');

        // Set up WebSocket context
        this.setupWebSocketSession(context.ws, reconnectionResult.session);

        return {
          success: true,
          sessionId: reconnectionResult.session.sessionId
        };

      } else {
        // Failed reconnection
        const retryDelay = this.calculateBackoffDelay(context.attemptNumber);
        
        logger.warn({
          event: 'websocket_reconnection_failed',
          reconnectionToken: context.reconnectionToken,
          attemptNumber: context.attemptNumber,
          retryAfterMs: retryDelay,
          reason: 'SESSION_RECONNECT_FAILED'
        }, 'WebSocket reconnection failed');

        return {
          success: false,
          reason: 'SESSION_RECONNECT_FAILED',
          retryAfterMs: retryDelay
        };
      }

    } catch (error) {
      const retryDelay = this.calculateBackoffDelay(context.attemptNumber);
      
      logger.error({
        event: 'websocket_reconnection_error',
        reconnectionToken: context.reconnectionToken,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        attemptNumber: context.attemptNumber,
        processingTimeMs: Date.now() - startTime
      }, 'WebSocket reconnection error');

      return {
        success: false,
        reason: 'INTERNAL_ERROR',
        retryAfterMs: retryDelay
      };
    }
  }

  /**
   * Parse reconnection token from WebSocket handshake
   */
  parseReconnectionToken(url: string): string | null {
    try {
      const urlObj = new URL(url, 'http://localhost');
      return urlObj.searchParams.get('reconnectionToken');
    } catch {
      return null;
    }
  }

  /**
   * Validate WebSocket reconnection parameters
   */
  validateReconnectionRequest(
    instanceId: string,
    reconnectionToken: string
  ): { valid: boolean; error?: string } {
    if (!instanceId) {
      return { valid: false, error: 'Instance ID required' };
    }

    if (!reconnectionToken) {
      return { valid: false, error: 'Reconnection token required' };
    }

    // Basic token format validation (UUID-like)
    const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!tokenPattern.test(reconnectionToken)) {
      return { valid: false, error: 'Invalid reconnection token format' };
    }

    return { valid: true };
  }

  /**
   * Set up WebSocket with session context after successful reconnection
   */
  private setupWebSocketSession(ws: WebSocket, session: any): void {
    // Set session context on WebSocket
    (ws as any).sessionId = session.sessionId;
    (ws as any).characterId = session.characterId;
    (ws as any).instanceId = session.instanceId;
    (ws as any).reconnected = true;
    (ws as any).reconnectedAt = Date.now();

    // Send reconnection confirmation
    ws.send(JSON.stringify({
      type: 'reconnection_success',
      sessionId: session.sessionId,
      characterId: session.characterId,
      timestamp: Date.now()
    }));

    logger.info({
      event: 'websocket_session_established',
      sessionId: session.sessionId,
      characterId: session.characterId,
      reconnected: true
    }, 'WebSocket session context established after reconnection');
  }

  /**
   * Calculate exponential backoff delay for retry attempts
   */
  private calculateBackoffDelay(attemptNumber: number): number {
    const baseDelay = 1000; // 1 second
    return Math.min(
      baseDelay * Math.pow(this.config.backoffMultiplier, attemptNumber - 1),
      30000 // Max 30 seconds
    );
  }

  /**
   * Get reconnection handler statistics
   */
  getStatistics(): {
    config: ReconnectHandlerConfig;
    uptime: number;
  } {
    return {
      config: this.config,
      uptime: process.uptime() * 1000
    };
  }
}

/**
 * Factory function to create reconnect handler
 */
export function createReconnectHandler(
  sessionService: SessionService,
  config?: Partial<ReconnectHandlerConfig>
): ReconnectHandler {
  return new ReconnectHandler(sessionService, config);
}