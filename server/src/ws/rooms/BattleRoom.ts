import { Room, Client } from 'colyseus';
import { Schema, MapSchema, type } from '@colyseus/schema';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { 
  recordPlayerAction, 
  updatePlayerCount 
} from '../../infra/monitoring/metrics';
import { createSoftFailMonitor, SoftFailMonitor } from '../../application/services/softFailMonitor';
import { createRuleConfigService, RuleConfigService, RuleVersionStamp } from '../../application/services/ruleConfigService';

// Room state schemas

export class TileState extends Schema {
  @type('string') playerId!: string;
  @type('number') x!: number;
  @type('number') y!: number;
  @type('string') color!: string;
  @type('number') timestamp!: number;
}

export class PlayerState extends Schema {
  @type('string') id!: string;
  @type('string') displayName!: string;
  @type('boolean') isReady: boolean = false;
  @type('boolean') isConnected: boolean = true;
  @type('number') tileCount: number = 0;
  @type('number') lastHeartbeat!: number;
  @type('number') lastSeen?: number;
}

export class AIEntityState extends Schema {
  @type('string') id!: string;
  @type('string') type!: string;
  @type('string') behavior!: string;
  @type('number') spawnedAt!: number;
  @type('boolean') isActive: boolean = true;
}

export class BattleState extends Schema {
  @type('string') instanceId!: string;
  @type('string') mode: string = 'battle';
  @type('string') battleType: 'small' | 'standard' = 'small'; // 8 vs 16 players
  @type('boolean') isActive: boolean = false;
  @type('string') state: 'pending' | 'active' | 'resolved' | 'aborted' = 'pending';
  @type('number') currentTick: number = 0;
  @type('string') region!: string;
  @type('string') shardKey!: string;
  @type('string') ruleConfigVersion!: string;
  @type('number') startedAt?: number;
  @type('number') resolvedAt?: number;
  @type('number') initialHumanCount: number = 0;
  @type({ map: TileState }) tiles = new MapSchema<TileState>();
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: AIEntityState }) aiEntities = new MapSchema<AIEntityState>();
}

// Message types
interface HeartbeatMessage {
  timestamp: number;
}

interface PlaceTileMessage {
  x: number;
  y: number;
  color: string;
}

interface ChatMessage {
  message: string;
  channelType: 'battle' | 'party' | 'private';
  targetId?: string; // For private messages
}

interface ReadyMessage {
  ready: boolean;
}

export class BattleRoom extends Room<BattleState> {
  private readonly TICK_RATE_MS = 1000; // 1 second tick rate for battles
  private readonly MAX_BATTLE_DURATION_MS = 30 * 60 * 1000; // 30 minutes max
  private readonly QUORUM_THRESHOLD = 0.5; // 50% minimum to continue battle

  private readonly logger = createServiceLogger('BattleRoom');
  private readonly roomLogger = this.logger.child({ roomId: this.roomId });

  // Service dependencies
  private readonly softFailMonitor: SoftFailMonitor;
  private readonly ruleConfigService: RuleConfigService;
  // private readonly aiElasticityMonitor: AiElasticityMonitor;
  // private readonly chatDeliveryDispatcher: ChatDeliveryDispatcher;

  // Conflict batching - key difference from ArenaRoom
  private readonly conflictBatchQueue: Array<{
    client: Client;
    message: PlaceTileMessage;
    timestamp: number;
  }> = [];
  
  // Performance tracking
  private conflictCount = 0;
  private battleTimer: NodeJS.Timeout | undefined;

  // Rule version tracking
  private currentRuleStamp?: RuleVersionStamp;

  constructor() {
    super();

    // Initialize services with stub repository
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
    this.ruleConfigService = createRuleConfigService();
    // this.aiElasticityMonitor = createAiElasticityMonitor();
    // this.chatDeliveryDispatcher = createChatDeliveryDispatcher();

    this.roomLogger.info({
      event: 'battle_room_initialized',
      roomId: this.roomId,
    }, `BattleRoom initialized: ${this.roomId}`);
  }

