import { Room, Client } from 'colyseus';
import { Schema, MapSchema, type } from '@colyseus/schema';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { 
  recordPlayerAction, 
  updatePlayerCount,
  recordWsLatency 
} from '../../infra/monitoring/metrics';
import { createSoftFailMonitor, SoftFailMonitor } from '../../application/services/softFailMonitor';
import { createAiElasticityMonitor, AiElasticityMonitor } from '../../application/services/aiElasticityMonitor';
import { createChatDeliveryDispatcher, ChatDeliveryDispatcher } from '../../application/services/chatDeliveryDispatcher';
import { PostgresSessionsRepository, ISessionsRepository } from '../../infra/persistence/sessionsRepository';
import { createRuleConfigService, RuleConfigService, RuleVersionStamp } from '../../application/services/ruleConfigService';

// Room state schemas
export class TileState extends Schema {
  @type("string") playerId!: string;
  @type("number") x!: number;
  @type("number") y!: number;
  @type("string") color!: string;
  @type("number") timestamp!: number;
}

export class PlayerState extends Schema {
  @type("string") id!: string;
  @type("string") displayName!: string;
  @type("boolean") isConnected!: boolean;
  @type("number") lastHeartbeat!: number;
  @type("number") tileCount!: number;
  @type("boolean") isReady!: boolean;
}

export class ArenaState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: TileState }) tiles = new MapSchema<TileState>();
  @type("string") arenaId!: string;
  @type("string") tier!: string;
  @type("number") maxPlayers!: number;
  @type("number") currentTick!: number;
  @type("boolean") isActive!: boolean;
  @type("number") startTime!: number;
  @type("string") ruleConfigVersion!: string;
}

interface ArenaOptions {
  arenaId?: string;
  tier?: 'small' | 'large' | 'epic';
  maxPlayers?: number;
  region?: string;
}

interface JoinMessage {
  sessionTicket: string;
  displayName: string;
}

interface PlaceTileMessage {
  x: number;
  y: number;
  color: string;
}

interface HeartbeatMessage {
  timestamp: number;
}

interface ChatMessage {
  content: string;
  channelType?: 'arena' | 'private';
  recipientId?: string;
}

/**
 * Arena Room implementing FR-002, FR-005, FR-011
 * Handles tile placement, player management, and real-time updates
 */
export class ArenaRoom extends Room<ArenaState> {
  private readonly roomLogger = createServiceLogger('ArenaRoom');
  
  // Service integrations
  private readonly softFailMonitor: SoftFailMonitor;
  private readonly aiElasticityMonitor: AiElasticityMonitor;
  private readonly chatDispatcher: ChatDeliveryDispatcher;
  private readonly sessionsRepo: ISessionsRepository;
  private readonly ruleConfigService: RuleConfigService;

  // Room configuration
  private readonly MAX_TILES_PER_PLAYER = 100;
  private readonly TICK_RATE_MS = 100; // 10 TPS
  
  // Tile processing queue
  private readonly tileQueue: Array<{ client: Client; message: PlaceTileMessage; timestamp: number }> = [];
  
  // Performance tracking
  private conflictCount = 0;

  // Rule version tracking
  private currentRuleStamp?: RuleVersionStamp;

  constructor() {
    super();
    
    // Initialize services
    this.sessionsRepo = new PostgresSessionsRepository({});
    this.softFailMonitor = createSoftFailMonitor(this.sessionsRepo);
    this.aiElasticityMonitor = createAiElasticityMonitor();
    this.chatDispatcher = createChatDeliveryDispatcher();
    this.ruleConfigService = createRuleConfigService();
  }

