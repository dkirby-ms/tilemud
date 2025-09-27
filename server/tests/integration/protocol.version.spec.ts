/**
 * Integration test for protocol version negotiation
 * 
 * Tests FR-005 evolution readiness - ensures the server can handle
 * multiple protocol versions for forward/backward compatibility.
 */

import WebSocket from 'ws';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createTestServer, TestServerInstance } from '../helpers/testServer';

describe('Protocol Version Negotiation', () => {
  let server: TestServerInstance;
  let wsUrl: string;

  beforeAll(async () => {
    server = await createTestServer();
    wsUrl = `ws://localhost:${server.wsPort}`;
  });

  afterAll(async () => {
    if (server) {
      await server.cleanup();
    }
  });

  describe('WebSocket Protocol Versions', () => {
    it('should accept current protocol version', async () => {
      const ws = new WebSocket(wsUrl, [], {
        headers: {
          'Sec-WebSocket-Protocol': 'tilemud-v1.0'
        }
      });

      const connection = new Promise((resolve, reject) => {
        ws.on('open', () => {
          resolve(true);
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      await expect(connection).resolves.toBe(true);

      // Test protocol handshake
      const handshakePromise = new Promise((resolve) => {
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'protocol_handshake') {
            resolve(message);
          }
        });
      });

      ws.send(JSON.stringify({
        type: 'protocol_negotiation',
        data: { 
          version: '1.0',
          clientCapabilities: ['tile_placement', 'chat', 'heartbeat']
        }
      }));

      const handshake = await handshakePromise as any;
      expect(handshake.data.version).toBe('1.0');
      expect(handshake.data.serverCapabilities).toContain('tile_placement');
      expect(handshake.data.serverCapabilities).toContain('chat');

      ws.close();
    });

    it('should handle legacy protocol version (v0.9)', async () => {
      const ws = new WebSocket(wsUrl, [], {
        headers: {
          'Sec-WebSocket-Protocol': 'tilemud-v0.9'
        }
      });

      const connection = new Promise((resolve, reject) => {
        ws.on('open', () => resolve(true));
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      await expect(connection).resolves.toBe(true);

      // Test legacy compatibility mode
      const compatibilityPromise = new Promise((resolve) => {
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'protocol_handshake') {
            resolve(message);
          }
        });
      });

      ws.send(JSON.stringify({
        type: 'protocol_negotiation',
        data: { 
          version: '0.9',
          clientCapabilities: ['tile_placement', 'chat'] // No heartbeat support
        }
      }));

      const handshake = await compatibilityPromise as any;
      expect(handshake.data.version).toBe('0.9');
      expect(handshake.data.compatibilityMode).toBe(true);
      expect(handshake.data.deprecationWarning).toContain('upgrade');

      ws.close();
    });

    it('should support future protocol version gracefully', async () => {
      const ws = new WebSocket(wsUrl, [], {
        headers: {
          'Sec-WebSocket-Protocol': 'tilemud-v2.0'
        }
      });

      const connection = new Promise((resolve, reject) => {
        ws.on('open', () => resolve(true));
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      await expect(connection).resolves.toBe(true);

      // Test future version negotiation
      const negotiationPromise = new Promise((resolve) => {
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'protocol_handshake') {
            resolve(message);
          }
        });
      });

      ws.send(JSON.stringify({
        type: 'protocol_negotiation',
        data: { 
          version: '2.0',
          clientCapabilities: ['tile_placement', 'chat', 'heartbeat', 'future_feature']
        }
      }));

      const handshake = await negotiationPromise as any;
      // Should downgrade to supported version
      expect(handshake.data.version).toBe('1.0');
      expect(handshake.data.downgraded).toBe(true);
      expect(handshake.data.supportedVersion).toBe('1.0');

      ws.close();
    });

    it('should reject unsupported protocol versions', async () => {
      const ws = new WebSocket(wsUrl, [], {
        headers: {
          'Sec-WebSocket-Protocol': 'tilemud-v0.5'
        }
      });

      const errorPromise = new Promise((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'protocol_error') {
            resolve(message);
          }
        });
      });

      ws.send(JSON.stringify({
        type: 'protocol_negotiation',
        data: { 
          version: '0.5',
          clientCapabilities: ['basic_tiles']
        }
      }));

      const error = await errorPromise as any;
      if (error.type === 'protocol_error') {
        expect(error.data.error).toContain('unsupported');
        expect(error.data.minVersion).toBe('0.9');
        expect(error.data.maxVersion).toBe('1.0');
      } else {
        // Connection closed due to unsupported version
        expect(error.code).toBe(1002); // Protocol error close code
      }
    });
  });

  describe('HTTP API Version Negotiation', () => {
    it('should accept current API version header', async () => {
      const response = await fetch(`http://localhost:${server.httpPort}/health`, {
        headers: {
          'API-Version': '1.0'
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('API-Version')).toBe('1.0');
      
      const data = await response.json();
      expect(data.status).toBe('healthy');
    });

    it('should handle missing API version header', async () => {
      const response = await fetch(`http://localhost:${server.httpPort}/health`);

      expect(response.status).toBe(200);
      // Should default to latest version
      expect(response.headers.get('API-Version')).toBe('1.0');
    });

    it('should provide version negotiation endpoint', async () => {
      const response = await fetch(`http://localhost:${server.httpPort}/api/version`, {
        headers: {
          'API-Version': '1.0'
        }
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.currentVersion).toBe('1.0');
      expect(data.supportedVersions).toContain('0.9');
      expect(data.supportedVersions).toContain('1.0');
      expect(data.deprecatedVersions).toContain('0.9');
    });

    it('should warn about deprecated API versions', async () => {
      const response = await fetch(`http://localhost:${server.httpPort}/arenas`, {
        headers: {
          'API-Version': '0.9'
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('API-Version')).toBe('0.9');
      expect(response.headers.get('Deprecation')).toBeTruthy();
      expect(response.headers.get('Sunset')).toBeTruthy(); // RFC 8594
    });

    it('should reject unsupported API versions', async () => {
      const response = await fetch(`http://localhost:${server.httpPort}/arenas`, {
        headers: {
          'API-Version': '0.5'
        }
      });

      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.error).toContain('Unsupported API version');
      expect(data.supportedVersions).toContain('1.0');
    });
  });

  describe('Message Format Evolution', () => {
    it('should handle tile placement message format changes', async () => {
      const ws = new WebSocket(wsUrl);
      
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      // Join arena first
      ws.send(JSON.stringify({
        type: 'join_arena',
        data: { tier: 'bronze', displayName: 'ProtocolTester' }
      }));

      // Test legacy tile placement format (v0.9 style)
      ws.send(JSON.stringify({
        type: 'place_tile',
        data: { 
          position: { x: 10, y: 15 }, // Old nested format
          tileColor: 'red'            // Old property name
        },
        version: '0.9'
      }));

      // Test current tile placement format (v1.0 style)
      ws.send(JSON.stringify({
        type: 'place_tile',
        data: { 
          x: 20, 
          y: 25, 
          color: 'blue'
        },
        version: '1.0'
      }));

      // Both should be accepted and normalized
      const responses = [];
      const responsePromise = new Promise((resolve) => {
        let count = 0;
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'tiles_updated') {
            responses.push(message);
            count++;
            if (count >= 2) {
              resolve(responses);
            }
          }
        });
      });

      await responsePromise;
      expect(responses).toHaveLength(2);

      ws.close();
    });

    it('should provide schema migration information', async () => {
      const response = await fetch(`http://localhost:${server.httpPort}/api/schema-migrations`, {
        headers: {
          'API-Version': '1.0'
        }
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.migrations).toContainEqual(
        expect.objectContaining({
          fromVersion: '0.9',
          toVersion: '1.0',
          changes: expect.arrayContaining([
            expect.objectContaining({
              type: 'field_rename',
              from: 'tileColor',
              to: 'color'
            })
          ])
        })
      );
    });
  });

  describe('Capability Negotiation', () => {
    it('should negotiate WebSocket capabilities', async () => {
      const ws = new WebSocket(wsUrl);
      
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      const capabilityPromise = new Promise((resolve) => {
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'capability_negotiation') {
            resolve(message);
          }
        });
      });

      ws.send(JSON.stringify({
        type: 'capability_request',
        data: {
          requested: [
            'tile_placement',
            'chat',
            'heartbeat',
            'moderation',
            'replay_streaming', // Not yet supported
            'voice_chat'        // Not supported
          ]
        }
      }));

      const negotiation = await capabilityPromise as any;
      expect(negotiation.data.supported).toContain('tile_placement');
      expect(negotiation.data.supported).toContain('chat');
      expect(negotiation.data.supported).toContain('heartbeat');
      expect(negotiation.data.supported).toContain('moderation');
      expect(negotiation.data.unsupported).toContain('replay_streaming');
      expect(negotiation.data.unsupported).toContain('voice_chat');

      ws.close();
    });
  });
});