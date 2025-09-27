import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server, Room, Client } from 'colyseus';
import { createServer } from 'http';
import { Client as ColyseusClient } from 'colyseus.js';

/**
 * Minimal test to validate Colyseus integration
 */
class MinimalTestRoom extends Room {
  onCreate() {
    this.setState({ message: 'ready' });
  }

  onJoin(client: Client) {
    console.log('Client joined:', client.id);
  }

  onLeave(client: Client) {
    console.log('Client left:', client.id);
  }
}

/**
 * Minimal WebSocket integration test for T043
 */
describe('Minimal WebSocket Test', () => {
  let server: Server;
  let httpServer: any;
  const TEST_PORT = 3336;

  beforeAll(async () => {
    httpServer = createServer();
    server = new Server({ server: httpServer });
    server.define('minimal', MinimalTestRoom);

    await new Promise<void>((resolve) => {
      httpServer.listen(TEST_PORT, resolve);
    });
  });

  afterAll(async () => {
    if (httpServer) {
      httpServer.close();
    }
  });

  it('should connect and disconnect successfully', async () => {
    const client = new ColyseusClient(`ws://localhost:${TEST_PORT}`);
    const room = await client.joinOrCreate('minimal');
    
    expect(room).toBeDefined();
    expect(room.roomId).toBeDefined();
    
    await room.leave();
  }, 5000);
});