  override async onCreate(options: any) {
    this.roomLogger.info({
      event: 'battle_room_created',
      options,
    }, `Creating battle room with options: ${JSON.stringify(options)}`);

    // Initialize battle state
    this.state = new BattleState();
    this.state.instanceId = options.instanceId || `battle-${this.roomId}`;
    this.state.battleType = options.battleType || 'small';
    this.state.region = options.region || 'us-east-1';
    this.state.shardKey = options.shardKey || `battle|${this.state.region}|${this.roomId}`;

    // Initialize rule configuration version stamping
    await this.initializeRuleVersion(options.ruleConfigVersion);

    // Set max clients based on battle type
    this.maxClients = this.getMaxPlayersByType(this.state.battleType);
    
    this.roomLogger.info({
      event: 'battle_configured',
      instanceId: this.state.instanceId,
      battleType: this.state.battleType,
      maxClients: this.maxClients,
      region: this.state.region,
      ruleConfigVersion: this.state.ruleConfigVersion,
    }, `Battle configured: ${this.state.battleType} (max ${this.maxClients} players)`);

    // Set up message handlers using Colyseus onMessage pattern
    this.onMessage('heartbeat', this.handleHeartbeat.bind(this));
    this.onMessage('place_tile', this.handlePlaceTile.bind(this));
    this.onMessage('chat', this.handleChatMessage.bind(this));
    this.onMessage('ready', this.handlePlayerReady.bind(this));

    // Set up conflict batching interval
    this.setSimulationInterval(() => this.processBattleTick(), this.TICK_RATE_MS);

    // Start battle timeout
    this.battleTimer = setTimeout(() => {
      this.resolveBattle('timeout');
    }, this.MAX_BATTLE_DURATION_MS);

    try {
      // Mock service initialization - replace with actual implementation
      // await this.softFailMonitor.initializeSession(this.state.instanceId, this.maxClients);
      // await this.aiElasticityMonitor.registerBattle(this.state.instanceId, this.state.battleType, this.maxClients);

      recordPlayerAction('battle_created', this.state.instanceId, 'success');

    } catch (error) {
      this.roomLogger.error({
        event: 'service_initialization_failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Failed to initialize services: ${error}`);

      recordPlayerAction('battle_created', this.state.instanceId, 'failure');
      throw error;
    }
  }

  override async onAuth(client: Client, options: any) {
    this.roomLogger.debug({
      event: 'auth_attempt',
      clientId: client.id,
      options,
    }, `Authentication attempt for client: ${client.id}`);

    // TODO: Implement proper session ticket validation
    if (!options.sessionTicket) {
      this.roomLogger.warn({
        event: 'auth_failed_no_ticket',
        clientId: client.id,
      }, `Authentication failed - no session ticket`);
      return false;
    }

    try {
      // Mock validation - replace with actual service call
      const isValid = typeof options.sessionTicket === 'string' && 
                     options.sessionTicket.length > 0;

      if (isValid) {
        this.roomLogger.info({
          event: 'auth_success',
          clientId: client.id,
        }, `Authentication successful for ${client.id}`);
        return { 
          playerId: client.id, 
          displayName: options.displayName || client.id.substring(0, 8) 
        };
      } else {
        this.roomLogger.warn({
          event: 'auth_failed_invalid_ticket',
          clientId: client.id,
        }, `Authentication failed - invalid session ticket`);
        return false;
      }

    } catch (error) {
      this.roomLogger.error({
        event: 'auth_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Authentication error for ${client.id}: ${error}`);
      return false;
    }
  }

  override async onJoin(client: Client, _options: any, auth: any) {
    try {
      this.roomLogger.info({
        event: 'player_joined',
        clientId: client.id,
        auth,
        currentPlayers: this.clients.length,
      }, `Player joined battle: ${client.id} (${auth?.displayName})`);

      // Create player state
      const playerState = new PlayerState();
      playerState.id = client.id;
      playerState.displayName = auth?.displayName || client.id.substring(0, 8);
      playerState.lastHeartbeat = Date.now();
      playerState.isConnected = true;

      this.state.players.set(client.id, playerState);

      // Track initial human count for quorum logic
      if (this.state.state === 'pending') {
        this.state.initialHumanCount = this.clients.length;
      }

      // Update monitoring services
      updatePlayerCount(this.state.instanceId, this.state.battleType, this.clients.length);
      // this.aiElasticityMonitor.updateArenaPlayerCount(this.state.instanceId, this.clients.length, this.maxClients);

      // Register player with soft-fail monitoring 
      // this.softFailMonitor.registerPlayer(client.id, this.state.instanceId);

      // Auto-start battle if at capacity or all players ready
      await this.checkBattleStart();

      recordPlayerAction('join', this.state.instanceId, 'success');

    } catch (error) {
      this.roomLogger.error({
        event: 'join_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Error during player join: ${client.id}`);

      recordPlayerAction('join', this.state.instanceId, 'failure');
      throw error;
    }
  }

  // Message handlers

  private handleHeartbeat(client: Client, message: HeartbeatMessage) {
    const now = Date.now();
    const latency = now - message.timestamp;
    
    // recordWsLatency(latency); // TODO: fix API signature
    
    const playerState = this.state.players.get(client.id);
    if (playerState) {
      playerState.lastHeartbeat = now;
    }

    // this.softFailMonitor.updatePlayerHeartbeat(client.id, this.state.instanceId);
    
    client.send('heartbeat_ack', { timestamp: now, latency });
  }

  private handlePlaceTile(client: Client, message: PlaceTileMessage) {
    if (!this.isValidTilePosition(message.x, message.y)) {
      client.send('tile_rejected', {
        x: message.x,
        y: message.y,
        reason: 'Invalid position',
      });
      return;
    }

    if (this.state.state !== 'active') {
      client.send('tile_rejected', {
        x: message.x,
        y: message.y,
        reason: 'Battle not active',
      });
      return;
    }

    // Queue for conflict batching instead of immediate processing
    this.conflictBatchQueue.push({
      client,
      message,
      timestamp: Date.now(),
    });

    recordPlayerAction('tile_place_queued', this.state.instanceId, 'success');
  }

  private async handleChatMessage(client: Client, message: ChatMessage) {
    try {
      // TODO: Fix chat delivery API
      // await this.chatDeliveryDispatcher.deliverMessage({
      //   senderId: client.id,
      //   channelType: message.channelType,
      //   content: message.message,
      //   targetId: message.targetId,
      //   instanceId: this.state.instanceId,
      // });

      // Broadcast to battle participants
      if (message.channelType === 'battle') {
        this.broadcast('chat_message', {
          senderId: client.id,
          senderName: this.state.players.get(client.id)?.displayName,
          message: message.message,
          timestamp: Date.now(),
        });
      }

      recordPlayerAction('chat_sent', this.state.instanceId, 'success');

    } catch (error) {
      this.roomLogger.error({
        event: 'chat_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Chat delivery failed: ${error}`);

      recordPlayerAction('chat_sent', this.state.instanceId, 'failure');
    }
  }

  private async handlePlayerReady(client: Client, message: ReadyMessage) {
    const playerState = this.state.players.get(client.id);
    if (playerState) {
      playerState.isReady = message.ready;
      
      this.roomLogger.info({
        event: 'player_ready_changed',
        clientId: client.id,
        ready: message.ready,
      }, `Player ${client.id} ready state: ${message.ready}`);

      // Check if battle can start
      await this.checkBattleStart();
    }
  }

  override async onLeave(client: Client, consented: boolean = false) {
    try {
      this.roomLogger.info({
        event: 'player_left',
        clientId: client.id,
        consented,
        remainingPlayers: this.clients.length - 1,
      }, `Player left battle: ${client.id}`);

      // Update player state
      const playerState = this.state.players.get(client.id);
      if (playerState) {
        playerState.isConnected = false;
        playerState.lastSeen = Date.now();
      }

      // Check for reconnection grace period only if battle is active
      if (!consented && this.state.state === 'active') {
        this.roomLogger.debug({
          event: 'allowing_reconnection',
          clientId: client.id,
        }, `Allowing reconnection for ${client.id}`);

        try {
          // Allow reconnection within grace period
          await this.allowReconnection(client, 120); // 120 seconds grace period
          
          this.roomLogger.info({
            event: 'player_reconnected',
            clientId: client.id,
          }, `Player reconnected: ${client.id}`);

          // Update state back to connected
          if (playerState) {
            playerState.isConnected = true;
            playerState.lastHeartbeat = Date.now();
          }

          // Update heartbeat monitoring
          this.softFailMonitor.updatePlayerHeartbeat(client.id, this.state.instanceId);
          
          return; // Early return for successful reconnection

        } catch (reconnectError) {
          this.roomLogger.warn({
            event: 'reconnection_failed',
            clientId: client.id,
            error: reconnectError instanceof Error ? reconnectError.message : 'Unknown error',
          }, `Reconnection failed for ${client.id}`);
        }
      }

      // Remove player permanently
      this.state.players.delete(client.id);

      // Update monitoring services
      updatePlayerCount(this.state.instanceId, this.state.battleType, this.clients.length);
      // this.aiElasticityMonitor.updateArenaPlayerCount(this.state.instanceId, this.clients.length, this.maxClients);

      // Clean up soft-fail monitoring
      this.softFailMonitor.cleanupSessionData(this.state.instanceId, [client.id]);

      // Check quorum and potentially abort battle
      await this.checkQuorumAndAbort();

      recordPlayerAction('leave', this.state.instanceId, 'success');

    } catch (error) {
      this.roomLogger.error({
        event: 'leave_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Error during player leave: ${client.id}`);

      recordPlayerAction('leave', this.state.instanceId, 'failure');
    }
  }

  override onDispose() {
    this.roomLogger.info({
      event: 'battle_room_disposed',
      roomId: this.roomId,
      finalPlayerCount: this.clients.length,
      totalTicks: this.state.currentTick,
      finalState: this.state.state,
    }, `Battle room disposed: ${this.roomId}`);

    // Clean up battle timer
    if (this.battleTimer) {
      clearTimeout(this.battleTimer);
    }

    // Clean up monitoring services
    // this.aiElasticityMonitor.cleanupBattleData(this.state.instanceId);
    this.softFailMonitor.cleanupSessionData(
      this.state.instanceId,
      Array.from(this.state.players.keys())
    );
  }

  // Battle-specific tick processing with conflict batching
  private processBattleTick() {
    if (this.state.state !== 'active') return;

    this.state.currentTick++;
    
    // Process conflict batch - key difference from Arena
    this.processConflictBatch();
    
    // Check for battle end conditions
    this.checkBattleEndConditions();

    // Update monitoring metrics periodically
    if (this.state.currentTick % 60 === 0) { // Every 60 ticks (~1 minute at 1 tick/sec)
      updatePlayerCount(this.state.instanceId, this.state.battleType, this.clients.length);
    }
  }

  // Conflict batching - process all queued tile placements at once
  private processConflictBatch() {
    if (this.conflictBatchQueue.length === 0) return;

    // Group by position for conflict resolution
    const positionGroups = new Map<string, Array<{
      client: Client;
      message: PlaceTileMessage;
      timestamp: number;
    }>>();

    // Drain the queue into position groups
    while (this.conflictBatchQueue.length > 0) {
      const entry = this.conflictBatchQueue.shift()!;
      const positionKey = `${entry.message.x},${entry.message.y}`;
      
      if (!positionGroups.has(positionKey)) {
        positionGroups.set(positionKey, []);
      }
      positionGroups.get(positionKey)!.push(entry);
    }

    const successfulPlacements: Array<{
      tileId: string;
      x: number;
      y: number;
      playerId: string;
      color: string;
    }> = [];

    // Process each position group
    for (const [positionKey, conflictingEntries] of positionGroups) {
      // Check if position is already occupied
      const existingTile = this.state.tiles.get(positionKey);
      if (existingTile) {
        // Reject all attempts for occupied position
        for (const entry of conflictingEntries) {
          this.conflictCount++;
          entry.client.send('tile_rejected', {
            x: entry.message.x,
            y: entry.message.y,
            reason: 'Position occupied',
          });
        }
        continue;
      }

      if (conflictingEntries.length === 1) {
        // No conflict - place the tile
        const entry = conflictingEntries[0];
        if (entry) {
          this.placeTile(entry, positionKey, successfulPlacements);
        }
      } else {
        // Multiple attempts for same position - resolve conflict
        // Rule: earliest timestamp wins
        conflictingEntries.sort((a, b) => a.timestamp - b.timestamp);
        const winner = conflictingEntries[0];
        const losers = conflictingEntries.slice(1);

        // Place winner's tile
        if (winner) {
          this.placeTile(winner, positionKey, successfulPlacements);
        }

        // Reject losers
        for (const loser of losers) {
          this.conflictCount++;
          loser.client.send('tile_rejected', {
            x: loser.message.x,
            y: loser.message.y,
            reason: 'Conflict lost (timing)',
          });
        }
      }
    }

    // Broadcast all successful placements in batch
    if (successfulPlacements.length > 0) {
      this.broadcast('tiles_updated', {
        tiles: successfulPlacements,
        tick: this.state.currentTick,
        conflictsResolved: this.conflictCount,
      });

      this.roomLogger.debug({
        event: 'batch_processed',
        placementsCount: successfulPlacements.length,
        conflictsCount: this.conflictCount,
        tick: this.state.currentTick,
      }, `Processed tile batch: ${successfulPlacements.length} placed, ${this.conflictCount} conflicts`);
    }
  }

  private placeTile(
    entry: { client: Client; message: PlaceTileMessage; timestamp: number },
    positionKey: string,
    successfulPlacements: Array<any>
  ) {
    const tileState = new TileState();
    tileState.playerId = entry.client.id;
    tileState.x = entry.message.x;
    tileState.y = entry.message.y;
    tileState.color = entry.message.color;
    tileState.timestamp = entry.timestamp;
    
    this.state.tiles.set(positionKey, tileState);

    // Update player tile count
    const playerState = this.state.players.get(entry.client.id);
    if (playerState) {
      playerState.tileCount++;
    }

    successfulPlacements.push({
      tileId: positionKey,
      x: entry.message.x,
      y: entry.message.y,
      playerId: entry.client.id,
      color: entry.message.color,
    });

    recordPlayerAction('tile_placed', this.state.instanceId, 'success');
  }

  private async checkBattleStart() {
    if (this.state.state !== 'pending') return;

    const allReady = Array.from(this.state.players.values()).every(p => p.isReady);
    const hasMinimumPlayers = this.clients.length >= 2; // Minimum for a battle
    const isAtCapacity = this.clients.length >= this.maxClients;

    if ((allReady && hasMinimumPlayers) || isAtCapacity) {
      this.state.state = 'active';
      this.state.isActive = true;
      this.state.startedAt = Date.now();

      this.roomLogger.info({
        event: 'battle_started',
        instanceId: this.state.instanceId,
        playerCount: this.clients.length,
        allReady,
        isAtCapacity,
      }, `Battle started: ${this.state.instanceId}`);

      this.broadcast('battle_started', {
        instanceId: this.state.instanceId,
        playerCount: this.clients.length,
        tick: this.state.currentTick,
      });

      recordPlayerAction('battle_started', this.state.instanceId, 'success');
    }
  }

  private async checkQuorumAndAbort() {
    if (this.state.state !== 'active') return;

    const currentPlayerCount = this.clients.length;
    const quorumMet = currentPlayerCount >= (this.state.initialHumanCount * this.QUORUM_THRESHOLD);

    if (!quorumMet) {
      this.roomLogger.warn({
        event: 'quorum_lost',
        instanceId: this.state.instanceId,
        currentPlayers: currentPlayerCount,
        initialPlayers: this.state.initialHumanCount,
        quorumThreshold: this.QUORUM_THRESHOLD,
      }, `Quorum lost, aborting battle`);

      await this.resolveBattle('quorum_lost');
    }
  }

  private checkBattleEndConditions() {
    // TODO: Implement battle-specific end conditions
    // For now, just check for empty battle
    if (this.clients.length === 0) {
      this.resolveBattle('empty');
    }
  }

  private async resolveBattle(reason: string) {
    if (this.state.state === 'resolved' || this.state.state === 'aborted') return;

    this.state.state = reason === 'empty' || reason === 'quorum_lost' ? 'aborted' : 'resolved';
    this.state.isActive = false;
    this.state.resolvedAt = Date.now();

    this.roomLogger.info({
      event: 'battle_resolved',
      instanceId: this.state.instanceId,
      reason,
      finalPlayerCount: this.clients.length,
      totalTicks: this.state.currentTick,
      duration: this.state.resolvedAt - (this.state.startedAt || 0),
      ruleConfigVersion: this.state.ruleConfigVersion,
      ruleStamp: this.currentRuleStamp,
    }, `Battle resolved: ${reason} with rule version ${this.state.ruleConfigVersion}`);

    // Broadcast resolution to all players
    this.broadcast('battle_resolved', {
      instanceId: this.state.instanceId,
      reason,
      finalTick: this.state.currentTick,
      ruleConfigVersion: this.state.ruleConfigVersion,
    });

    // Clear battle timer
    if (this.battleTimer) {
      clearTimeout(this.battleTimer);
      this.battleTimer = undefined;
    }

    recordPlayerAction('battle_resolved', this.state.instanceId, 'success');

    // TODO: Persist battle results and trigger replay capture
  }

  // Helper methods

  private getMaxPlayersByType(battleType: 'small' | 'standard'): number {
    switch (battleType) {
      case 'small': return 8;
      case 'standard': return 16;
      default: return 8;
    }
  }

  private isValidTilePosition(x: number, y: number): boolean {
    // Battle-specific bounds (smaller than arena)
    return x >= -100 && x <= 100 && y >= -100 && y <= 100;
  }

  /**
   * Initialize rule configuration version stamping for the battle
   */
  private async initializeRuleVersion(providedVersion?: string): Promise<void> {
    try {
      if (providedVersion) {
        // Use provided version (for testing or specific battle configurations)
        this.state.ruleConfigVersion = providedVersion;
        
        this.roomLogger.info({
          event: 'battle_rule_version_provided',
          providedVersion: providedVersion,
        }, `Battle rule version set from options: ${providedVersion}`);
        return;
      }

      // Get active battle rule configuration
      const battleRuleConfig = await this.ruleConfigService.getActiveRuleConfig('battle');
      
      if (battleRuleConfig) {
        this.currentRuleStamp = this.ruleConfigService.createVersionStamp(battleRuleConfig);
        this.state.ruleConfigVersion = battleRuleConfig.version;
        
        this.roomLogger.info({
          event: 'battle_rule_version_initialized',
          ruleConfigId: battleRuleConfig.id,
          version: battleRuleConfig.version,
          stamp: this.currentRuleStamp,
        }, `Battle rule version initialized: ${battleRuleConfig.name} v${battleRuleConfig.version}`);
      } else {
        // Fallback to default version
        this.state.ruleConfigVersion = '1.0.0';
        
        this.roomLogger.warn({
          event: 'battle_rule_version_fallback',
          fallbackVersion: this.state.ruleConfigVersion,
        }, 'No active battle rule config found, using fallback version');
      }
    } catch (error) {
      this.state.ruleConfigVersion = '1.0.0';
      
      this.roomLogger.error({
        event: 'battle_rule_version_init_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        fallbackVersion: this.state.ruleConfigVersion,
      }, 'Failed to initialize battle rule version');
    }
  }

  /**
   * Get the current rule version stamp for audit purposes
   */
  getCurrentRuleStamp(): RuleVersionStamp | undefined {
    return this.currentRuleStamp;
  }
}