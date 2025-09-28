import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';

// Load .env file if present
loadDotenv();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).pipe(z.number().int().min(1).max(65535)).default('3000'),
  HTTP_PORT: z.string().transform(Number).pipe(z.number().int().min(1).max(65535)).optional(),
  
  // Database Configuration
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.string().transform(Number).pipe(z.number().int().min(1).max(65535)).default('5432'),
  DB_NAME: z.string().default('tilemud'),
  DB_USER: z.string().default('tilemud'),
  DB_PASSWORD: z.string().default(''),
  DB_MAX_CONNECTIONS: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).default('20'),

  // Redis Configuration
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).pipe(z.number().int().min(1).max(65535)).default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().transform(Number).pipe(z.number().int().min(0).max(15)).default('0'),

  // Auth Configuration
  SESSION_SECRET: z.string().min(32).default('dev-secret-please-change-in-production-32chars'),
  SESSION_TTL_SECONDS: z.string().transform(Number).pipe(z.number().int().min(60).max(86400)).default('3600'),

  // Game Configuration
  TILE_TICK_INTERVAL_MS: z.string().transform(Number).pipe(z.number().int().min(50).max(1000)).default('100'),
  RECONNECT_GRACE_SECONDS: z.string().transform(Number).pipe(z.number().int().min(30).max(600)).default('120'),

  // Connection Admission Configuration
  CURRENT_CLIENT_BUILD: z.string().default('dev-build'),
  CONNECTION_GRACE_SECONDS: z.string().transform(Number).pipe(z.number().int().min(30).max(300)).default('60'),
  CONNECTION_TIMEOUT_SECONDS: z.string().transform(Number).pipe(z.number().int().min(5).max(30)).default('10'),
  MAX_QUEUE_LENGTH: z.string().transform(Number).pipe(z.number().int().min(100).max(5000)).default('1000'),
  CONNECTION_RATE_LIMIT: z.string().transform(Number).pipe(z.number().int().min(3).max(20)).default('5'),
  CONNECTION_RATE_WINDOW_SECONDS: z.string().transform(Number).pipe(z.number().int().min(30).max(300)).default('60'),
  CONNECTION_RATE_LOCK_SECONDS: z.string().transform(Number).pipe(z.number().int().min(30).max(300)).default('60'),
  
  // Maintenance and Drain Mode
  DRAIN_MODE_ENABLED: z.string().transform(val => val === 'true').default('false'),
  MAINTENANCE_MODE_ENABLED: z.string().transform(val => val === 'true').default('false'),

  // Rate Limiting
  CHAT_RATE_LIMIT: z.string().transform(Number).pipe(z.number().int().min(5).max(100)).default('20'),
  CHAT_RATE_WINDOW_SECONDS: z.string().transform(Number).pipe(z.number().int().min(1).max(60)).default('10'),
  ACTION_RATE_LIMIT: z.string().transform(Number).pipe(z.number().int().min(10).max(200)).default('60'),
  ACTION_RATE_WINDOW_SECONDS: z.string().transform(Number).pipe(z.number().int().min(1).max(60)).default('10'),

  // Monitoring
  METRICS_ENABLED: z.string().transform(val => val === 'true').default('true'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Storage
  REPLAY_RETENTION_DAYS: z.string().transform(Number).pipe(z.number().int().min(1).max(365)).default('7'),
});

export type Config = z.infer<typeof EnvSchema>;

let config: Config;

try {
  config = EnvSchema.parse(process.env);
} catch (error) {
  console.error('❌ Invalid environment configuration:', error);
  process.exit(1);
}

export { config };

// Redis key prefixes for feature isolation
export const REDIS_KEYS = {
  CONNECTION_SESSION: 'connection:session:',
  CONNECTION_QUEUE: 'connection:queue:',
  CONNECTION_RATE_LIMIT: 'connection:ratelimit:',
  CONNECTION_GRACE: 'connection:grace:',
  CONNECTION_METRICS: 'connection:metrics:',
} as const;

// Helper to validate required production settings
export function validateProductionConfig(): void {
  if (config.NODE_ENV === 'production') {
    if (config.SESSION_SECRET === 'dev-secret-please-change-in-production-32chars') {
      throw new Error('SESSION_SECRET must be changed in production');
    }
    if (!config.DB_PASSWORD) {
      throw new Error('DB_PASSWORD is required in production');
    }
  }
}