  override async onCreate(options: ArenaOptions = {}) {
    this.roomLogger.info({
      event: 'arena_room_created',
      roomId: this.roomId,
      options,
    }, `Arena room created: ${this.roomId}`);

    // Initialize room state
    this.setState(new ArenaState());
    
    this.state.arenaId = options.arenaId || this.roomId;
    this.state.tier = options.tier || 'small';
    this.state.maxPlayers = options.maxPlayers || this.getMaxPlayersByTier(this.state.tier);
    this.state.currentTick = 0;
    this.state.isActive = false;
    this.state.startTime = Date.now();

    // Initialize rule configuration version stamping
    await this.initializeRuleVersion();

    // Set room metadata
    this.setMetadata({
      arenaId: this.state.arenaId,
      tier: this.state.tier,
      maxPlayers: this.state.maxPlayers,
      region: options.region || 'default',
      ruleConfigVersion: this.state.ruleConfigVersion,
    });

    // Configure room settings
    this.maxClients = this.state.maxPlayers;
    this.patchRate = 50; // 20 FPS update rate
    // Start tick processing (Colyseus will call onUpdate automatically)
    // No need to set interval - onUpdate handles this

    // Set up message handlers
    this.onMessage('heartbeat', this.handleHeartbeat.bind(this));
    this.onMessage('place_tile', this.handlePlaceTile.bind(this));
    this.onMessage('chat', this.handleChatMessage.bind(this));
    this.onMessage('ready', this.handlePlayerReady.bind(this));

    this.roomLogger.debug({
      event: 'arena_room_configured',
      roomId: this.roomId,
      maxClients: this.maxClients,
      patchRate: this.patchRate,
      tickRate: this.TICK_RATE_MS,
    }, 'Arena room configuration complete');
  }

