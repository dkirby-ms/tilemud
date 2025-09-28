/**
 * Metrics endpoint for Prometheus monitoring
 * Exposes admission system metrics in Prometheus format
 */

import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { register } from 'prom-client';
import { logger } from '../../infra/monitoring/logger';

const router = Router();

/**
 * GET /metrics - Prometheus metrics endpoint
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    logger.debug({
      event: 'metrics_request',
      userAgent: req.get('User-Agent'),
      clientIP: req.ip
    }, 'Serving Prometheus metrics');

    // Set appropriate headers for Prometheus
    res.setHeader('Content-Type', register.contentType);
    
    // Get metrics in Prometheus format
    const metrics = await register.metrics();
    
    logger.debug({
      event: 'metrics_response',
      metricsSize: metrics.length,
      processingTimeMs: Date.now() - startTime
    }, 'Metrics served successfully');

    res.send(metrics);

  } catch (error) {
    logger.error({
      event: 'metrics_error',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      processingTimeMs: Date.now() - startTime
    }, 'Error serving metrics');

    next(error);
  }
});

/**
 * GET /health - Basic health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

export { router as metricsRouter };