import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server } from 'colyseus';
import { createServer } from 'http';
import { Room } from 'colyseus';
import { Client as ColyseusClient } from 'colyseus.js';

/**
 * Simple Room for testing basic WebSocket functionality
 * without complex dependencies
 */
class SimpleTestRoom extends Room {
  onCreate() {
    this.setState({ tiles: new Map() });
    
    this.onMessage('place_tile', (client, message) => {
      // Simple tile placement without complex validation
      const { x, y, color } = message;
      const tileId = `${x},${y}`;
      
      // Basic bounds checking
      if (x < 0 || y < 0 || x > 50 || y > 50) {
        return; // Invalid placement
      }
      
      // Store tile
      this.state.tiles.set(tileId, { x, y, color, playerId: client.id });
      
      // Broadcast the change
      this.broadcast('tile_placed', { x, y, color, playerId: client.id });
    });

    this.onMessage('heartbeat', (client, message) => {
      // Simple heartbeat response
      client.send('heartbeat_ack', { timestamp: Date.now() });
    });
  }
}

/**
 * Basic integration tests for WebSocket functionality (T043)
 * Tests basic WebSocket communication before complex ArenaRoom testing
 */
describe('Basic WebSocket Integration', () => {
  let server: Server;
  let serverUrl: string;
  const TEST_PORT = 3334; // Different port to avoid conflicts

  beforeAll(async () => {
    // Create HTTP server for testing
    const httpServer = createServer();
    
    // Create Colyseus server for testing
    server = new Server({
      server: httpServer,
    });
    
    // Register the simple test room
    server.define('test', SimpleTestRoom);

    // Start the server on test port
    await new Promise<void>((resolve) => {
      httpServer.listen(TEST_PORT, () => {
        serverUrl = `ws://localhost:${TEST_PORT}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await server.gracefullyShutdown();
  });

  describe('Basic Connection', () => {
    it('should successfully connect and join a room', async () => {
      const client = new ColyseusClient(serverUrl);
      const room = await client.joinOrCreate('test');
      
      expect(room).toBeDefined();
      expect(room.roomId).toBeDefined();
      
      await room.leave();
    }, 10000);
  });

  describe('Message Handling', () => {
    it('should handle tile placement messages', async () => {
      const client = new ColyseusClient(serverUrl);
      const room = await client.joinOrCreate('test');
      
      let messageReceived = false;
      
      room.onMessage('tile_placed', (message) => {
        expect(message).toHaveProperty('x', 5);
        expect(message).toHaveProperty('y', 5);
        expect(message).toHaveProperty('color', '#ff0000');
        messageReceived = true;
      });
      
      // Send tile placement
      room.send('place_tile', { x: 5, y: 5, color: '#ff0000' });
      
      // Wait for message
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(messageReceived).toBe(true);
      
      await room.leave();
    }, 10000);

    it('should handle heartbeat messages', async () => {
      const client = new ColyseusClient(serverUrl);
      const room = await client.joinOrCreate('test');
      
      let heartbeatReceived = false;
      
      room.onMessage('heartbeat_ack', (message) => {
        expect(message).toHaveProperty('timestamp');
        heartbeatReceived = true;
      });
      
      // Send heartbeat
      room.send('heartbeat', { timestamp: Date.now() });
      
      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(heartbeatReceived).toBe(true);
      
      await room.leave();
    }, 10000);
  });

  describe('Multi-client Communication', () => {
    it('should broadcast messages between clients', async () => {
      const client1 = new ColyseusClient(serverUrl);
      const client2 = new ColyseusClient(serverUrl);
      
      const room1 = await client1.joinOrCreate('test');
      const room2 = await client2.joinOrCreate('test');
      
      let client2ReceivedMessage = false;
      
      room2.onMessage('tile_placed', (message) => {
        expect(message).toHaveProperty('x', 3);
        expect(message).toHaveProperty('y', 3);
        expect(message).toHaveProperty('color', '#00ff00');
        client2ReceivedMessage = true;
      });
      
      // Client 1 sends message
      room1.send('place_tile', { x: 3, y: 3, color: '#00ff00' });
      
      // Wait for broadcast
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(client2ReceivedMessage).toBe(true);
      
      await room1.leave();
      await room2.leave();
    }, 10000);
  });
});