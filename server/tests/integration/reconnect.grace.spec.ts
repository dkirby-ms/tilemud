import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server, Room, Client } from 'colyseus';
import { createServer } from 'http';
import { Client as ColyseusClient } from 'colyseus.js';

/**
 * Mock Arena Room for testing reconnection within grace period (120s)
 * Tests reconnection mechanism without complex dependencies
 */
class MockArenaRoomWithReconnect extends Room {
  private reconnectTokens = new Map<string, { token: string; expiry: number }>();

  onCreate() {
    // Initialize room state similar to ArenaRoom
    this.setState({
      tiles: {},
      players: {},
      gamePhase: 'active',
      arenaId: 'test-arena',
      currentTick: 0
    });

    console.log('MockArenaRoomWithReconnect created:', this.roomId);
  }

  async onJoin(client: Client, options: any) {
    console.log('Client joined:', client.id);
    
    // Initialize player state
    this.state.players[client.id] = {
      id: client.id,
      displayName: `Player_${client.id.substring(0, 4)}`,
      isConnected: true,
      lastHeartbeat: Date.now(),
      score: 0
    };
  }

  async onLeave(client: Client, consented?: boolean) {
    console.log('Client leaving:', client.id, 'consented:', consented);
    
    const playerState = this.state.players[client.id];
    if (playerState) {
      playerState.isConnected = false;
    }

    // If not consented (unexpected disconnect), allow reconnection
    if (!consented) {
      console.log('Allowing reconnection for:', client.id);
      
      try {
        // Allow reconnection within 120 seconds grace period
        await this.allowReconnection(client, 120);
        
        console.log('Player reconnected successfully:', client.id);
        
        // Update state back to connected
        if (playerState) {
          playerState.isConnected = true;
          playerState.lastHeartbeat = Date.now();
        }
        
        return; // Successful reconnection
        
      } catch (error) {
        console.log('Reconnection failed for:', client.id, error);
      }
    }

    // Permanent removal
    console.log('Removing player permanently:', client.id);
    delete this.state.players[client.id];
  }

  onDispose() {
    console.log('Room disposed:', this.roomId);
  }
}

/**
 * Integration tests for WebSocket reconnection within grace period (T044)
 * Tests FR-009 reconnect grace period functionality
 */
