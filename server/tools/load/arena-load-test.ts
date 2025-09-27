#!/usr/bin/env ts-node

/**
 * Arena Load Test Script
 * 
 * Simulates 200 concurrent arena users for load testing.
 * Tests tile placement, chat messaging, and connection stability.
 * 
 * FR-002: Arena game mode (large scale PvP)
 * FR-013: Real-time monitoring and alerting
 */

import WebSocket from 'ws';
import { performance } from 'perf_hooks';

interface LoadTestConfig {
  serverUrl: string;
  concurrentUsers: number;
  testDurationMs: number;
  tilePlacementRateMs: number;
  chatMessageRateMs: number;
  heartbeatIntervalMs: number;
}

interface UserMetrics {
  userId: string;
  connected: boolean;
  tilesPlaced: number;
  messagesReceived: number;
  avgLatency: number;
  errors: number;
}

interface TestResults {
  totalUsers: number;
  successfulConnections: number;
  totalTilesPlaced: number;
  totalMessages: number;
  avgLatency: number;
  errors: Error[];
  throughputTilesPerSec: number;
  durationMs: number;
}

class ArenaLoadTest {
  private config: LoadTestConfig;
  private users: Map<string, UserMetrics> = new Map();
  private connections: Map<string, WebSocket> = new Map();
  private startTime: number = 0;
  private errors: Error[] = [];

  constructor(config: Partial<LoadTestConfig> = {}) {
    this.config = {
      serverUrl: 'ws://localhost:3000',
      concurrentUsers: 200,
      testDurationMs: 5 * 60 * 1000, // 5 minutes
      tilePlacementRateMs: 2000, // Place tile every 2 seconds
      chatMessageRateMs: 10000, // Chat every 10 seconds
      heartbeatIntervalMs: 30000, // Heartbeat every 30 seconds
      ...config
    };
  }

  async runLoadTest(): Promise<TestResults> {
    console.log(`🚀 Starting arena load test with ${this.config.concurrentUsers} users`);
    console.log(`📊 Test duration: ${this.config.testDurationMs / 1000}s`);
    console.log(`🎯 Target server: ${this.config.serverUrl}`);
    
    this.startTime = performance.now();
    
    // Create all user connections
    await this.createUsers();
    
    // Let the test run for configured duration
    await this.sleep(this.config.testDurationMs);
    
    // Clean up connections
    await this.cleanup();
    
    // Calculate and return results
    return this.generateResults();
  }

  private async createUsers(): Promise<void> {
    const connectionPromises: Promise<void>[] = [];
    
    for (let i = 0; i < this.config.concurrentUsers; i++) {
      const userId = `load_test_user_${i}`;
      connectionPromises.push(this.createUser(userId));
      
      // Stagger connections to avoid overwhelming the server
      if (i % 10 === 0 && i > 0) {
        await this.sleep(100);
      }
    }
    
    await Promise.allSettled(connectionPromises);
    console.log(`✅ Created ${this.connections.size}/${this.config.concurrentUsers} connections`);
  }

  private async createUser(userId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const userMetrics: UserMetrics = {
        userId,
        connected: false,
        tilesPlaced: 0,
        messagesReceived: 0,
        avgLatency: 0,
        errors: 0
      };
      
      this.users.set(userId, userMetrics);
      
      try {
        const ws = new WebSocket(this.config.serverUrl);
        
        ws.on('open', () => {
          userMetrics.connected = true;
          this.connections.set(userId, ws);
          
          // Join arena room
          ws.send(JSON.stringify({
            type: 'join_arena',
            data: { tier: 'bronze', displayName: userId }
          }));
          
          // Start user behaviors
          this.startUserBehaviors(userId, ws);
          resolve();
        });
        
        ws.on('message', (data) => {
          this.handleMessage(userId, data.toString());
        });
        
        ws.on('error', (error) => {
          userMetrics.errors++;
          this.errors.push(new Error(`User ${userId}: ${error.message}`));
        });
        
        ws.on('close', () => {
          userMetrics.connected = false;
          this.connections.delete(userId);
        });
        
        // Connection timeout
        setTimeout(() => {
          if (!userMetrics.connected) {
            reject(new Error(`Connection timeout for user ${userId}`));
          }
        }, 10000);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  private startUserBehaviors(userId: string, ws: WebSocket): void {
    // Tile placement behavior
    const tileInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const x = Math.floor(Math.random() * 100);
        const y = Math.floor(Math.random() * 100);
        const color = ['red', 'blue', 'green', 'yellow'][Math.floor(Math.random() * 4)];
        
        ws.send(JSON.stringify({
          type: 'place_tile',
          data: { x, y, color }
        }));
        
        const userMetrics = this.users.get(userId)!;
        userMetrics.tilesPlaced++;
      }
    }, this.config.tilePlacementRateMs);

