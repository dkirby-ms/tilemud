#!/usr/bin/env ts-node

/**
 * Battle Room Load Test Script
 * 
 * Simulates concurrent battle room instances with conflict resolution testing.
 * Tests high-frequency tile placement conflicts and AI entity interactions.
 * 
 * FR-001: Battle game mode (instanced conflict resolution)
 * FR-004: AI elasticity and dynamic spawn balancing
 * FR-013: Real-time monitoring and alerting
 */

import WebSocket from 'ws';
import { performance } from 'perf_hooks';

interface BattleLoadTestConfig {
  serverUrl: string;
  battleInstances: number;
  playersPerBattle: number;
  testDurationMs: number;
  conflictIntensityMs: number; // Lower = more conflicts
  aiSpawnTriggerThreshold: number;
}

interface BattleMetrics {
  instanceId: string;
  connectedPlayers: number;
  totalConflicts: number;
  aiEntitiesSpawned: number;
  avgResolutionTime: number;
  throughputActionsPerSec: number;
  errors: number;
}

interface BattleTestResults {
  totalBattles: number;
  totalPlayers: number;
  successfulBattles: number;
  totalConflicts: number;
  totalAiSpawns: number;
  avgResolutionTime: number;
  peakThroughput: number;
  errors: Error[];
}

class BattleLoadTest {
  private config: BattleLoadTestConfig;
  private battles: Map<string, BattleMetrics> = new Map();
  private connections: Map<string, WebSocket> = new Map();
  private errors: Error[] = [];
  private startTime: number = 0;

  constructor(config: Partial<BattleLoadTestConfig> = {}) {
    this.config = {
      serverUrl: 'ws://localhost:3000',
      battleInstances: 10,
      playersPerBattle: 8,
      testDurationMs: 3 * 60 * 1000, // 3 minutes
      conflictIntensityMs: 500, // Very aggressive - create conflicts
      aiSpawnTriggerThreshold: 4, // Spawn AI when 4+ players leave
      ...config
    };
  }

  async runBattleLoadTest(): Promise<BattleTestResults> {
    console.log(`⚔️  Starting battle room load test`);
    console.log(`🏟️  Battle instances: ${this.config.battleInstances}`);
    console.log(`👥 Players per battle: ${this.config.playersPerBattle}`);
    console.log(`💥 Conflict intensity: ${this.config.conflictIntensityMs}ms`);
    console.log(`🤖 AI spawn threshold: ${this.config.aiSpawnTriggerThreshold} players`);
    
    this.startTime = performance.now();
    
    // Create battle instances
    await this.createBattleInstances();
    
    // Run test for configured duration
    await this.sleep(this.config.testDurationMs);
    
    // Cleanup
    await this.cleanup();
    
    return this.generateResults();
  }

  private async createBattleInstances(): Promise<void> {
    const battlePromises: Promise<void>[] = [];
    
    for (let i = 0; i < this.config.battleInstances; i++) {
      const instanceId = `battle_instance_${i}`;
      battlePromises.push(this.createBattleInstance(instanceId));
      
      // Stagger battle creation
      if (i % 3 === 0 && i > 0) {
        await this.sleep(200);
      }
    }
    
    await Promise.allSettled(battlePromises);
    console.log(`✅ Created ${this.battles.size} battle instances`);
  }

  private async createBattleInstance(instanceId: string): Promise<void> {
    const battleMetrics: BattleMetrics = {
      instanceId,
      connectedPlayers: 0,
      totalConflicts: 0,
      aiEntitiesSpawned: 0,
      avgResolutionTime: 0,
      throughputActionsPerSec: 0,
      errors: 0
    };
    
    this.battles.set(instanceId, battleMetrics);
    
    // Create players for this battle
    const playerPromises: Promise<void>[] = [];
    for (let p = 0; p < this.config.playersPerBattle; p++) {
      const playerId = `${instanceId}_player_${p}`;
      playerPromises.push(this.createBattlePlayer(playerId, instanceId, battleMetrics));
    }
    
    await Promise.allSettled(playerPromises);
  }

