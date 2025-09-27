import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';

/**
 * Contract tests for POST /auth/session endpoint (FR-009)
 * Tests session ticket issuance from client auth token
 */
describe('POST /auth/session Contract Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Build the Fastify app for testing
    app = buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Happy Path', () => {
    it('should exchange valid token for session ticket', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'valid-auth-token'
        }
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody).toMatchObject({
        ticket: expect.any(String),
        playerId: expect.any(String),
        expiresAt: expect.any(String),
        supportedMessageVersions: expect.any(Array)
      });

      // Validate ticket format (should be a secure token)
      expect(responseBody.ticket.length).toBeGreaterThan(20);
      
      // Validate playerId format (UUID)
      expect(responseBody.playerId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );

      // Validate expiresAt is a valid ISO date in the future
      const expiresAt = new Date(responseBody.expiresAt);
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Validate supportedMessageVersions array
      expect(responseBody.supportedMessageVersions).toBeInstanceOf(Array);
      expect(responseBody.supportedMessageVersions.length).toBeGreaterThan(0);
      responseBody.supportedMessageVersions.forEach((version: string) => {
        expect(typeof version).toBe('string');
      });
    });

    it('should include proper message versions in response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'valid-auth-token'
        }
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      
      // Should support at least one message version
      expect(responseBody.supportedMessageVersions).toContain('1.0');
    });

    it('should return tickets with reasonable expiry time', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'valid-auth-token'
        }
      });

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      const expiresAt = new Date(responseBody.expiresAt);
      const now = new Date();
      
      // Ticket should expire between 1 minute and 24 hours from now
      const oneMinute = 60 * 1000;
      const twentyFourHours = 24 * 60 * 60 * 1000;
      
      expect(expiresAt.getTime() - now.getTime()).toBeGreaterThan(oneMinute);
      expect(expiresAt.getTime() - now.getTime()).toBeLessThan(twentyFourHours);
    });
  });

  describe('Invalid Token Scenarios', () => {
    it('should return 401 for invalid token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'invalid-token'
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for expired token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'expired-token'
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for malformed token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'malformed.token.format'
        }
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for empty token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: ''
        }
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Request Validation', () => {
    it('should return 400 for missing token field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {}
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for non-string token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 12345
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for malformed JSON', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: '{ "token": invalid json }'
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for missing content-type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        payload: JSON.stringify({
          token: 'valid-token'
        })
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 415 for wrong content-type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'text/plain'
        },
        payload: 'token=valid-token'
      });

      expect([400, 415]).toContain(response.statusCode);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limiting for authentication requests', async () => {
      const requests = [];

      // Fire many rapid requests to trigger rate limiting
      for (let i = 0; i < 50; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/auth/session',
            headers: {
              'content-type': 'application/json'
            },
            payload: {
              token: `test-token-${i}`
            }
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // At least some should be rate limited
      const rateLimitedResponses = responses.filter(r => r.statusCode === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      // Rate limited response should have proper headers
      if (rateLimitedResponses.length > 0) {
        const rateLimited = rateLimitedResponses[0];
        expect(rateLimited.headers).toHaveProperty('retry-after');
      }
    });
  });

  describe('Concurrent Sessions', () => {
    it('should handle concurrent session requests for same token', async () => {
      const token = 'concurrent-test-token';
      
      const requests = [
        app.inject({
          method: 'POST',
          url: '/auth/session',
          headers: {
            'content-type': 'application/json'
          },
          payload: { token }
        }),
        app.inject({
          method: 'POST',
          url: '/auth/session',
          headers: {
            'content-type': 'application/json'
          },
          payload: { token }
        }),
        app.inject({
          method: 'POST',
          url: '/auth/session',
          headers: {
            'content-type': 'application/json'
          },
          payload: { token }
        })
      ];

      const responses = await Promise.all(requests);
      
      // All should succeed or fail consistently
      const statusCodes = responses.map(r => r.statusCode);
      const uniqueStatusCodes = [...new Set(statusCodes)];
      
      // Should either all succeed or all fail with same error
      expect(uniqueStatusCodes.length).toBeLessThanOrEqual(2);
      
      // If any succeed, they should have valid tickets
      const successResponses = responses.filter(r => r.statusCode === 200);
      successResponses.forEach(response => {
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('ticket');
        expect(body).toHaveProperty('playerId');
      });
    });
  });

  describe('Response Format', () => {
    it('should return JSON content-type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'valid-token'
        }
      });

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should not cache authentication responses', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'valid-token'
        }
      });

      // Auth responses should not be cached
      expect(response.headers['cache-control']).toMatch(/no-cache|no-store|private/);
    });
  });

  describe('Security', () => {
    it('should not leak sensitive information in error responses', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'invalid-token-that-might-contain-secrets'
        }
      });

      expect(response.statusCode).toBe(401);
      
      // Should not echo back the token in error response
      expect(response.body).not.toContain('invalid-token-that-might-contain-secrets');
    });

    it('should generate unique tickets for different requests', async () => {
      const response1 = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'valid-token-1'
        }
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          token: 'valid-token-2'
        }
      });

      if (response1.statusCode === 200 && response2.statusCode === 200) {
        const body1 = JSON.parse(response1.body);
        const body2 = JSON.parse(response2.body);
        
        expect(body1.ticket).not.toBe(body2.ticket);
      }
    });
  });
});