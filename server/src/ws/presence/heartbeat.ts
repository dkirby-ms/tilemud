import { createServiceLogger } from '../../infra/monitoring/logger';
import { recordPlayerAction } from '../../infra/monitoring/metrics';
import { createSoftFailMonitor, SoftFailMonitor } from '../../application/services/softFailMonitor';
import { Client } from 'colyseus';

// Heartbeat processing types
export interface HeartbeatMessage {
  timestamp: number;
  clientInfo?: {
    userAgent?: string;
    connection?: string;
  };
}

export interface HeartbeatAck {
  timestamp: number;
  serverTime: number;
  latency: number;
  status: 'ok' | 'warning' | 'critical';
}

export interface PlayerHeartbeatData {
  playerId: string;
  lastHeartbeat: number;
  lastActivity: number;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'critical';
  latencyHistory: number[];
  missedHeartbeats: number;
  isConnected: boolean;
  reconnectAttempts: number;
}

export interface HeartbeatConfig {
  heartbeatInterval: number; // milliseconds
  heartbeatTimeout: number; // milliseconds
  maxMissedHeartbeats: number;
  reconnectGracePeriod: number; // milliseconds
  latencyHistorySize: number;
}

// Default heartbeat configuration
const DEFAULT_CONFIG: HeartbeatConfig = {
  heartbeatInterval: 30 * 1000, // 30 seconds
  heartbeatTimeout: 10 * 1000, // 10 seconds
  maxMissedHeartbeats: 3,
  reconnectGracePeriod: 120 * 1000, // 120 seconds per spec
  latencyHistorySize: 10,
};

/**
 * Shared heartbeat processing module for all room types
 * Handles heartbeat validation, latency tracking, and connection quality assessment
 */
export class HeartbeatProcessor {
  private readonly logger = createServiceLogger('HeartbeatProcessor');
  private readonly config: HeartbeatConfig;
  private readonly softFailMonitor: SoftFailMonitor;
  private readonly playerData = new Map<string, PlayerHeartbeatData>();
  private readonly roomId: string;
  private readonly roomType: string;

  // Cleanup intervals
  private cleanupInterval: NodeJS.Timeout | undefined;
  private monitoringInterval: NodeJS.Timeout | undefined;

  constructor(
    roomId: string, 
    roomType: string, 
    config: Partial<HeartbeatConfig> = {},
    softFailMonitor?: SoftFailMonitor
  ) {
    this.roomId = roomId;
    this.roomType = roomType;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Use provided monitor or create a stub one
    if (softFailMonitor) {
      this.softFailMonitor = softFailMonitor;
    } else {
      // Create stub repository for standalone usage
      const stubRepository = {
        findInstanceById: async () => null,
        createInstance: async () => ({}),
        updateInstanceStatus: async () => ({}),
        deleteInstance: async () => true,
        findInstancesByStatus: async () => [],
        findInstancesByPlayer: async () => [],
        findInstancesByRegion: async () => [],
        cleanupExpiredInstances: async () => 0,
        getInstancePlayerCount: async () => 0,
        updateInstancePlayerCount: async () => ({}),
        getInstancesByShardKey: async () => [],
        archiveInstance: async () => ({}),
        getActiveInstanceCount: async () => 0,
        getInstanceMetrics: async () => ({}),
        findByShardKeyPattern: async () => [],
        updateLastHeartbeat: async () => undefined,
      } as any;

      this.softFailMonitor = createSoftFailMonitor(stubRepository);
    }

    this.logger.info({
      event: 'heartbeat_processor_initialized',
      roomId: this.roomId,
      roomType: this.roomType,
      config: this.config,
    }, `HeartbeatProcessor initialized for ${roomType}:${roomId}`);

    this.startMonitoring();
  }

  /**
   * Process incoming heartbeat message from client
   */
  processHeartbeat(client: Client, message: HeartbeatMessage): HeartbeatAck {
    const now = Date.now();
    const playerId = client.id;
    const latency = now - message.timestamp;

    // Get or create player heartbeat data
    let playerData = this.playerData.get(playerId);
    if (!playerData) {
      playerData = this.initializePlayerData(playerId);
      this.playerData.set(playerId, playerData);
    }

    // Update player data
    playerData.lastHeartbeat = now;
    playerData.lastActivity = now;
    playerData.isConnected = true;
    playerData.missedHeartbeats = 0;
    playerData.reconnectAttempts = 0;

    // Update latency history
    playerData.latencyHistory.push(latency);
    if (playerData.latencyHistory.length > this.config.latencyHistorySize) {
      playerData.latencyHistory.shift();
    }

    // Update connection quality
    playerData.connectionQuality = this.assessConnectionQuality(playerData);

    // Record metrics
    // recordWsLatency(this.roomType, this.roomId, latency);
    recordPlayerAction('heartbeat_received', this.roomId, 'success');

    // Update soft-fail monitor
    this.softFailMonitor.updatePlayerHeartbeat(playerId, this.roomId);

    const response: HeartbeatAck = {
      timestamp: message.timestamp,
      serverTime: now,
      latency,
      status: this.getHeartbeatStatus(playerData),
    };

    this.logger.debug({
      event: 'heartbeat_processed',
      playerId,
      latency,
      connectionQuality: playerData.connectionQuality,
      avgLatency: this.getAverageLatency(playerData),
    }, `Processed heartbeat for ${playerId}`);

    return response;
  }

