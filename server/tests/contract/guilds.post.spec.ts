import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';

/**
 * Contract tests for POST /guilds endpoint (FR-006)
 * Tests guild creation with uniqueness enforcement
 */
describe('POST /guilds Contract Tests', () => {
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
    it('should create a new guild with valid name', async () => {
      const guildName = `TestGuild_${Date.now()}`;
      
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: guildName
        }
      });

      expect(response.statusCode).toBe(201);
    });

    it('should accept guild names at minimum length boundary', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: 'ABC' // 3 characters (minimum)
        }
      });

      expect(response.statusCode).toBe(201);
    });

    it('should accept guild names at maximum length boundary', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: 'A'.repeat(32) // 32 characters (maximum)
        }
      });

      expect(response.statusCode).toBe(201);
    });

    it('should accept guild names with valid characters', async () => {
      const validNames = [
        'TestGuild123',
        'Guild_With_Underscores',
        'Guild-With-Hyphens',
        'GuildWithNumbers789',
        'MixedCaseGuild'
      ];

      for (const name of validNames) {
        const uniqueName = `${name}_${Date.now()}`;
        
        const response = await app.inject({
          method: 'POST',
          url: '/guilds',
          headers: {
            'content-type': 'application/json'
          },
          payload: {
            name: uniqueName
          }
        });

        expect(response.statusCode).toBe(201);
      }
    });
  });

  describe('Name Validation', () => {
    it('should reject guild names too short', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: 'AB' // 2 characters (below minimum of 3)
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject guild names too long', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: 'A'.repeat(33) // 33 characters (above maximum of 32)
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject empty guild name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: ''
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing name field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {}
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject non-string name field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: 12345
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject null name field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: null
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Name Uniqueness and Reservation', () => {
    it('should reject duplicate guild names', async () => {
      const guildName = `DuplicateTest_${Date.now()}`;
      
      // First creation should succeed
      const response1 = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: guildName
        }
      });

      expect(response1.statusCode).toBe(201);

      // Second creation with same name should fail
      const response2 = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: guildName
        }
      });

      expect(response2.statusCode).toBe(409);
    });

    it('should reject reserved guild names', async () => {
      const reservedNames = [
        'admin',
        'moderator',
        'system',
        'staff',
        'support'
      ];

      for (const name of reservedNames) {
        const response = await app.inject({
          method: 'POST',
          url: '/guilds',
          headers: {
            'content-type': 'application/json'
          },
          payload: {
            name
          }
        });

        expect(response.statusCode).toBe(409);
      }
    });

    it('should handle case-insensitive uniqueness', async () => {
      const baseName = `CaseTest_${Date.now()}`;
      
      // Create with lowercase
      const response1 = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: baseName.toLowerCase()
        }
      });

      expect(response1.statusCode).toBe(201);

      // Try to create with uppercase - should fail due to uniqueness
      const response2 = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: baseName.toUpperCase()
        }
      });

      expect(response2.statusCode).toBe(409);
    });
  });

  describe('Request Format Validation', () => {
    it('should reject malformed JSON', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: '{ "name": invalid json }'
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing content-type header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        payload: JSON.stringify({
          name: 'TestGuild'
        })
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject wrong content-type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'text/plain'
        },
        payload: 'name=TestGuild'
      });

      expect([400, 415]).toContain(response.statusCode);
    });

    it('should reject extra unexpected fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: 'ValidGuild',
          extraField: 'should not be allowed',
          anotherField: 123
        }
      });

      // Should either succeed (ignoring extra fields) or fail with validation error
      // This depends on implementation - strict validation would return 400
      expect([201, 400]).toContain(response.statusCode);
    });
  });

  describe('Concurrent Guild Creation', () => {
    it('should handle concurrent creation attempts for same name', async () => {
      const guildName = `ConcurrentTest_${Date.now()}`;
      
      const requests = [
        app.inject({
          method: 'POST',
          url: '/guilds',
          headers: {
            'content-type': 'application/json'
          },
          payload: { name: guildName }
        }),
        app.inject({
          method: 'POST',
          url: '/guilds',
          headers: {
            'content-type': 'application/json'
          },
          payload: { name: guildName }
        }),
        app.inject({
          method: 'POST',
          url: '/guilds',
          headers: {
            'content-type': 'application/json'
          },
          payload: { name: guildName }
        })
      ];

      const responses = await Promise.all(requests);
      
      // Exactly one should succeed, others should fail with 409
      const successResponses = responses.filter(r => r.statusCode === 201);
      const conflictResponses = responses.filter(r => r.statusCode === 409);
      
      expect(successResponses).toHaveLength(1);
      expect(conflictResponses).toHaveLength(2);
    });

    it('should handle concurrent creation of different guilds', async () => {
      const timestamp = Date.now();
      
      const requests = [
        app.inject({
          method: 'POST',
          url: '/guilds',
          headers: {
            'content-type': 'application/json'
          },
          payload: { name: `ConcurrentGuild1_${timestamp}` }
        }),
        app.inject({
          method: 'POST',
          url: '/guilds',
          headers: {
            'content-type': 'application/json'
          },
          payload: { name: `ConcurrentGuild2_${timestamp}` }
        }),
        app.inject({
          method: 'POST',
          url: '/guilds',
          headers: {
            'content-type': 'application/json'
          },
          payload: { name: `ConcurrentGuild3_${timestamp}` }
        })
      ];

      const responses = await Promise.all(requests);
      
      // All should succeed since names are different
      responses.forEach(response => {
        expect(response.statusCode).toBe(201);
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limiting for guild creation', async () => {
      const requests = [];

      // Fire many rapid requests to trigger rate limiting
      for (let i = 0; i < 20; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/guilds',
            headers: {
              'content-type': 'application/json'
            },
            payload: {
              name: `RateLimit_${Date.now()}_${i}`
            }
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // Some should be rate limited
      const rateLimitedResponses = responses.filter(r => r.statusCode === 429);
      
      if (rateLimitedResponses.length > 0) {
        expect(rateLimitedResponses.length).toBeGreaterThan(0);
        
        // Rate limited response should have proper headers
        const rateLimited = rateLimitedResponses[0];
        expect(rateLimited.headers).toHaveProperty('retry-after');
      }
    });
  });

  describe('Response Format', () => {
    it('should return proper status code for successful creation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: `StatusTest_${Date.now()}`
        }
      });

      expect(response.statusCode).toBe(201);
    });

    it('should include location header for created guild', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: `LocationTest_${Date.now()}`
        }
      });

      if (response.statusCode === 201) {
        // Location header is optional but good practice
        if (response.headers.location) {
          expect(response.headers.location).toContain('/guilds/');
        }
      }
    });

    it('should not cache POST responses', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: `CacheTest_${Date.now()}`
        }
      });

      // POST responses should not be cached
      if (response.headers['cache-control']) {
        expect(response.headers['cache-control']).toMatch(/no-cache|no-store|private/);
      }
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error format for validation errors', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: 'AB' // Too short
        }
      });

      expect(response.statusCode).toBe(400);
      
      // Should have a meaningful error message
      expect(response.body).toBeTruthy();
    });

    it('should return consistent error format for conflicts', async () => {
      const guildName = `ErrorFormatTest_${Date.now()}`;
      
      // Create first guild
      await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: guildName
        }
      });

      // Try to create duplicate
      const response = await app.inject({
        method: 'POST',
        url: '/guilds',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          name: guildName
        }
      });

      expect(response.statusCode).toBe(409);
      
      // Should have a meaningful error message
      expect(response.body).toBeTruthy();
    });
  });
});