  private async createBattlePlayer(playerId: string, instanceId: string, metrics: BattleMetrics): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.config.serverUrl);
        
        ws.on('open', () => {
          metrics.connectedPlayers++;
          this.connections.set(playerId, ws);
          
          // Join battle room
          ws.send(JSON.stringify({
            type: 'join_battle',
            data: { 
              instanceId, 
              battleType: 'small',
              displayName: playerId 
            }
          }));
          
          // Start aggressive conflict-generating behavior
          this.startConflictBehavior(playerId, ws, metrics);
          resolve();
        });
        
        ws.on('message', (data) => {
          this.handleBattleMessage(playerId, data.toString(), metrics);
        });
        
        ws.on('error', (error) => {
          metrics.errors++;
          this.errors.push(new Error(`Battle ${instanceId}, Player ${playerId}: ${error.message}`));
        });
        
        ws.on('close', () => {
          metrics.connectedPlayers--;
          this.connections.delete(playerId);
          
          // Trigger AI spawn if enough players leave
          if (metrics.connectedPlayers <= this.config.aiSpawnTriggerThreshold) {
            this.triggerAiSpawn(instanceId, ws);
          }
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }

  private startConflictBehavior(playerId: string, ws: WebSocket, metrics: BattleMetrics): void {
    // Create intentional conflicts by targeting the same coordinates
    const conflictZones = [
      { x: 50, y: 50 }, // Center hotspot
      { x: 25, y: 25 }, // Corner hotspot
      { x: 75, y: 75 }  // Another corner
    ];

    const conflictInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        // 70% chance to target a conflict zone, 30% random
        const targetConflictZone = Math.random() < 0.7;
        let x, y;
        
        if (targetConflictZone) {
          const zone = conflictZones[Math.floor(Math.random() * conflictZones.length)];
          // Add small random offset to create realistic conflicts
          x = zone.x + (Math.random() * 6 - 3); // ±3 pixel variance
          y = zone.y + (Math.random() * 6 - 3);
        } else {
          x = Math.floor(Math.random() * 100);
          y = Math.floor(Math.random() * 100);
        }
        
        const startTime = performance.now();
        const color = ['red', 'blue', 'green', 'yellow', 'purple'][Math.floor(Math.random() * 5)];
        
        ws.send(JSON.stringify({
          type: 'place_tile',
          data: { x: Math.floor(x), y: Math.floor(y), color },
          timestamp: startTime
        }));
      }
    }, this.config.conflictIntensityMs);

    // Cleanup on disconnect
    ws.on('close', () => {
      clearInterval(conflictInterval);
    });
  }

  private handleBattleMessage(playerId: string, data: string, metrics: BattleMetrics): void {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'tile_rejected':
          metrics.totalConflicts++;
          // Measure conflict resolution time
          if (message.timestamp) {
            const resolutionTime = performance.now() - message.timestamp;
            metrics.avgResolutionTime = (metrics.avgResolutionTime + resolutionTime) / 2;
          }
          break;
          
        case 'tiles_updated':
          // Update throughput calculation
          if (message.tiles && message.tiles.length > 0) {
            const currentThroughput = message.tiles.length / (this.config.conflictIntensityMs / 1000);
            metrics.throughputActionsPerSec = Math.max(metrics.throughputActionsPerSec, currentThroughput);
          }
          break;
          
        case 'ai_entity_spawned':
          metrics.aiEntitiesSpawned++;
          break;
          
        case 'battle_resolved':
          console.log(`🏆 Battle ${metrics.instanceId} resolved: ${message.winner || 'draw'}`);
          break;
      }
      
    } catch (error) {
      metrics.errors++;
      this.errors.push(new Error(`Message parsing error for ${playerId}: ${error}`));
    }
  }

  private triggerAiSpawn(instanceId: string, ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'request_ai_spawn',
        data: { 
          reason: 'player_shortage',
          preferredType: 'aggressive' 
        }
      }));
    }
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up battle connections...');
    
    for (const [playerId, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    
    await this.sleep(1000);
  }

  private generateResults(): BattleTestResults {
    const battles = Array.from(this.battles.values());
    
    const totalConflicts = battles.reduce((sum, b) => sum + b.totalConflicts, 0);
    const totalAiSpawns = battles.reduce((sum, b) => sum + b.aiEntitiesSpawned, 0);
    const avgResolutionTime = battles
      .filter(b => b.avgResolutionTime > 0)
      .reduce((sum, b) => sum + b.avgResolutionTime, 0) / battles.length;
    const peakThroughput = Math.max(...battles.map(b => b.throughputActionsPerSec));
    const successfulBattles = battles.filter(b => b.connectedPlayers > 0 || b.totalConflicts > 0).length;

    return {
      totalBattles: this.config.battleInstances,
      totalPlayers: this.config.battleInstances * this.config.playersPerBattle,
      successfulBattles,
      totalConflicts,
      totalAiSpawns,
      avgResolutionTime,
      peakThroughput,
      errors: this.errors
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI interface
async function main() {
  const config: Partial<BattleLoadTestConfig> = {};
  
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];
    
    switch (key) {
      case 'server':
        config.serverUrl = value;
        break;
      case 'battles':
        config.battleInstances = parseInt(value, 10);
        break;
      case 'players':
        config.playersPerBattle = parseInt(value, 10);
        break;
      case 'duration':
        config.testDurationMs = parseInt(value, 10) * 1000;
        break;
      case 'intensity':
        config.conflictIntensityMs = parseInt(value, 10);
        break;
    }
  }

  const loadTest = new BattleLoadTest(config);
  
  try {
    const results = await loadTest.runBattleLoadTest();
    
    console.log('\n⚔️  Battle Load Test Results:');
    console.log('===============================');
    console.log(`Battle Instances: ${results.totalBattles}`);
    console.log(`Total Players: ${results.totalPlayers}`);
    console.log(`Successful Battles: ${results.successfulBattles} (${(results.successfulBattles / results.totalBattles * 100).toFixed(1)}%)`);
    console.log(`Total Conflicts: ${results.totalConflicts}`);
    console.log(`AI Entities Spawned: ${results.totalAiSpawns}`);
    console.log(`Avg Conflict Resolution: ${results.avgResolutionTime.toFixed(2)}ms`);
    console.log(`Peak Throughput: ${results.peakThroughput.toFixed(2)} actions/sec`);
    console.log(`Errors: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      console.log('\n❌ Errors:');
      results.errors.slice(0, 5).forEach((error, i) => {
        console.log(`  ${i + 1}. ${error.message}`);
      });
      if (results.errors.length > 5) {
        console.log(`  ... and ${results.errors.length - 5} more`);
      }
    }
    
    // Success criteria for battle tests
    const successRate = results.successfulBattles / results.totalBattles;
    const avgConflictsPerBattle = results.totalConflicts / results.totalBattles;
    
    if (successRate < 0.8 || avgConflictsPerBattle < 10) {
      console.log('\n❌ Battle load test failed: Insufficient conflict generation or low success rate');
      process.exit(1);
    }
    
    console.log('\n✅ Battle load test completed successfully');
    
  } catch (error) {
    console.error('❌ Battle load test failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { BattleLoadTest, BattleLoadTestConfig, BattleTestResults };