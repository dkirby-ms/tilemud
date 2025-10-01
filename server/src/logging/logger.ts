import pinoPkg from "pino";
import type { LoggerOptions } from "pino";

// pino has both CJS/ESM signatures; treat imported value as callable factory
const pino = (pinoPkg as unknown as (opts?: LoggerOptions) => PinoLogger);
type PinoLogger = import("pino").Logger;

export interface LoggerFactoryOptions {
  level?: string;
  name?: string;
  pretty?: boolean;
}

function buildOptions(options: LoggerFactoryOptions = {}): LoggerOptions {
  const level = options.level || process.env.LOG_LEVEL || "info";
  const base: LoggerOptions = {
    level,
    name: options.name || "tilemud"
  };

  if (options.pretty || process.env.LOG_PRETTY === "true") {
    // Lazy require to keep ESM compatibility without extra deps when not needed
    return {
      ...base,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          singleLine: true
        }
      }
    } as LoggerOptions; // transport not in base LoggerOptions typing pre v9
  }

  return base;
}

let rootLogger: PinoLogger | null = null;

export function getLogger(options?: LoggerFactoryOptions): PinoLogger {
  if (!rootLogger) {
    rootLogger = pino(buildOptions(options));
  }
  return rootLogger as PinoLogger;
}

export function createChildLogger(binding: Record<string, unknown>): PinoLogger {
  return getLogger().child(binding);
}

// Narrow application logger facade that matches simpler LoggerLike expectations elsewhere
export interface AppLogger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  child?(bindings: Record<string, unknown>): AppLogger;
}

export function getAppLogger(): AppLogger {
  const base = getLogger();
  const adapter: AppLogger = {
    debug: (...args: unknown[]) => { (base as any).debug?.(args[0], ...(args.slice(1) as any)); },
    info: (...args: unknown[]) => { (base as any).info?.(args[0], ...(args.slice(1) as any)); },
    warn: (...args: unknown[]) => { (base as any).warn?.(args[0], ...(args.slice(1) as any)); },
    error: (...args: unknown[]) => { (base as any).error?.(args[0], ...(args.slice(1) as any)); },
    child: (bindings: Record<string, unknown>) => {
      const child = (base as any).child?.(bindings);
      return {
        debug: (...args: unknown[]) => { child.debug?.(args[0], ...(args.slice(1) as any)); },
        info: (...args: unknown[]) => { child.info?.(args[0], ...(args.slice(1) as any)); },
        warn: (...args: unknown[]) => { child.warn?.(args[0], ...(args.slice(1) as any)); },
        error: (...args: unknown[]) => { child.error?.(args[0], ...(args.slice(1) as any)); },
        child: adapter.child // reuse top-level child to maintain chain
      } as AppLogger;
    }
  };
  return adapter;
}

