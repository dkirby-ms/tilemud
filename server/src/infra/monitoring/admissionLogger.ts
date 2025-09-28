/**
 * Structured logging for admission system
 * Provides consistent, searchable logging with correlation IDs
 */

import { logger as baseLogger } from '../../infra/monitoring/logger';

export interface AdmissionLogContext {
  correlationId?: string;
  instanceId?: string;
  sessionId?: string;
  characterId?: string;
  clientId?: string;
  reconnectionToken?: string;
  requestId?: string;
}

export interface AdmissionEvent {
  event: string;
  processingTimeMs?: number;
  [key: string]: any;
}

/**
 * Admission system structured logger with context preservation
 */
export class AdmissionLogger {
  private context: AdmissionLogContext;

  constructor(context: AdmissionLogContext = {}) {
    this.context = { ...context };
  }

  /**
   * Create a new logger instance with additional context
   */
  withContext(additionalContext: AdmissionLogContext): AdmissionLogger {
    return new AdmissionLogger({
      ...this.context,
      ...additionalContext
    });
  }

  /**
   * Log info level events with full context
   */
  info(event: AdmissionEvent, message: string): void {
    baseLogger.info({
      ...this.context,
      ...event
    }, message);
  }

  /**
   * Log warning level events with full context
   */
  warn(event: AdmissionEvent, message: string): void {
    baseLogger.warn({
      ...this.context,
      ...event
    }, message);
  }

  /**
   * Log error level events with full context
   */
  error(event: AdmissionEvent, message: string): void {
    baseLogger.error({
      ...this.context,
      ...event
    }, message);
  }

  /**
   * Log debug level events with full context
   */
  debug(event: AdmissionEvent, message: string): void {
    baseLogger.debug({
      ...this.context,
      ...event
    }, message);
  }

  /**
   * Log admission request lifecycle
   */
  admissionRequest(
    status: 'started' | 'admitted' | 'queued' | 'rejected' | 'error',
    details: {
      reason?: string;
      queuePosition?: number;
      waitTimeMs?: number;
      processingTimeMs?: number;
      error?: string;
    } = {}
  ): void {
    const event = {
      event: 'admission_request',
      status,
      ...details
    };

    switch (status) {
      case 'started':
        this.info(event, 'Admission request started');
        break;
      case 'admitted':
        this.info(event, 'Admission request approved - session created');
        break;
      case 'queued':
        this.info(event, 'Admission request queued - capacity full');
        break;
      case 'rejected':
        this.warn(event, 'Admission request rejected');
        break;
      case 'error':
        this.error(event, 'Admission request failed with error');
        break;
    }
  }

  /**
   * Log queue operations
   */
  queueOperation(
    operation: 'enqueue' | 'dequeue' | 'promote' | 'remove',
    result: 'success' | 'failure',
    details: {
      queueSize?: number;
      queuePosition?: number;
      waitTimeMs?: number;
      error?: string;
    } = {}
  ): void {
    const event = {
      event: 'queue_operation',
      operation,
      result,
      ...details
    };

    if (result === 'success') {
      this.info(event, `Queue ${operation} completed successfully`);
    } else {
      this.warn(event, `Queue ${operation} failed`);
    }
  }

  /**
   * Log session lifecycle events
   */
  sessionLifecycle(
    stage: 'create' | 'admit' | 'replace' | 'reconnect' | 'grace_start' | 'grace_end' | 'terminate',
    result: 'success' | 'failure',
    details: {
      reason?: string;
      gracePeriodMs?: number;
      sessionDurationMs?: number;
      replacedSessionId?: string;
      error?: string;
    } = {}
  ): void {
    const event = {
      event: 'session_lifecycle',
      stage,
      result,
      ...details
    };

    if (result === 'success') {
      this.info(event, `Session ${stage} completed successfully`);
    } else {
      this.warn(event, `Session ${stage} failed`);
    }
  }

  /**
   * Log WebSocket connection events
   */
  websocketConnection(
    status: 'established' | 'rejected' | 'disconnected' | 'error',
    details: {
      reason?: string;
      reconnected?: boolean;
      connectionDurationMs?: number;
      closeCode?: number;
      error?: string;
    } = {}
  ): void {
    const event = {
      event: 'websocket_connection',
      status,
      ...details
    };

    switch (status) {
      case 'established':
        this.info(event, 'WebSocket connection established');
        break;
      case 'rejected':
        this.warn(event, 'WebSocket connection rejected');
        break;
      case 'disconnected':
        this.info(event, 'WebSocket connection closed');
        break;
      case 'error':
        this.error(event, 'WebSocket connection error');
        break;
    }
  }

