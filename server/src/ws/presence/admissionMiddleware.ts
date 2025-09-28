/**
 * WebSocket middleware for handling admission system integration
 * Connects HTTP admission flow with WebSocket connections
 */

import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { logger } from '../../infra/monitoring/logger';
import { SessionService } from '../../application/services/session/sessionService';
import { ReconnectHandler } from './reconnectHandler';

export interface WebSocketAdmissionConfig {
  enableReconnection: boolean;
  sessionTimeoutMs: number;
  heartbeatIntervalMs: number;
}

export interface WebSocketSession {
  sessionId: string;
  characterId?: string;
  instanceId: string;
  connectedAt: number;
  lastActivity: number;
  reconnected: boolean;
}

const DEFAULT_CONFIG: WebSocketAdmissionConfig = {
  enableReconnection: true,
  sessionTimeoutMs: 300000, // 5 minutes
  heartbeatIntervalMs: 30000 // 30 seconds
};

export class WebSocketAdmissionMiddleware {
  private sessionService: SessionService;
  private reconnectHandler: ReconnectHandler;
  private config: WebSocketAdmissionConfig;
  private activeSessions = new Map<string, WebSocketSession>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    sessionService: SessionService,
    config: Partial<WebSocketAdmissionConfig> = {}
  ) {
    this.sessionService = sessionService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reconnectHandler = new ReconnectHandler(sessionService);
    
    // Start heartbeat monitoring
    this.startHeartbeatMonitoring();
  }

  /**
   * Handle new WebSocket connection with admission validation
   */
  async handleConnection(
    ws: WebSocket,
    req: IncomingMessage
  ): Promise<{ success: boolean; reason?: string }> {
    const startTime = Date.now();
    
    try {
      const url = req.url || '';
      const sessionId = this.extractSessionId(url);
      const reconnectionToken = this.reconnectHandler.parseReconnectionToken(url);

      // Handle reconnection attempts
      if (reconnectionToken) {
        return await this.handleReconnection(ws, req, reconnectionToken);
      }

      // Handle new connections with session validation
      if (!sessionId) {
        logger.warn({
          event: 'websocket_connection_rejected',
          reason: 'MISSING_SESSION_ID',
          url: req.url
        }, 'WebSocket connection rejected - no session ID');
        
        return { success: false, reason: 'MISSING_SESSION_ID' };
      }

      // Validate session exists and is active
      const session = await this.sessionService.getSession(sessionId);
      if (!session) {
        logger.warn({
          event: 'websocket_connection_rejected',
          sessionId,
          reason: 'SESSION_NOT_FOUND'
        }, 'WebSocket connection rejected - session not found');
        
        return { success: false, reason: 'SESSION_NOT_FOUND' };
      }

      // Set up WebSocket session context

      const wsSession: WebSocketSession = {
        sessionId: session.sessionId,
        characterId: session.characterId,
        instanceId: session.instanceId,
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        reconnected: false
      };

      // Store session context on WebSocket and in active sessions
      this.setupWebSocketSession(ws, wsSession);
      this.activeSessions.set(sessionId, wsSession);

      // Set up event handlers
      this.setupWebSocketHandlers(ws, wsSession);

      logger.info({
        event: 'websocket_connection_established',
        sessionId,
        characterId: session.characterId,
        instanceId: session.instanceId,
        processingTimeMs: Date.now() - startTime
      }, 'WebSocket connection established');

      return { success: true };

    } catch (error) {
      logger.error({
        event: 'websocket_connection_error',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs: Date.now() - startTime
      }, 'WebSocket connection setup error');

      return { success: false, reason: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Handle WebSocket reconnection attempts
   */
  private async handleReconnection(
    ws: WebSocket,
    req: IncomingMessage,
    reconnectionToken: string
  ): Promise<{ success: boolean; reason?: string }> {
    const instanceId = this.extractInstanceId(req.url || '');
    
    if (!instanceId) {
      return { success: false, reason: 'MISSING_INSTANCE_ID' };
    }

    const validation = this.reconnectHandler.validateReconnectionRequest(instanceId, reconnectionToken);
    if (!validation.valid) {
      return { 
        success: false, 
        reason: validation.error || 'VALIDATION_FAILED'
      };
    }

    const reconnectionResult = await this.reconnectHandler.handleReconnection({
      ws,
      reconnectionToken,
      instanceId,
      attemptNumber: 1, // TODO: Track attempt numbers properly
      originalConnectionTime: Date.now() - 300000 // TODO: Get actual original time
    });

    if (reconnectionResult.success && reconnectionResult.sessionId) {
      // Add to active sessions
      const wsSession: WebSocketSession = {
        sessionId: reconnectionResult.sessionId,
        instanceId,
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        reconnected: true
      };

      this.activeSessions.set(reconnectionResult.sessionId, wsSession);
      this.setupWebSocketHandlers(ws, wsSession);

      return { success: true };
    }

    return { 
      success: false, 
      reason: reconnectionResult.reason || 'RECONNECTION_FAILED'
    };
  }

  /**
   * Set up WebSocket session context and metadata
   */
  private setupWebSocketSession(ws: WebSocket, session: WebSocketSession): void {
    (ws as any).sessionId = session.sessionId;
    (ws as any).characterId = session.characterId;
    (ws as any).instanceId = session.instanceId;
    (ws as any).connectedAt = session.connectedAt;
    (ws as any).lastActivity = session.lastActivity;
  }

  /**
   * Set up WebSocket event handlers for session management
   */
  private setupWebSocketHandlers(ws: WebSocket, session: WebSocketSession): void {
    // Handle pings/heartbeats
    ws.on('ping', () => {
      session.lastActivity = Date.now();
      ws.pong();
    });

    ws.on('pong', () => {
      session.lastActivity = Date.now();
    });

    // Handle messages (update activity timestamp)
    ws.on('message', (data) => {
      session.lastActivity = Date.now();
      this.handleMessage(ws, session, data);
    });

    // Handle connection close
    ws.on('close', (code, reason) => {
      this.handleDisconnection(session, code, reason);
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error({
        event: 'websocket_error',
        sessionId: session.sessionId,
        error: error.message
      }, 'WebSocket error occurred');
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(ws: WebSocket, session: WebSocketSession, data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle heartbeat messages
      if (message.type === 'heartbeat') {
        ws.send(JSON.stringify({
          type: 'heartbeat_ack',
          timestamp: Date.now()
        }));
        return;
      }

      // TODO: Handle other message types
      logger.debug({
        event: 'websocket_message_received',
        sessionId: session.sessionId,
        messageType: message.type
      }, 'WebSocket message received');

    } catch (error) {
      logger.warn({
        event: 'websocket_message_parse_error',
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to parse WebSocket message');
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleDisconnection(session: WebSocketSession, code: number, reason: string | Buffer): void {
    logger.info({
      event: 'websocket_disconnection',
      sessionId: session.sessionId,
      characterId: session.characterId,
      code,
      reason: typeof reason === 'string' ? reason : reason.toString(),
      connectionDurationMs: Date.now() - session.connectedAt
    }, 'WebSocket disconnected');

    // Remove from active sessions
    this.activeSessions.delete(session.sessionId);

    // TODO: Notify session service of disconnection
  }

  /**
   * Extract session ID from WebSocket URL
   */
  private extractSessionId(url: string): string | null {
    try {
      const urlObj = new URL(url, 'http://localhost');
      return urlObj.searchParams.get('sessionId');
    } catch {
      return null;
    }
  }

  /**
   * Extract instance ID from WebSocket URL
   */
  private extractInstanceId(url: string): string | null {
    try {
      const urlObj = new URL(url, 'http://localhost');
      const pathParts = urlObj.pathname.split('/');
      const instanceIndex = pathParts.indexOf('instances');
      if (instanceIndex >= 0 && instanceIndex + 1 < pathParts.length) {
        const instanceId = pathParts[instanceIndex + 1];
        return instanceId || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Start heartbeat monitoring for session timeout detection
   */
  private startHeartbeatMonitoring(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeoutMs = this.config.sessionTimeoutMs;

      for (const [sessionId, session] of this.activeSessions) {
        if (now - session.lastActivity > timeoutMs) {
          logger.warn({
            event: 'websocket_session_timeout',
            sessionId,
            inactiveMs: now - session.lastActivity,
            timeoutMs
          }, 'WebSocket session timed out due to inactivity');

          // TODO: Close WebSocket and notify session service
          this.activeSessions.delete(sessionId);
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Get active session statistics
   */
  getStatistics(): {
    activeSessions: number;
    sessionDetails: Array<{
      sessionId: string;
      instanceId: string;
      connectedAt: number;
      lastActivity: number;
      connectionDurationMs: number;
      inactiveMs: number;
      reconnected: boolean;
    }>;
  } {
    const now = Date.now();
    return {
      activeSessions: this.activeSessions.size,
      sessionDetails: Array.from(this.activeSessions.values()).map(session => ({
        sessionId: session.sessionId,
        instanceId: session.instanceId,
        connectedAt: session.connectedAt,
        lastActivity: session.lastActivity,
        connectionDurationMs: now - session.connectedAt,
        inactiveMs: now - session.lastActivity,
        reconnected: session.reconnected
      }))
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.activeSessions.clear();
  }
}

/**
 * Factory function to create WebSocket admission middleware
 */
export function createWebSocketAdmissionMiddleware(
  sessionService: SessionService,
  config?: Partial<WebSocketAdmissionConfig>
): WebSocketAdmissionMiddleware {
  return new WebSocketAdmissionMiddleware(sessionService, config);
}