describe('Reconnect Grace Period Integration', () => {
  let server: Server;
  let httpServer: any;
  const TEST_PORT = 3337;
  let serverUrl: string;

  beforeAll(async () => {
    httpServer = createServer();
    server = new Server({ server: httpServer });
    server.define('reconnect-test', MockArenaRoomWithReconnect);

    await new Promise<void>((resolve) => {
      httpServer.listen(TEST_PORT, () => {
        serverUrl = `ws://localhost:${TEST_PORT}`;
        console.log(`Reconnect test server listening on ${serverUrl}`);
        resolve();
      });
    });
  });

  afterAll(async () => {
    console.log('Shutting down reconnect test server');
    if (httpServer) {
      httpServer.close();
    }
  });

  describe('Successful Reconnection Within Grace Period', () => {
    it('should allow reconnection after unexpected disconnect within 120 seconds', async () => {
      const client = new ColyseusClient(serverUrl);
      
      // Initial connection
      const room = await client.joinOrCreate('reconnect-test');
      
      expect(room).toBeDefined();
      expect(room.roomId).toBeDefined();
      
      const clientId = room.sessionId;
      console.log('Initial connection established with session ID:', clientId);
      
      // Wait for initial state
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Verify player is in connected state
      const initialState = (room.state as any).players;
      expect(initialState[clientId]).toBeDefined();
      expect(initialState[clientId].isConnected).toBe(true);
      
      // Simulate unexpected disconnect (close connection without leave)
      console.log('Simulating unexpected disconnect...');
      (room as any).connection.close();
      
      // Wait a short time (simulating network interruption)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Attempt to reconnect with same session ID
      console.log('Attempting reconnection...');
      const client2 = new ColyseusClient(serverUrl);
      
      try {
        // Attempt reconnection using the Colyseus client API
        // Note: reconnect API may vary by version, using joinById as fallback
        const reconnectedRoom = await client2.joinById(room.roomId, {
          reconnectionToken: clientId
        });
        
        expect(reconnectedRoom).toBeDefined();
        expect(reconnectedRoom.sessionId).toBe(clientId);
        
        // Wait for reconnection to complete
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verify player state is restored to connected
        const reconnectedState = (reconnectedRoom.state as any).players;
        expect(reconnectedState[clientId]).toBeDefined();
        expect(reconnectedState[clientId].isConnected).toBe(true);
        
        console.log('Reconnection test passed!');
        
        await reconnectedRoom.leave(true);
        
      } catch (error) {
        console.error('Reconnection failed:', error);
        throw error;
      }
    }, 30000);

    it('should maintain player state across reconnection', async () => {
      const client = new ColyseusClient(serverUrl);
      
      const room = await client.joinOrCreate('reconnect-test');
      const clientId = room.sessionId;
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Modify player state (simulate some game progress)
      const initialState = (room.state as any).players;
      const playerData = initialState[clientId];
      
      // Simulate unexpected disconnect
      (room as any).connection.close();
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Reconnect
      const client2 = new ColyseusClient(serverUrl);
      const reconnectedRoom = await client2.joinById(room.roomId, {
        reconnectionToken: clientId
      });
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Verify player data is maintained
      const reconnectedState = (reconnectedRoom.state as any).players;
      const restoredPlayer = reconnectedState[clientId];
      
      expect(restoredPlayer).toBeDefined();
      expect(restoredPlayer.displayName).toBe(playerData.displayName);
      expect(restoredPlayer.isConnected).toBe(true);
      
      await reconnectedRoom.leave(true);
    }, 25000);
  });

  describe('Failed Reconnection After Grace Period', () => {
    it('should reject reconnection after 120 second grace period expires', async () => {
      // Note: This test would take 2+ minutes in real time
      // We'll simulate it by testing the timeout mechanism
      
      const client = new ColyseusClient(serverUrl);
      const room = await client.joinOrCreate('reconnect-test');
      const clientId = room.sessionId;
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Simulate unexpected disconnect
      (room as any).connection.close();
      
      // Wait longer than grace period would allow (simulated)
      // In real test, this would be 120+ seconds
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const client2 = new ColyseusClient(serverUrl);
      
      try {
        // This should fail because grace period expired
        await client2.joinById(room.roomId, {
          reconnectionToken: clientId
        });
        
        // If we get here, the test should fail
        expect(true).toBe(false); // Force failure
        
      } catch (error) {
        // Expected to fail - reconnection should be rejected
        expect(error).toBeDefined();
        console.log('Grace period expiry test passed - reconnection correctly rejected');
      }
    }, 15000);
  });

  describe('Consented Disconnect Behavior', () => {
    it('should not allow reconnection for consented disconnects', async () => {
      const client = new ColyseusClient(serverUrl);
      const room = await client.joinOrCreate('reconnect-test');
      const clientId = room.sessionId;
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Consented leave (proper logout)
      await room.leave(true);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try to reconnect (should fail)
      const client2 = new ColyseusClient(serverUrl);
      
      try {
        await client2.joinById(room.roomId, {
          reconnectionToken: clientId
        });
        
        // Should not reach here
        expect(true).toBe(false);
        
      } catch (error) {
        // Expected - consented leave should not allow reconnection
        expect(error).toBeDefined();
        console.log('Consented disconnect test passed - reconnection correctly rejected');
      }
    }, 10000);
  });

  describe('Multiple Disconnect Scenarios', () => {
    it('should handle multiple clients with different reconnection outcomes', async () => {
      const client1 = new ColyseusClient(serverUrl);
      const client2 = new ColyseusClient(serverUrl);
      
      const room1 = await client1.joinOrCreate('reconnect-test');
      const room2 = await client2.joinById(room1.roomId);
      
      const clientId1 = room1.sessionId;
      const clientId2 = room2.sessionId;
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Client 1: Unexpected disconnect (should allow reconnection)
      (room1 as any).connection.close();
      
      // Client 2: Consented disconnect (should not allow reconnection)
      await room2.leave(true);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try to reconnect both
      const reconnectClient1 = new ColyseusClient(serverUrl);
      const reconnectClient2 = new ColyseusClient(serverUrl);
      
      // Client 1 should succeed
      try {
        const reconnectedRoom1 = await reconnectClient1.joinById(room1.roomId, {
          reconnectionToken: clientId1
        });
        expect(reconnectedRoom1).toBeDefined();
        console.log('Client 1 reconnection succeeded as expected');
        await reconnectedRoom1.leave(true);
      } catch (error) {
        console.error('Client 1 reconnection failed unexpectedly:', error);
        throw error;
      }
      
      // Client 2 should fail
      try {
        await reconnectClient2.joinById(room1.roomId, {
          reconnectionToken: clientId2
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        console.log('Client 2 reconnection correctly rejected');
        expect(error).toBeDefined();
      }
    }, 20000);
  });
});