    // Chat behavior
    const chatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'chat',
          data: {
            content: `Load test message from ${userId} at ${Date.now()}`,
            channelType: 'arena'
          }
        }));
      }
    }, this.config.chatMessageRateMs);

    // Heartbeat behavior
    const heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'heartbeat',
          data: { timestamp: Date.now() }
        }));
      }
    }, this.config.heartbeatIntervalMs);

    // Clean up intervals when connection closes
    ws.on('close', () => {
      clearInterval(tileInterval);
      clearInterval(chatInterval);
      clearInterval(heartbeatInterval);
    });
  }

  private handleMessage(userId: string, data: string): void {
    const userMetrics = this.users.get(userId)!;
    userMetrics.messagesReceived++;
    
    try {
      const message = JSON.parse(data);
      
      // Track latency for heartbeat responses
      if (message.type === 'heartbeat_ack') {
        const latency = Date.now() - message.timestamp;
        userMetrics.avgLatency = (userMetrics.avgLatency + latency) / 2;
      }
    } catch (error) {
      userMetrics.errors++;
    }
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up connections...');
    
    for (const [userId, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    
    // Wait for graceful shutdown
    await this.sleep(1000);
  }

  private generateResults(): TestResults {
    const endTime = performance.now();
    const durationMs = endTime - this.startTime;
    
    const totalTilesPlaced = Array.from(this.users.values())
      .reduce((sum, user) => sum + user.tilesPlaced, 0);
    
    const totalMessages = Array.from(this.users.values())
      .reduce((sum, user) => sum + user.messagesReceived, 0);
    
    const avgLatency = Array.from(this.users.values())
      .filter(user => user.avgLatency > 0)
      .reduce((sum, user) => sum + user.avgLatency, 0) / this.users.size;
    
    const successfulConnections = Array.from(this.users.values())
      .filter(user => user.connected || user.tilesPlaced > 0).length;
    
    const throughputTilesPerSec = totalTilesPlaced / (durationMs / 1000);

    return {
      totalUsers: this.config.concurrentUsers,
      successfulConnections,
      totalTilesPlaced,
      totalMessages,
      avgLatency,
      errors: this.errors,
      throughputTilesPerSec,
      durationMs
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI interface
async function main() {
  const config: Partial<LoadTestConfig> = {};
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];
    
    switch (key) {
      case 'server':
        config.serverUrl = value;
        break;
      case 'users':
        config.concurrentUsers = parseInt(value, 10);
        break;
      case 'duration':
        config.testDurationMs = parseInt(value, 10) * 1000;
        break;
      case 'tile-rate':
        config.tilePlacementRateMs = parseInt(value, 10);
        break;
      case 'chat-rate':
        config.chatMessageRateMs = parseInt(value, 10);
        break;
    }
  }

  const loadTest = new ArenaLoadTest(config);
  
  try {
    const results = await loadTest.runLoadTest();
    
    console.log('\n📊 Load Test Results:');
    console.log('========================');
    console.log(`Total Users: ${results.totalUsers}`);
    console.log(`Successful Connections: ${results.successfulConnections} (${(results.successfulConnections / results.totalUsers * 100).toFixed(1)}%)`);
    console.log(`Total Tiles Placed: ${results.totalTilesPlaced}`);
    console.log(`Total Messages Received: ${results.totalMessages}`);
    console.log(`Average Latency: ${results.avgLatency.toFixed(2)}ms`);
    console.log(`Throughput: ${results.throughputTilesPerSec.toFixed(2)} tiles/sec`);
    console.log(`Test Duration: ${(results.durationMs / 1000).toFixed(1)}s`);
    console.log(`Errors: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      console.log('\n❌ Errors:');
      results.errors.slice(0, 10).forEach((error, i) => {
        console.log(`  ${i + 1}. ${error.message}`);
      });
      if (results.errors.length > 10) {
        console.log(`  ... and ${results.errors.length - 10} more`);
      }
    }
    
    // Exit with error code if too many failures
    const successRate = results.successfulConnections / results.totalUsers;
    if (successRate < 0.8) {
      console.log('\n❌ Load test failed: Success rate below 80%');
      process.exit(1);
    }
    
    console.log('\n✅ Load test completed successfully');
    
  } catch (error) {
    console.error('❌ Load test failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { ArenaLoadTest, LoadTestConfig, TestResults };