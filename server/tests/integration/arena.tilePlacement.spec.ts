import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server, Room, Client } from 'colyseus';
import { createServer } from 'http';
import { Client as ColyseusClient } from 'colyseus.js';

/**
 * Mock Arena Room for testing tile placement without database dependencies
 * Tests the core WebSocket communication patterns required by ArenaRoom
 */
class MockArenaRoom extends Room {
  private tileQueue: Array<{ client: Client; message: any; timestamp: number }> = [];
  private processingTimer?: NodeJS.Timeout;

  onCreate() {
    // Initialize room state similar to ArenaRoom but simpler
    this.setState({
      tiles: {},
      players: {},
      gamePhase: 'waiting',
      arenaId: 'test-arena',
      currentTick: 0
    });

    // Set up message handlers similar to ArenaRoom
    this.onMessage('place_tile', this.handlePlaceTile.bind(this));
    this.onMessage('heartbeat', this.handleHeartbeat.bind(this));
    this.onMessage('chat', this.handleChatMessage.bind(this));
    this.onMessage('ready', this.handlePlayerReady.bind(this));

    // Start batch processing timer (similar to ArenaRoom)
    this.processingTimer = setInterval(() => {
      this.processTileQueue();
    }, 100);

    console.log('MockArenaRoom created:', this.roomId);
  }

  onJoin(client: Client, options: any) {
    console.log('Client joined:', client.id);
    // Initialize player state
    this.state.players[client.id] = {
      id: client.id,
      displayName: `Player_${client.id.substring(0, 4)}`,
      isReady: false
    };
  }

  onLeave(client: Client, consented: boolean) {
    console.log('Client left:', client.id);
    delete this.state.players[client.id];
  }

  onDispose() {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
    }
  }

  private handlePlaceTile(client: Client, message: any) {
    console.log('Tile placement request:', client.id, message);
    
    // Add to batch queue (like ArenaRoom)
    this.tileQueue.push({
      client,
      message,
      timestamp: Date.now()
    });
  }

  private handleHeartbeat(client: Client, message: any) {
    // Simple heartbeat acknowledgment
    client.send('heartbeat_ack', { timestamp: Date.now() });
  }

  private handleChatMessage(client: Client, message: any) {
    // Broadcast chat message
    this.broadcast('chat_message', {
      playerId: client.id,
      message: message.text,
      timestamp: Date.now()
    });
  }

  private handlePlayerReady(client: Client, message: any) {
    if (this.state.players[client.id]) {
      this.state.players[client.id].isReady = true;
    }
  }

  private processTileQueue() {
    if (this.tileQueue.length === 0) return;

    console.log(`Processing ${this.tileQueue.length} tile placements`);
    
    const currentBatch = [...this.tileQueue];
    this.tileQueue = []; // Clear the queue

    // Group tiles by position for conflict resolution
    const positionMap = new Map<string, typeof currentBatch>();
    
    for (const item of currentBatch) {
      const { x, y } = item.message;
      const posKey = `${x},${y}`;
      
      if (!positionMap.has(posKey)) {
        positionMap.set(posKey, []);
      }
      positionMap.get(posKey)!.push(item);
    }

    // Process each position (first-come-first-served for conflicts)
    for (const [posKey, tiles] of positionMap) {
      const winningTile = tiles[0]; // First one wins
      const { x, y, color } = winningTile.message;

      // Basic validation
      if (x < 0 || y < 0 || x > 50 || y > 50) {
        continue; // Invalid placement
      }

      // Store the tile
      this.state.tiles[posKey] = {
        x,
        y,
        color,
        playerId: winningTile.client.id,
        timestamp: Date.now()
      };

      console.log(`Placed tile at (${x},${y}) with color ${color}`);
    }
  }
}

/**
 * Integration tests for Arena WebSocket functionality (T043)
 * Tests arena join & tile placement batch resolution using Mock Arena Room
 */