  override async onAuth(client: Client, options: JoinMessage): Promise<boolean> {
    try {
      const startTime = Date.now();
      
      this.roomLogger.debug({
        event: 'auth_attempt',
        clientId: client.id,
        sessionTicket: options.sessionTicket?.substring(0, 8) + '...',
      }, `Authentication attempt for client ${client.id}`);

      // TODO: Validate session ticket with auth service
      // For now, accept all connections with valid structure
      if (!options.sessionTicket || !options.displayName) {
        this.roomLogger.warn({
          event: 'auth_failed_missing_data',
          clientId: client.id,
          hasTicket: !!options.sessionTicket,
          hasDisplayName: !!options.displayName,
        }, 'Authentication failed: missing required data');
        
        return false;
      }

      const authLatency = Date.now() - startTime;
      recordWsLatency(authLatency, 'auth', this.state.tier);

      this.roomLogger.info({
        event: 'auth_success',
        clientId: client.id,
        displayName: options.displayName,
        authLatency,
      }, `Client authenticated: ${client.id}`);

      return true;

    } catch (error) {
      this.roomLogger.error({
        event: 'auth_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Authentication error for client ${client.id}`);

      return false;
    }
  }

  override onJoin(client: Client, options: JoinMessage) {
    try {
      const startTime = Date.now();

      this.roomLogger.info({
        event: 'player_joined',
        clientId: client.id,
        displayName: options.displayName,
        currentPlayers: this.clients.length,
        maxPlayers: this.maxClients,
      }, `Player joined arena: ${options.displayName}`);

      // Create player state
      const playerState = new PlayerState();
      playerState.id = client.id;
      playerState.displayName = options.displayName;
      playerState.isConnected = true;
      playerState.lastHeartbeat = Date.now();
      playerState.tileCount = 0;
      playerState.isReady = false;

      this.state.players.set(client.id, playerState);

      // Update monitoring services
      updatePlayerCount(this.state.arenaId, this.state.tier, this.clients.length);
      this.aiElasticityMonitor.updateArenaPlayerCount(
        this.state.arenaId, 
        this.clients.length, 
        this.maxClients
      );

      // Register with soft-fail monitor
      this.softFailMonitor.updatePlayerHeartbeat(client.id, this.state.arenaId);

      // Send initial room state to client
      client.send('room_joined', {
        arenaId: this.state.arenaId,
        tier: this.state.tier,
        maxPlayers: this.maxClients,
        currentPlayers: this.clients.length,
        isActive: this.state.isActive,
      });

      // Start arena if this is the first player and room becomes active
      if (this.clients.length >= 2 && !this.state.isActive) {
        this.startArena();
      }

      const joinLatency = Date.now() - startTime;
      recordWsLatency(joinLatency, 'join', this.state.tier);
      recordPlayerAction('join', this.state.arenaId, 'success');

    } catch (error) {
      this.roomLogger.error({
        event: 'join_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Error during player join: ${client.id}`);

      recordPlayerAction('join', this.state.arenaId, 'failure');
    }
  }

  override async onLeave(client: Client, consented: boolean = false) {
    try {
      this.roomLogger.info({
        event: 'player_left',
        clientId: client.id,
        consented,
        remainingPlayers: this.clients.length - 1,
      }, `Player left arena: ${client.id}`);

      // Update player state
      const playerState = this.state.players.get(client.id);
      if (playerState) {
        playerState.isConnected = false;
      }

      // Check for reconnection if not consented
      if (!consented) {
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
          this.softFailMonitor.updatePlayerHeartbeat(client.id, this.state.arenaId);
          
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
      updatePlayerCount(this.state.arenaId, this.state.tier, this.clients.length);
      this.aiElasticityMonitor.updateArenaPlayerCount(
        this.state.arenaId, 
        this.clients.length, 
        this.maxClients
      );

      // Clean up soft-fail monitoring
      this.softFailMonitor.cleanupSessionData(this.state.arenaId, [client.id]);

      // Check if arena should be paused or stopped
      await this.checkArenaViability();

      recordPlayerAction('leave', this.state.arenaId, 'success');

    } catch (error) {
      this.roomLogger.error({
        event: 'leave_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Error during player leave: ${client.id}`);

      recordPlayerAction('leave', this.state.arenaId, 'failure');
    }
  }

  override onDispose() {
    this.roomLogger.info({
      event: 'arena_room_disposed',
      roomId: this.roomId,
      finalPlayerCount: this.clients.length,
      totalTicks: this.state.currentTick,
    }, `Arena room disposed: ${this.roomId}`);

    // Clean up monitoring services
    this.aiElasticityMonitor.cleanupArenaData(this.state.arenaId);
    this.softFailMonitor.cleanupSessionData(
      this.state.arenaId,
      Array.from(this.state.players.keys())
    );
  }

  // Colyseus simulation update (called automatically)
  onUpdate(_deltaTime?: number) {
    if (!this.state.isActive) return;

    // Process queued tile placements
    this.processTileQueue();
    
    // Update tick counter
    this.state.currentTick++;
  }

  // Message handlers

  private handleHeartbeat(client: Client, message: HeartbeatMessage) {
    const playerState = this.state.players.get(client.id);
    if (playerState) {
      playerState.lastHeartbeat = Date.now();
      
      // Calculate RTT if timestamp provided
      const rtt = message.timestamp ? Date.now() - message.timestamp : undefined;
      
      // Update soft-fail monitoring
      this.softFailMonitor.updatePlayerHeartbeat(client.id, this.state.arenaId, rtt);

      this.roomLogger.debug({
        event: 'heartbeat_received',
        clientId: client.id,
        rtt,
      }, `Heartbeat from ${client.id}`);
    }
  }

  private async handlePlaceTile(client: Client, message: PlaceTileMessage) {
    try {
      const playerState = this.state.players.get(client.id);
      if (!playerState || !playerState.isConnected) {
        this.roomLogger.warn({
          event: 'tile_placement_rejected_disconnected',
          clientId: client.id,
        }, 'Tile placement rejected: player not connected');
        
        recordPlayerAction('place_tile', this.state.arenaId, 'failure');
        return;
      }

      // Check tile placement limits
      if (playerState.tileCount >= this.MAX_TILES_PER_PLAYER) {
        client.send('error', { message: 'Maximum tiles reached' });
        recordPlayerAction('place_tile', this.state.arenaId, 'rate_limited');
        return;
      }

      // Validate tile coordinates
      if (!this.isValidTilePosition(message.x, message.y)) {
        client.send('error', { message: 'Invalid tile position' });
        recordPlayerAction('place_tile', this.state.arenaId, 'failure');
        return;
      }

      // Add to processing queue (batch processing)
      this.tileQueue.push({
        client,
        message,
        timestamp: Date.now(),
      });

      recordPlayerAction('place_tile', this.state.arenaId, 'success');

    } catch (error) {
      this.roomLogger.error({
        event: 'tile_placement_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Error handling tile placement');

      recordPlayerAction('place_tile', this.state.arenaId, 'failure');
    }
  }

  private async handleChatMessage(client: Client, message: ChatMessage) {
    try {
      const playerState = this.state.players.get(client.id);
      if (!playerState || !playerState.isConnected) {
        return;
      }

      // Create chat message for dispatcher
      const chatMessage = {
        id: crypto.randomUUID(),
        senderId: client.id,
        recipientId: message.recipientId,
        channelType: message.channelType || 'arena' as const,
        content: message.content,
        timestamp: new Date(),
        deliveryTier: 'at_least_once' as const,
      };

      // Send through chat dispatcher
      const result = await this.chatDispatcher.sendMessage(chatMessage);
      
      if (result.success) {
        // Broadcast to relevant clients
        if (message.channelType === 'arena') {
          this.broadcast('chat_message', {
            senderId: client.id,
            senderName: playerState.displayName,
            content: message.content,
            timestamp: chatMessage.timestamp.getTime(),
          });
        } else if (message.channelType === 'private' && message.recipientId) {
          // Send to specific recipient
          this.clients.forEach(c => {
            if (c.id === message.recipientId) {
              c.send('private_message', {
                senderId: client.id,
                senderName: playerState.displayName,
                content: message.content,
                timestamp: chatMessage.timestamp.getTime(),
              });
            }
          });
        }
      }

    } catch (error) {
      this.roomLogger.error({
        event: 'chat_message_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Error handling chat message');
    }
  }

  private handlePlayerReady(client: Client, _message: any) {
    const playerState = this.state.players.get(client.id);
    if (playerState) {
      playerState.isReady = true;
      
      this.roomLogger.debug({
        event: 'player_ready',
        clientId: client.id,
      }, `Player ready: ${client.id}`);

      // Check if all players are ready to start intensive gameplay
      const allReady = Array.from(this.state.players.values()).every(p => p.isReady);
      if (allReady && this.clients.length >= 2) {
        this.startIntensiveGameplay();
      }
    }
  }

  // Arena lifecycle methods

  private startArena() {
    this.state.isActive = true;
    this.state.startTime = Date.now();

    this.broadcast('arena_started', {
      message: 'Arena is now active! Place your tiles!',
      startTime: this.state.startTime,
    });

    this.roomLogger.info({
      event: 'arena_started',
      roomId: this.roomId,
      playerCount: this.clients.length,
    }, 'Arena started');
  }

  private startIntensiveGameplay() {
    this.roomLogger.info({
      event: 'intensive_gameplay_started',
      roomId: this.roomId,
      playerCount: this.clients.length,
    }, 'Starting intensive gameplay mode');

    // Reduce patch rate for better performance
    this.patchRate = 100; // 10 FPS for intensive mode
  }

  private async checkArenaViability() {
    // Check with soft-fail monitor
    const decision = await this.softFailMonitor.checkArenaQuorum(this.state.arenaId);
    
    if (decision.shouldAbort) {
      this.roomLogger.warn({
        event: 'arena_abort_recommended',
        roomId: this.roomId,
        reason: decision.reason,
        action: decision.recommendedAction,
      }, `Arena abort recommended: ${decision.reason}`);

      if (decision.recommendedAction === 'abort') {
        await this.gracefulShutdown();
      } else if (decision.recommendedAction === 'pause') {
        this.pauseArena();
      }
    }
  }

  private pauseArena() {
    this.state.isActive = false;
    
    this.broadcast('arena_paused', {
      message: 'Arena paused due to insufficient players',
    });

    this.roomLogger.info({
      event: 'arena_paused',
      roomId: this.roomId,
    }, 'Arena paused');
  }

  private async gracefulShutdown() {
    this.broadcast('arena_shutdown', {
      message: 'Arena is shutting down gracefully',
      reason: 'Insufficient player quorum',
    });

    this.roomLogger.info({
      event: 'arena_graceful_shutdown',
      roomId: this.roomId,
    }, 'Initiating graceful shutdown');

    // Allow some time for clients to process the message
    setTimeout(() => {
      this.disconnect();
    }, 5000);
  }

  // Tile processing

  private processTileQueue() {
    const processedTiles: Array<{ tileId: string; x: number; y: number; playerId: string; color: string }> = [];
    
    // Process all queued tiles
    while (this.tileQueue.length > 0) {
      const { client, message } = this.tileQueue.shift()!;
      
      const tileId = `${message.x},${message.y}`;
      
      // Check for conflicts (same position)
      const existingTile = this.state.tiles.get(tileId);
      if (existingTile) {
        this.conflictCount++;
        client.send('tile_rejected', {
          x: message.x,
          y: message.y,
          reason: 'Position occupied',
        });
        continue;
      }

      // Place the tile
      const tileState = new TileState();
      tileState.playerId = client.id;
      tileState.x = message.x;
      tileState.y = message.y;
      tileState.color = message.color;
      tileState.timestamp = Date.now();
      
      this.state.tiles.set(tileId, tileState);

      // Update player tile count
      const playerState = this.state.players.get(client.id);
      if (playerState) {
        playerState.tileCount++;
      }

      processedTiles.push({
        tileId,
        x: message.x,
        y: message.y,
        playerId: client.id,
        color: message.color,
      });
    }

    // Broadcast successful tile updates
    if (processedTiles.length > 0) {
      this.broadcast('tiles_updated', {
        tiles: processedTiles,
        tick: this.state.currentTick,
      });
    }
  }

  // Helper methods

  private getMaxPlayersByTier(tier: string): number {
    switch (tier) {
      case 'small': return 20;
      case 'large': return 100;
      case 'epic': return 300;
      default: return 20;
    }
  }

  private isValidTilePosition(x: number, y: number): boolean {
    // Basic bounds checking (would be more sophisticated in production)
    return x >= -1000 && x <= 1000 && y >= -1000 && y <= 1000;
  }

  /**
   * Initialize rule configuration version stamping for the arena
   */
  private async initializeRuleVersion(): Promise<void> {
    try {
      const arenaRuleConfig = await this.ruleConfigService.getActiveRuleConfig('arena');
      
      if (arenaRuleConfig) {
        this.currentRuleStamp = this.ruleConfigService.createVersionStamp(arenaRuleConfig);
        this.state.ruleConfigVersion = arenaRuleConfig.version;
        
        this.roomLogger.info({
          event: 'arena_rule_version_initialized',
          ruleConfigId: arenaRuleConfig.id,
          version: arenaRuleConfig.version,
          stamp: this.currentRuleStamp,
        }, `Arena rule version initialized: ${arenaRuleConfig.name} v${arenaRuleConfig.version}`);
      } else {
        // Fallback to default version
        this.state.ruleConfigVersion = '1.0.0';
        
        this.roomLogger.warn({
          event: 'arena_rule_version_fallback',
          fallbackVersion: this.state.ruleConfigVersion,
        }, 'No active arena rule config found, using fallback version');
      }
    } catch (error) {
      this.state.ruleConfigVersion = '1.0.0';
      
      this.roomLogger.error({
        event: 'arena_rule_version_init_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        fallbackVersion: this.state.ruleConfigVersion,
      }, 'Failed to initialize arena rule version');
    }
  }

  /**
   * Get the current rule version stamp for audit purposes
   */
  getCurrentRuleStamp(): RuleVersionStamp | undefined {
    return this.currentRuleStamp;
  }
}