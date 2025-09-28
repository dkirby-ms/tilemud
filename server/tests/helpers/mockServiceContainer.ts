import { createServiceLogger } from '../../src/infra/monitoring/logger';

const logger = createServiceLogger('MockServiceContainer');

/**
 * Mock service container for tests
 * Provides stub implementations that don't require external dependencies
 */
export class MockServiceContainer {
  private mockRedis: any;
  private mockRateLimitService: any;
  private mockSessionService: any;
  private mockQueueService: any;
  private mockInitialized = false;

  constructor() {
    // Mock Redis client
    this.mockRedis = {
      ping: async () => 'PONG',
      exists: async () => 0,
      get: async () => null,
      set: async () => 'OK',
      del: async () => 1,
      quit: async () => 'OK',
    };

    // Mock services
    this.mockRateLimitService = {
      checkRateLimit: async () => ({ 
        allowed: true, 
        remaining: 10, 
        resetTimeSeconds: 60 
      })
    };

    this.mockSessionService = {
      admit: async () => ({ 
        status: 'rejected', 
        outcome: 'FAILED', 
        reason: 'MAINTENANCE'
      })
    };

    this.mockQueueService = {
      getQueueStats: async () => ({
        queueDepth: 0,
        estimatedWaitTime: 0,
        processingRate: 1.0
      }),
      enqueue: async () => ({
        outcome: 'QUEUED',
        position: 1,
        queueDepth: 1
      }),
      promoteNext: async () => null
    };
  }

  async initialize(): Promise<void> {
    if (this.mockInitialized) {
      return;
    }

    try {
      // Mock initialization
      await this.mockRedis.ping();
      logger.info({ event: 'mock_redis_connected' }, 'Mock Redis connection established');
      
      this.mockInitialized = true;
      logger.info({ event: 'mock_services_initialized' }, 'Mock services initialized successfully');
    } catch (error) {
      logger.error({
        event: 'mock_service_initialization_failed',
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to initialize mock services');
      throw error;
    }
  }

  private ensureInitialized(): void {
    if (!this.mockInitialized) {
      throw new Error('Mock services not initialized. Call initialize() first.');
    }
  }

  getAdmissionServices() {
    this.ensureInitialized();
    return {
      redisClient: this.mockRedis,
      rateLimitService: this.mockRateLimitService,
      sessionService: this.mockSessionService,
      queueService: this.mockQueueService,
    };
  }

  getQueueStatusServices() {
    this.ensureInitialized();
    return {
      redisClient: this.mockRedis,
      queueService: this.mockQueueService,
      sessionService: this.mockSessionService,
    };
  }

  getAdminServices() {
    this.ensureInitialized();
    return {
      redisClient: this.mockRedis,
    };
  }

  async shutdown(): Promise<void> {
    try {
      await this.mockRedis.quit();
      logger.info({ event: 'mock_services_shutdown' }, 'Mock services shutdown successfully');
    } catch (error) {
      logger.error({
        event: 'mock_service_shutdown_failed',
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to shutdown mock services gracefully');
    }
  }
}

/**
 * Create a test app with mock services
 */
export async function createTestApp(opts: any = {}) {
  const mockContainer = new MockServiceContainer();
  await mockContainer.initialize();
  
  // Create a test-specific service container module
  const testServiceContainer = {
    getServiceContainer: () => mockContainer,
    initializeServices: async () => mockContainer,
    shutdownServices: async () => mockContainer.shutdown()
  };

  // Mock the module for the duration of app creation
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  
  Module.prototype.require = function(id: string) {
    if (id === '../../infra/container/serviceContainer' || 
        id.endsWith('infra/container/serviceContainer')) {
      return testServiceContainer;
    }
    return originalRequire.apply(this, arguments);
  };

  try {
    // Clear require cache for server module to pick up mocked dependencies
    delete require.cache[require.resolve('../../src/api/server')];
    delete require.cache[require.resolve('../../src/api/routes/instance')];
    
    const { buildApp } = require('../../src/api/server');
    const app = await buildApp({ logger: false, ...opts });
    
    const cleanup = async () => {
      await app.close();
      await mockContainer.shutdown();
      // Restore original require
      Module.prototype.require = originalRequire;
    };

    return { app, cleanup };
  } catch (error) {
    // Restore original require on error
    Module.prototype.require = originalRequire;
    throw error;
  }
}