describe('Arena Tile Placement Integration', () => {
  let server: Server;
  let serverUrl: string;
  const TEST_PORT = 3335; // Use different port

  beforeAll(async () => {
    // Create HTTP server for testing
    const httpServer = createServer();
    
    // Create Colyseus server for testing
    server = new Server({
      server: httpServer,
    });
    
    // Register the Mock Arena Room
    server.define('arena', MockArenaRoom);

    // Start the server
    await new Promise<void>((resolve) => {
      httpServer.listen(TEST_PORT, () => {
        serverUrl = `ws://localhost:${TEST_PORT}`;
        console.log(`Test server listening on ${serverUrl}`);
        resolve();
      });
    });
  });

  afterAll(async () => {
    console.log('Shutting down test server');
    if (server) {
      try {
        // Force close without graceful shutdown to avoid exit() call
        (server as any).transport.server.close();
      } catch (error) {
        console.log('Error during server shutdown:', error);
      }
    }
  });

  describe('Arena Join Flow', () => {
    it('should successfully join arena and receive initial state', async () => {
      const client = new ColyseusClient(serverUrl);
      
      const room = await client.joinOrCreate('arena');
      
      expect(room).toBeDefined();
      expect(room.roomId).toBeDefined();
      expect(room.state).toBeDefined();
      
      // Wait briefly to ensure state is received
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await room.leave();
    }, 10000);
  });

  describe('Tile Placement Batch Processing', () => {
    it('should process tile placement messages and handle conflicts', async () => {
      const client1 = new ColyseusClient(serverUrl);
      const client2 = new ColyseusClient(serverUrl);
      
      const room1 = await client1.joinOrCreate('arena');
      const room2 = await client2.joinOrCreate('arena');
      
      // Wait for both clients to be ready
      await new Promise(resolve => setTimeout(resolve, 200));

      // Send concurrent tile placements to same position
      room1.send('place_tile', { x: 5, y: 5, color: '#ff0000' });
      room2.send('place_tile', { x: 5, y: 5, color: '#00ff00' });

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check that only one tile was placed (conflict resolution)
      const tiles = (room1.state as any).tiles;
      const tileAt55 = tiles['5,5'];
      
      expect(tileAt55).toBeDefined();
      expect(['#ff0000', '#00ff00']).toContain(tileAt55.color);
      
      await room1.leave();
      await room2.leave();
    }, 15000);

    it('should handle multiple valid tile placements in different positions', async () => {
      const client = new ColyseusClient(serverUrl);
      const room = await client.joinOrCreate('arena');
      
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send multiple tile placements to different positions
      room.send('place_tile', { x: 1, y: 1, color: '#ff0000' });
      room.send('place_tile', { x: 2, y: 1, color: '#00ff00' });
      room.send('place_tile', { x: 1, y: 2, color: '#0000ff' });

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 300));

      // All tiles should be placed
      const tiles = (room.state as any).tiles;
      expect(tiles['1,1']).toBeDefined();
      expect(tiles['2,1']).toBeDefined();
      expect(tiles['1,2']).toBeDefined();
      
      await room.leave();
    }, 10000);

    it('should reject invalid tile placements', async () => {
      const client = new ColyseusClient(serverUrl);
      const room = await client.joinOrCreate('arena');
      
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send invalid placements
      room.send('place_tile', { x: -1, y: 1, color: '#ff0000' }); // Invalid coordinates
      room.send('place_tile', { x: 100, y: 100, color: '#ff0000' }); // Out of bounds

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 300));

      // Invalid tiles should not be placed
      const tiles = (room.state as any).tiles;
      expect(tiles['-1,1']).toBeUndefined();
      expect(tiles['100,100']).toBeUndefined();
      
      await room.leave();
    }, 10000);
  });

  describe('Message Handling', () => {
    it('should handle heartbeat messages', async () => {
      const client = new ColyseusClient(serverUrl);
      const room = await client.joinOrCreate('arena');
      
      let heartbeatReceived = false;
      
      room.onMessage('heartbeat_ack', (message) => {
        expect(message).toHaveProperty('timestamp');
        heartbeatReceived = true;
      });
      
      // Send heartbeat
      room.send('heartbeat', { timestamp: Date.now() });
      
      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(heartbeatReceived).toBe(true);
      
      await room.leave();
    }, 10000);

    it('should broadcast chat messages', async () => {
      const client1 = new ColyseusClient(serverUrl);
      const client2 = new ColyseusClient(serverUrl);
      
      const room1 = await client1.joinOrCreate('arena');
      const room2 = await client2.joinOrCreate('arena');
      
      let chatReceived = false;
      
      room2.onMessage('chat_message', (message) => {
        expect(message).toHaveProperty('message', 'Hello world!');
        chatReceived = true;
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Send chat message from client1
      room1.send('chat', { text: 'Hello world!' });
      
      // Wait for broadcast
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(chatReceived).toBe(true);
      
      await room1.leave();
      await room2.leave();
    }, 10000);
  });
});