  /**
   * Register a new player for heartbeat monitoring
   */
  registerPlayer(playerId: string): void {
    if (!this.playerData.has(playerId)) {
      const playerData = this.initializePlayerData(playerId);
      this.playerData.set(playerId, playerData);

      this.logger.info({
        event: 'player_registered',
        playerId,
        roomId: this.roomId,
      }, `Registered player for heartbeat monitoring: ${playerId}`);
    }
  }

  /**
   * Unregister a player from heartbeat monitoring
   */
  unregisterPlayer(playerId: string): void {
    if (this.playerData.has(playerId)) {
      this.playerData.delete(playerId);

      this.logger.info({
        event: 'player_unregistered',
        playerId,
        roomId: this.roomId,
      }, `Unregistered player from heartbeat monitoring: ${playerId}`);
    }
  }

  /**
   * Mark player as disconnected (for reconnection tracking)
   */
  markPlayerDisconnected(playerId: string): void {
    const playerData = this.playerData.get(playerId);
    if (playerData) {
      playerData.isConnected = false;
      playerData.lastActivity = Date.now();

      this.logger.info({
        event: 'player_disconnected',
        playerId,
        roomId: this.roomId,
      }, `Player marked as disconnected: ${playerId}`);
    }
  }

  /**
   * Handle player reconnection attempt
   */
  handleReconnection(playerId: string): boolean {
    const playerData = this.playerData.get(playerId);
    if (!playerData) {
      return false; // Player not tracked
    }

    const now = Date.now();
    const timeSinceDisconnect = now - playerData.lastActivity;

    if (timeSinceDisconnect > this.config.reconnectGracePeriod) {
      // Grace period expired
      this.unregisterPlayer(playerId);
      return false;
    }

    // Allow reconnection
    playerData.isConnected = true;
    playerData.lastHeartbeat = now;
    playerData.lastActivity = now;
    playerData.reconnectAttempts++;
    playerData.missedHeartbeats = 0;

    this.logger.info({
      event: 'player_reconnected',
      playerId,
      roomId: this.roomId,
      reconnectAttempts: playerData.reconnectAttempts,
      gracePeriodRemaining: this.config.reconnectGracePeriod - timeSinceDisconnect,
    }, `Player reconnected: ${playerId}`);

    recordPlayerAction('reconnect_success', this.roomId, 'success');
    return true;
  }

  /**
   * Get heartbeat statistics for monitoring/debugging
   */
  getHeartbeatStats(): {
    totalPlayers: number;
    connectedPlayers: number;
    disconnectedPlayers: number;
    averageLatency: number;
    connectionQualityDistribution: Record<string, number>;
  } {
    const stats = {
      totalPlayers: this.playerData.size,
      connectedPlayers: 0,
      disconnectedPlayers: 0,
      averageLatency: 0,
      connectionQualityDistribution: {
        excellent: 0,
        good: 0,
        poor: 0,
        critical: 0,
      },
    };

    let totalLatency = 0;
    let latencyCount = 0;

    for (const [, playerData] of this.playerData) {
      if (playerData.isConnected) {
        stats.connectedPlayers++;
      } else {
        stats.disconnectedPlayers++;
      }

      stats.connectionQualityDistribution[playerData.connectionQuality]++;

      const avgLatency = this.getAverageLatency(playerData);
      if (avgLatency > 0) {
        totalLatency += avgLatency;
        latencyCount++;
      }
    }

    stats.averageLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;

    return stats;
  }

