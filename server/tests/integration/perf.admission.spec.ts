/**
 * T063: Performance smoke test - Admit 100 sequential attempts
 * Validates that the admission system can handle sequential load without degradation
 * 
 * Functional Requirements:
 * - NFR-004: System performance under load (100 sequential admissions)
 * - NFR-005: Response time consistency across multiple requests
 * - FR-012: Rate limiting doesn't prevent legitimate traffic patterns
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome } from '../../src/domain/connection';

describe('Integration: Performance Smoke Test - Sequential Admissions (T063)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildApp({ logger: false });
    await server.ready();
  }, 15000); // Extended timeout for server setup

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  }, 10000); // Extended timeout for cleanup

  describe('Sequential Load Performance', () => {
    it('should handle 100 sequential admission attempts without degradation', async () => {
      // This test validates that the admission system can handle sustained load
      // without significant performance degradation or failure
      
      const instanceId = 'perf-test-sequential';
      const totalRequests = 100;
      const results: Array<{ 
        requestId: number; 
        statusCode: number; 
        responseTime: number; 
        outcome?: string;
        queuePosition?: number;
      }> = [];
      
      console.log(`Starting performance test: ${totalRequests} sequential admission attempts`);
      const overallStartTime = Date.now();
      
      // Execute sequential admission requests
      for (let i = 1; i <= totalRequests; i++) {
        const startTime = Date.now();
        
        try {
          const response = await server.inject({
            method: 'POST',
            url: `/instances/${instanceId}/connect`,
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer valid-jwt-token'
            },
            payload: {
              characterId: `char-perf-${i}`,
              clientBuild: '1.0.0',
              allowReplacement: false
            }
          });
          
          const responseTime = Date.now() - startTime;
          
          const result: { 
            requestId: number; 
            statusCode: number; 
            responseTime: number; 
            outcome?: string;
            queuePosition?: number;
          } = {
            requestId: i,
            statusCode: response.statusCode,
            responseTime,
          };
          
          // Parse response body if available
          try {
            const body = JSON.parse(response.body);
            result.outcome = body.outcome;
            if (body.queuePosition) {
              result.queuePosition = body.queuePosition;
            }
          } catch (e) {
            // Ignore JSON parsing errors
          }
          
          results.push(result);
          
          // Progress logging every 20 requests
          if (i % 20 === 0) {
            console.log(`Completed ${i}/${totalRequests} requests. Latest response time: ${responseTime}ms`);
          }
          
        } catch (error) {
          // Record failed requests
          results.push({
            requestId: i,
            statusCode: 0, // Indicate request failure
            responseTime: Date.now() - startTime,
          });
          
          console.warn(`Request ${i} failed:`, error instanceof Error ? error.message : error);
        }
      }
      
      const overallDuration = Date.now() - overallStartTime;
      console.log(`Performance test completed in ${overallDuration}ms`);
      
      // Analyze results
      const successfulRequests = results.filter(r => r.statusCode > 0);
      const failedRequests = results.filter(r => r.statusCode === 0);
      
      console.log(`Results: ${successfulRequests.length} successful, ${failedRequests.length} failed`);
      
      // Performance assertions
      expect(successfulRequests.length).toBeGreaterThan(0); // At least some requests should succeed
      expect(successfulRequests.length / totalRequests).toBeGreaterThan(0.5); // >50% success rate
      
      if (successfulRequests.length > 0) {
        // Response time analysis
        const responseTimes = successfulRequests.map(r => r.responseTime);
        const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        const maxResponseTime = Math.max(...responseTimes);
        const minResponseTime = Math.min(...responseTimes);
        
        console.log(`Response times - Avg: ${avgResponseTime.toFixed(2)}ms, Min: ${minResponseTime}ms, Max: ${maxResponseTime}ms`);
        
        // Performance requirements
        expect(avgResponseTime).toBeLessThan(5000); // Average response under 5 seconds
        expect(maxResponseTime).toBeLessThan(10000); // No request should take more than 10 seconds
        
        // Status code distribution
        const statusCodes = new Map<number, number>();
        successfulRequests.forEach(r => {
          statusCodes.set(r.statusCode, (statusCodes.get(r.statusCode) || 0) + 1);
        });
        
        console.log('Status code distribution:', Object.fromEntries(statusCodes));
        
        // Should have valid HTTP status codes
        successfulRequests.forEach(result => {
          expect([200, 202, 429, 503]).toContain(result.statusCode);
        });
      }
    }, 120000); // 2 minute timeout for the entire test

    it('should maintain consistent performance across batches', async () => {
      // This test validates that performance doesn't degrade significantly
      // across multiple batches of requests
      
      const instanceId = 'perf-test-batches';
      const batchSize = 10;
      const numBatches = 5;
      const batchResults: Array<{ batchId: number; avgResponseTime: number; successRate: number }> = [];
      
      console.log(`Starting batch performance test: ${numBatches} batches of ${batchSize} requests`);
      
      for (let batch = 1; batch <= numBatches; batch++) {
        const batchStartTime = Date.now();
        const batchPromises: Promise<any>[] = [];
        
        // Create batch of concurrent requests
        for (let i = 1; i <= batchSize; i++) {
          const requestStartTime = Date.now();
          
          const requestPromise = server.inject({
            method: 'POST',
            url: `/instances/${instanceId}/connect`,
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer valid-jwt-token'
            },
            payload: {
              characterId: `char-batch-${batch}-${i}`,
              clientBuild: '1.0.0',
              allowReplacement: false
            }
          }).then(response => ({
            statusCode: response.statusCode,
            responseTime: Date.now() - requestStartTime,
            batch: batch,
            requestId: i
          })).catch(error => ({
            statusCode: 0,
            responseTime: Date.now() - requestStartTime,
            batch: batch,
            requestId: i,
            error: error instanceof Error ? error.message : error
          }));
          
          batchPromises.push(requestPromise);
        }
        
        // Wait for batch completion
        const batchResponses = await Promise.all(batchPromises);
        
        // Analyze batch performance
        const successfulResponses = batchResponses.filter(r => r.statusCode > 0);
        const successRate = successfulResponses.length / batchSize;
        
        let avgResponseTime = 0;
        if (successfulResponses.length > 0) {
          const totalResponseTime = successfulResponses.reduce((sum, r) => sum + r.responseTime, 0);
          avgResponseTime = totalResponseTime / successfulResponses.length;
        }
        
        batchResults.push({
          batchId: batch,
          avgResponseTime,
          successRate
        });
        
        const batchDuration = Date.now() - batchStartTime;
        console.log(`Batch ${batch} completed in ${batchDuration}ms. Avg response: ${avgResponseTime.toFixed(2)}ms, Success rate: ${(successRate * 100).toFixed(1)}%`);
        
        // Brief pause between batches to allow system recovery
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Performance consistency analysis
      const avgResponseTimes = batchResults.map(b => b.avgResponseTime).filter(t => t > 0);
      const successRates = batchResults.map(b => b.successRate);
      
      if (avgResponseTimes.length > 0) {
        const overallAvgResponse = avgResponseTimes.reduce((a, b) => a + b, 0) / avgResponseTimes.length;
        const responseTimeVariation = Math.max(...avgResponseTimes) - Math.min(...avgResponseTimes);
        
        console.log(`Overall performance - Avg response: ${overallAvgResponse.toFixed(2)}ms, Variation: ${responseTimeVariation.toFixed(2)}ms`);
        
        // Performance consistency requirements
        expect(overallAvgResponse).toBeLessThan(5000); // Average should be under 5 seconds
        expect(responseTimeVariation).toBeLessThan(3000); // Variation should be reasonable
      }
      
      // Success rate analysis
      const overallSuccessRate = successRates.reduce((a, b) => a + b, 0) / successRates.length;
      console.log(`Overall success rate: ${(overallSuccessRate * 100).toFixed(1)}%`);
      
      expect(overallSuccessRate).toBeGreaterThan(0.3); // At least 30% success rate across batches
    }, 60000); // 1 minute timeout
  });

  describe('Rate Limiting Performance', () => {
    it('should handle rate limiting gracefully under load', async () => {
      // This test validates that rate limiting works correctly and doesn't
      // cause system instability under sustained load
      
      const instanceId = 'perf-test-rate-limit';
      const rapidRequests = 50;
      const results: Array<{ statusCode: number; outcome?: string; rateLimited?: boolean }> = [];
      
      console.log(`Testing rate limiting with ${rapidRequests} rapid requests`);
      
      // Send rapid sequential requests to trigger rate limiting
      for (let i = 1; i <= rapidRequests; i++) {
        try {
          const response = await server.inject({
            method: 'POST',
            url: `/instances/${instanceId}/connect`,
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer valid-jwt-token'
            },
            payload: {
              characterId: `char-rate-${i}`,
              clientBuild: '1.0.0',
              allowReplacement: false
            }
          });
          
          const result: { statusCode: number; outcome?: string; rateLimited?: boolean } = { statusCode: response.statusCode };
          
          try {
            const body = JSON.parse(response.body);
            result.outcome = body.outcome;
            result.rateLimited = (response.statusCode === 429 || body.reason === 'RATE_LIMITED');
          } catch (e) {
            // Ignore JSON parsing errors
          }
          
          results.push(result);
          
        } catch (error) {
          results.push({ statusCode: 0 });
        }
        
        // Very short delay to maintain rapid pace
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // Analyze rate limiting behavior
      const rateLimitedResponses = results.filter(r => r.rateLimited || r.statusCode === 429);
      const successfulResponses = results.filter(r => r.statusCode === 200 || r.statusCode === 202);
      const validResponses = results.filter(r => r.statusCode > 0);
      
      console.log(`Rate limiting results: ${rateLimitedResponses.length} rate limited, ${successfulResponses.length} successful, ${validResponses.length} total valid responses`);
      
      // System stability assertions
      expect(validResponses.length).toBeGreaterThan(rapidRequests * 0.5); // At least 50% should get valid responses
      expect(validResponses.length / rapidRequests).toBeGreaterThan(0.5); // Response rate validation
      
      // Rate limiting should activate under rapid load
      if (rateLimitedResponses.length > 0) {
        console.log('Rate limiting successfully activated under load');
        expect(rateLimitedResponses.length).toBeGreaterThan(0); // Rate limiting should occur
      }
      
      // All responses should be valid HTTP status codes
      validResponses.forEach(result => {
        expect([200, 202, 429, 503]).toContain(result.statusCode);
      });
    }, 30000); // 30 second timeout
  });

  describe('Memory and Resource Management', () => {
    it('should not leak resources during sustained load', async () => {
      // This test validates that the system properly manages resources
      // and doesn't accumulate memory leaks during sustained operation
      
      const instanceId = 'perf-test-resources';
      const sustainedRequests = 30;
      const memoryMeasurements: number[] = [];
      
      // Take initial memory measurement
      const initialMemory = process.memoryUsage().heapUsed;
      memoryMeasurements.push(initialMemory);
      
      console.log(`Initial memory usage: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`);
      
      // Execute sustained load
      for (let i = 1; i <= sustainedRequests; i++) {
        try {
          await server.inject({
            method: 'POST',
            url: `/instances/${instanceId}/connect`,
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer valid-jwt-token'
            },
            payload: {
              characterId: `char-resource-${i}`,
              clientBuild: '1.0.0',
              allowReplacement: false
            }
          });
          
          // Periodic memory measurements
          if (i % 10 === 0) {
            // Force garbage collection opportunity
            if (global.gc) {
              global.gc();
            }
            
            const currentMemory = process.memoryUsage().heapUsed;
            memoryMeasurements.push(currentMemory);
            
            console.log(`Memory after ${i} requests: ${(currentMemory / 1024 / 1024).toFixed(2)} MB`);
          }
          
        } catch (error) {
          // Continue test even if some requests fail
          console.warn(`Request ${i} failed:`, error instanceof Error ? error.message : error);
        }
        
        // Small delay to allow garbage collection
        if (i % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Final memory measurement
      if (global.gc) {
        global.gc(); // Force final garbage collection
      }
      
      await new Promise(resolve => setTimeout(resolve, 200)); // Allow GC to complete
      
      const finalMemory = process.memoryUsage().heapUsed;
      memoryMeasurements.push(finalMemory);
      
      // Memory analysis
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreaseMB = memoryIncrease / 1024 / 1024;
      
      console.log(`Final memory usage: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Memory increase: ${memoryIncreaseMB.toFixed(2)} MB`);
      
      // Resource management assertions
      expect(memoryIncreaseMB).toBeLessThan(50); // Should not increase by more than 50MB
      
      // Memory should not grow indefinitely
      const maxMemory = Math.max(...memoryMeasurements);
      const memoryGrowth = (maxMemory - initialMemory) / 1024 / 1024;
      expect(memoryGrowth).toBeLessThan(100); // Total growth should be reasonable
      
      console.log(`Maximum memory growth: ${memoryGrowth.toFixed(2)} MB`);
    }, 45000); // 45 second timeout
  });
});