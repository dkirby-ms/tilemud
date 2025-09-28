import { Redis } from 'ioredis';
import { RateLimitService } from '../../application/services/rateLimit/rateLimitService';
import { SessionService } from '../../application/services/session/sessionService';
import { QueueService } from '../../application/services/queue/queueService';
import { createServiceLogger } from '../../infra/monitoring/logger';

const logger = createServiceLogger('ServiceContainer');

/**
 * Service container for dependency injection
 * Initializes and provides access to all application services
 */
export class ServiceContainer {
  private redis: Redis;
  private rateLimitService: RateLimitService;
  private sessionService: SessionService;
  private queueService: QueueService;
  private initialized = false;

  constructor(redisConnectionString?: string) {
    // Initialize Redis connection
    this.redis = new Redis(redisConnectionString || process.env['REDIS_URL'] || 'redis://localhost:6379');
    
    // Initialize services with Redis dependency
    this.rateLimitService = new RateLimitService(this.redis);
    this.sessionService = new SessionService(this.redis);
    this.queueService = new QueueService(this.redis);
  }

  /**
   * Initialize all services and verify connections
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Test Redis connection
      await this.redis.ping();
      logger.info({ event: 'redis_connected' }, 'Redis connection established');

      // TODO: Add any service-specific initialization here
      
      this.initialized = true;
      logger.info({ event: 'services_initialized' }, 'All services initialized successfully');
    } catch (error) {
      logger.error({
        event: 'service_initialization_failed',
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to initialize services');
      throw error;
    }
  }

  /**
   * Get services for admission controller
   */
  getAdmissionServices() {
    this.ensureInitialized();
    return {
      redisClient: this.redis,
      rateLimitService: this.rateLimitService,
      sessionService: this.sessionService,
      queueService: this.queueService,
    };
  }

  /**
   * Get services for queue status controller
   */
  getQueueStatusServices() {
    this.ensureInitialized();
    return {
      redisClient: this.redis,
      queueService: this.queueService,
      sessionService: this.sessionService,
    };
  }

  /**
   * Get services for admin controller
   */
  getAdminServices() {
    this.ensureInitialized();
    return {
      redisClient: this.redis,
    };
  }

  /**
   * Shutdown all services gracefully
   */
  async shutdown(): Promise<void> {
    try {
      await this.redis.quit();
      logger.info({ event: 'services_shutdown' }, 'All services shutdown successfully');
    } catch (error) {
      logger.error({
        event: 'service_shutdown_failed',
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to shutdown services gracefully');
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Services not initialized. Call initialize() first.');
    }
  }
}

// Global service container instance
let globalContainer: ServiceContainer | null = null;

/**
 * Get or create the global service container
 */
export function getServiceContainer(): ServiceContainer {
  if (!globalContainer) {
    globalContainer = new ServiceContainer();
  }
  return globalContainer;
}

/**
 * Initialize services for the application
 */
export async function initializeServices(redisConnectionString?: string): Promise<ServiceContainer> {
  if (!globalContainer) {
    globalContainer = new ServiceContainer(redisConnectionString);
  }
  
  if (!globalContainer['initialized']) {
    await globalContainer.initialize();
  }
  
  return globalContainer;
}

/**
 * Shutdown services for the application
 */
export async function shutdownServices(): Promise<void> {
  if (globalContainer) {
    await globalContainer.shutdown();
    globalContainer = null;
  }
}