  /**
   * Log rate limiting events
   */
  rateLimitEvent(
    result: 'allowed' | 'denied' | 'lockout',
    details: {
      limitType?: 'sliding_window' | 'lockout';
      requestsInWindow?: number;
      windowSizeMs?: number;
      lockoutUntil?: number;
      lockoutDurationMs?: number;
    } = {}
  ): void {
    const event = {
      event: 'rate_limit',
      result,
      ...details
    };

    switch (result) {
      case 'allowed':
        this.debug(event, 'Rate limit check passed');
        break;
      case 'denied':
        this.warn(event, 'Rate limit exceeded - request denied');
        break;
      case 'lockout':
        this.warn(event, 'Client locked out due to repeated failures');
        break;
    }
  }

  /**
   * Log reconnection attempts
   */
  reconnectionAttempt(
    result: 'success' | 'failure',
    details: {
      attemptNumber?: number;
      tokenAge?: number;
      maxTokenAge?: number;
      backoffDelayMs?: number;
      error?: string;
    } = {}
  ): void {
    const event = {
      event: 'reconnection_attempt',
      result,
      ...details
    };

    if (result === 'success') {
      this.info(event, 'Reconnection attempt successful');
    } else {
      this.warn(event, 'Reconnection attempt failed');
    }
  }

  /**
   * Log background job execution
   */
  backgroundJob(
    jobType: 'janitor' | 'metrics_update',
    stage: 'started' | 'completed' | 'failed',
    details: {
      itemsProcessed?: number;
      itemsRemoved?: number;
      processingTimeMs?: number;
      error?: string;
    } = {}
  ): void {
    const event = {
      event: 'background_job',
      jobType,
      stage,
      ...details
    };

    switch (stage) {
      case 'started':
        this.debug(event, `Background job ${jobType} started`);
        break;
      case 'completed':
        this.info(event, `Background job ${jobType} completed successfully`);
        break;
      case 'failed':
        this.error(event, `Background job ${jobType} failed`);
        break;
    }
  }

  /**
   * Log capacity and performance metrics
   */
  capacityMetrics(
    details: {
      currentSessions?: number;
      maxCapacity?: number;
      utilizationPercent?: number;
      queueSize?: number;
      averageWaitTimeMs?: number;
    }
  ): void {
    this.info({
      event: 'capacity_metrics',
      ...details
    }, 'Capacity metrics snapshot');
  }

  /**
   * Log security events
   */
  securityEvent(
    eventType: 'invalid_token' | 'suspicious_activity' | 'access_denied' | 'authentication_failure',
    details: {
      clientIP?: string;
      userAgent?: string;
      attemptCount?: number;
      timeWindow?: number;
      blocked?: boolean;
    } = {}
  ): void {
    this.warn({
      event: 'security_event',
      eventType,
      ...details
    }, `Security event: ${eventType}`);
  }

  /**
   * Performance timing helper for measuring operation duration
   */
  timeOperation<T>(operationName: string, operation: () => T): T;
  timeOperation<T>(operationName: string, operation: () => Promise<T>): Promise<T>;
  timeOperation<T>(operationName: string, operation: () => T | Promise<T>): T | Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = operation();
      
      if (result instanceof Promise) {
        return result
          .then(value => {
            this.debug({
              event: 'operation_completed',
              operation: operationName,
              processingTimeMs: Date.now() - startTime
            }, `Operation ${operationName} completed`);
            return value;
          })
          .catch(error => {
            this.error({
              event: 'operation_failed',
              operation: operationName,
              processingTimeMs: Date.now() - startTime,
              error: error instanceof Error ? error.message : String(error)
            }, `Operation ${operationName} failed`);
            throw error;
          });
      } else {
        this.debug({
          event: 'operation_completed',
          operation: operationName,
          processingTimeMs: Date.now() - startTime
        }, `Operation ${operationName} completed`);
        return result;
      }
    } catch (error) {
      this.error({
        event: 'operation_failed',
        operation: operationName,
        processingTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      }, `Operation ${operationName} failed`);
      throw error;
    }
  }
}

/**
 * Factory function to create admission logger with base context
 */
export function createAdmissionLogger(context?: AdmissionLogContext): AdmissionLogger {
  return new AdmissionLogger(context);
}

/**
 * Create logger with correlation ID for request tracking
 */
export function createCorrelatedLogger(correlationId: string, additionalContext?: AdmissionLogContext): AdmissionLogger {
  return new AdmissionLogger({
    correlationId,
    ...additionalContext
  });
}

/**
 * Create logger with session context
 */
export function createSessionLogger(sessionId: string, instanceId: string, additionalContext?: AdmissionLogContext): AdmissionLogger {
  return new AdmissionLogger({
    sessionId,
    instanceId,
    ...additionalContext
  });
}

/**
 * Create logger with WebSocket context
 */
export function createWebSocketLogger(sessionId: string, instanceId: string, additionalContext?: AdmissionLogContext): AdmissionLogger {
  return new AdmissionLogger({
    sessionId,
    instanceId,
    ...additionalContext
  });
}