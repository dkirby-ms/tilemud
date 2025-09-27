import pino, { Logger, LoggerOptions } from 'pino';
import { config } from '../../config/env';

/**
 * Centralized logging infrastructure using Pino
 * Provides structured logging with child logger creation
 */

// Base logger configuration
const baseLoggerOptions: LoggerOptions = {
  level: config.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  serializers: {
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
};

// Development vs production configuration
const loggerOptions: LoggerOptions = 
  config.NODE_ENV === 'development' 
    ? {
        ...baseLoggerOptions,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'HH:MM:ss',
          },
        },
      }
    : {
        ...baseLoggerOptions,
        // Production: JSON output for log aggregation
      };

// Base logger instance
const baseLogger: Logger = pino(loggerOptions);

/**
 * Enhanced logger wrapper with game-specific context
 */
export class GameLogger {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // Core logging methods
  trace(obj: unknown, msg?: string): void;
  trace(msg: string): void;
  trace(objOrMsg: unknown, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.logger.trace(objOrMsg);
    } else {
      this.logger.trace(objOrMsg, msg);
    }
  }

  debug(obj: unknown, msg?: string): void;
  debug(msg: string): void;
  debug(objOrMsg: unknown, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.logger.debug(objOrMsg);
    } else {
      this.logger.debug(objOrMsg, msg);
    }
  }

  info(obj: unknown, msg?: string): void;
  info(msg: string): void;
  info(objOrMsg: unknown, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.logger.info(objOrMsg);
    } else {
      this.logger.info(objOrMsg, msg);
    }
  }

  warn(obj: unknown, msg?: string): void;
  warn(msg: string): void;
  warn(objOrMsg: unknown, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.logger.warn(objOrMsg);
    } else {
      this.logger.warn(objOrMsg, msg);
    }
  }

  error(obj: unknown, msg?: string): void;
  error(msg: string): void;
  error(objOrMsg: unknown, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.logger.error(objOrMsg);
    } else {
      this.logger.error(objOrMsg, msg);
    }
  }

  fatal(obj: unknown, msg?: string): void;
  fatal(msg: string): void;
  fatal(objOrMsg: unknown, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.logger.fatal(objOrMsg);
    } else {
      this.logger.fatal(objOrMsg, msg);
    }
  }

  // Game-specific logging methods
  logPlayerAction(playerId: string, action: string, arenaId?: string, outcome?: string): void {
    this.info({
      event: 'player_action',
      playerId,
      action,
      arenaId,
      outcome,
    }, `Player ${playerId} performed ${action}${arenaId ? ` in arena ${arenaId}` : ''}`);
  }

  logArenaEvent(arenaId: string, event: string, details?: unknown): void {
    this.info({
      event: 'arena_event',
      arenaId,
      eventType: event,
      details,
    }, `Arena ${arenaId}: ${event}`);
  }

  logChatMessage(channelId: string, senderId: string, channelType: string, messageLength: number): void {
    this.debug({
      event: 'chat_message',
      channelId,
      senderId,
      channelType,
      messageLength,
    }, `Chat message in ${channelType} channel ${channelId}`);
  }

  logRateLimitHit(playerId: string, limitType: string, remainingQuota: number): void {
    this.warn({
      event: 'rate_limit_hit',
      playerId,
      limitType,
      remainingQuota,
    }, `Rate limit hit for player ${playerId} on ${limitType}`);
  }

  logSystemMetrics(metrics: { cpu: number; memory: number; playerCount: number }): void {
    this.debug({
      event: 'system_metrics',
      cpu: metrics.cpu,
      memory: metrics.memory,
      playerCount: metrics.playerCount,
    }, 'System metrics snapshot');
  }

  logAiElasticity(arenaId: string, action: 'expand' | 'reduce', aiCount: number, trigger: string): void {
    this.info({
      event: 'ai_elasticity',
      arenaId,
      action,
      aiCount,
      trigger,
    }, `AI elasticity ${action} in arena ${arenaId}: ${aiCount} entities (trigger: ${trigger})`);
  }

  logReplayEvent(replayId: string, event: string, sequenceNumber?: number): void {
    this.debug({
      event: 'replay_event',
      replayId,
      eventType: event,
      sequenceNumber,
    }, `Replay ${replayId}: ${event}${sequenceNumber !== undefined ? ` (seq: ${sequenceNumber})` : ''}`);
  }

  logGuildEvent(guildId: string, event: string, playerId?: string, details?: unknown): void {
    this.info({
      event: 'guild_event',
      guildId,
      eventType: event,
      playerId,
      details,
    }, `Guild ${guildId}: ${event}${playerId ? ` (player: ${playerId})` : ''}`);
  }

  logSecurityEvent(event: string, playerId?: string, details?: unknown): void {
    this.warn({
      event: 'security_event',
      eventType: event,
      playerId,
      details,
    }, `Security event: ${event}${playerId ? ` (player: ${playerId})` : ''}`);
  }

  logPerformanceWarning(component: string, metric: string, value: number, threshold: number): void {
    this.warn({
      event: 'performance_warning',
      component,
      metric,
      value,
      threshold,
      exceededBy: value - threshold,
    }, `Performance warning: ${component} ${metric} (${value}) exceeded threshold (${threshold})`);
  }

  // Create child logger with additional context
  child(context: Record<string, unknown>): GameLogger {
    const childLogger = this.logger.child(context);
    return new GameLogger(childLogger);
  }

  // Direct access to underlying Pino logger if needed
  get underlying(): Logger {
    return this.logger;
  }
}

// Create and export base logger instance
export const logger = new GameLogger(baseLogger);

// Factory function for creating context-aware loggers
export function createLogger(context: Record<string, unknown>): GameLogger {
  return logger.child(context);
}

// Convenience factory functions for common contexts
export function createPlayerLogger(playerId: string): GameLogger {
  return createLogger({ playerId });
}

export function createArenaLogger(arenaId: string): GameLogger {
  return createLogger({ arenaId });
}

export function createGuildLogger(guildId: string): GameLogger {
  return createLogger({ guildId });
}

export function createServiceLogger(service: string): GameLogger {
  return createLogger({ service });
}

export function createRequestLogger(requestId: string, method?: string, path?: string): GameLogger {
  return createLogger({ 
    requestId, 
    ...(method && { method }),
    ...(path && { path })
  });
}

// Export types for external usage
export type { Logger } from 'pino';