  /**
   * Clean up and dispose of the heartbeat processor
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.playerData.clear();

    this.logger.info({
      event: 'heartbeat_processor_disposed',
      roomId: this.roomId,
      roomType: this.roomType,
    }, `HeartbeatProcessor disposed for ${this.roomType}:${this.roomId}`);
  }

  // Private methods

  private initializePlayerData(playerId: string): PlayerHeartbeatData {
    return {
      playerId,
      lastHeartbeat: Date.now(),
      lastActivity: Date.now(),
      connectionQuality: 'good',
      latencyHistory: [],
      missedHeartbeats: 0,
      isConnected: true,
      reconnectAttempts: 0,
    };
  }

  private assessConnectionQuality(playerData: PlayerHeartbeatData): 'excellent' | 'good' | 'poor' | 'critical' {
    const avgLatency = this.getAverageLatency(playerData);
    
    if (avgLatency === 0) return 'good'; // No data yet
    
    if (avgLatency < 100) return 'excellent';
    if (avgLatency < 250) return 'good';
    if (avgLatency < 500) return 'poor';
    return 'critical';
  }

  private getAverageLatency(playerData: PlayerHeartbeatData): number {
    if (playerData.latencyHistory.length === 0) return 0;
    
    const sum = playerData.latencyHistory.reduce((a, b) => a + b, 0);
    return sum / playerData.latencyHistory.length;
  }

  private getHeartbeatStatus(playerData: PlayerHeartbeatData): 'ok' | 'warning' | 'critical' {
    if (playerData.connectionQuality === 'critical' || playerData.missedHeartbeats >= 2) {
      return 'critical';
    }
    
    if (playerData.connectionQuality === 'poor' || playerData.missedHeartbeats >= 1) {
      return 'warning';
    }
    
    return 'ok';
  }

  private startMonitoring(): void {
    // Cleanup stale connections
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, 60 * 1000); // Every minute

    // Monitor connection health
    this.monitoringInterval = setInterval(() => {
      this.monitorConnectionHealth();
    }, 30 * 1000); // Every 30 seconds
  }

  private cleanupStaleConnections(): void {
    const now = Date.now();
    const stalePlayerIds: string[] = [];

    for (const [playerId, playerData] of this.playerData) {
      const timeSinceLastHeartbeat = now - playerData.lastHeartbeat;
      const timeSinceLastActivity = now - playerData.lastActivity;

      // Clean up players who haven't been active beyond grace period
      if (timeSinceLastActivity > this.config.reconnectGracePeriod * 2) {
        stalePlayerIds.push(playerId);
      }
      // Mark connected players as disconnected if they've missed heartbeats
      else if (playerData.isConnected && timeSinceLastHeartbeat > this.config.heartbeatTimeout) {
        playerData.missedHeartbeats++;
        
        if (playerData.missedHeartbeats >= this.config.maxMissedHeartbeats) {
          playerData.isConnected = false;
          playerData.lastActivity = now;

          this.logger.warn({
            event: 'heartbeat_timeout',
            playerId,
            roomId: this.roomId,
            missedHeartbeats: playerData.missedHeartbeats,
            timeSinceLastHeartbeat,
          }, `Player heartbeat timeout: ${playerId}`);

          recordPlayerAction('heartbeat_timeout', this.roomId, 'failure');
        }
      }
    }

    // Remove stale players
    for (const playerId of stalePlayerIds) {
      this.unregisterPlayer(playerId);
      
      this.logger.info({
        event: 'stale_player_removed',
        playerId,
        roomId: this.roomId,
      }, `Removed stale player: ${playerId}`);
    }
  }

  private monitorConnectionHealth(): void {
    const stats = this.getHeartbeatStats();

    this.logger.debug({
      event: 'connection_health_report',
      roomId: this.roomId,
      roomType: this.roomType,
      stats,
    }, `Connection health: ${stats.connectedPlayers}/${stats.totalPlayers} connected, avg latency: ${Math.round(stats.averageLatency)}ms`);

    // Alert on high latency or many disconnections
    if (stats.averageLatency > 500 && stats.connectedPlayers > 0) {
      this.logger.warn({
        event: 'high_latency_detected',
        roomId: this.roomId,
        averageLatency: stats.averageLatency,
        connectedPlayers: stats.connectedPlayers,
      }, `High latency detected in room ${this.roomId}`);

      recordPlayerAction('high_latency_detected', this.roomId, 'failure');
    }

    if (stats.disconnectedPlayers > stats.connectedPlayers && stats.totalPlayers > 2) {
      this.logger.warn({
        event: 'high_disconnection_rate',
        roomId: this.roomId,
        disconnectedPlayers: stats.disconnectedPlayers,
        connectedPlayers: stats.connectedPlayers,
      }, `High disconnection rate detected in room ${this.roomId}`);

      recordPlayerAction('high_disconnection_detected', this.roomId, 'failure');
    }
  }
}

/**
 * Factory function to create heartbeat processor
 */
export function createHeartbeatProcessor(
  roomId: string,
  roomType: string,
  config?: Partial<HeartbeatConfig>,
  softFailMonitor?: SoftFailMonitor
): HeartbeatProcessor {
  return new HeartbeatProcessor(roomId, roomType, config, softFailMonitor);
}

/**
 * Utility function to get default heartbeat configuration
 */
export function getDefaultHeartbeatConfig(): HeartbeatConfig {
  return { ...DEFAULT_CONFIG };
}