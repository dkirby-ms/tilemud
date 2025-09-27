import { Room, Client } from 'colyseus';
import { Schema, MapSchema, type } from '@colyseus/schema';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { 
  recordPlayerAction, 
  updatePlayerCount,
  recordWsLatency,
  recordTileTickDuration,
  recordConflictResolution,
  recordBroadcast
} from '../../infra/monitoring/metrics';
import { createSoftFailMonitor, SoftFailMonitor } from '../../application/services/softFailMonitor';
import { createAiElasticityMonitor, AiElasticityMonitor } from '../../application/services/aiElasticityMonitor';
import { ChatDeliveryDispatcher } from '../../application/services/chatDeliveryDispatcher';
import { PostgresSessionsRepository, ISessionsRepository } from '../../infra/persistence/sessionsRepository';
import { createRuleConfigService, RuleConfigService, RuleVersionStamp } from '../../application/services/ruleConfigService';
import { BlockListMiddleware } from '../../application/middleware/blockList';
import { PostgresPlayersRepository } from '../../infra/persistence/playersRepository';
import { ModerationService } from '../../application/services/moderationService';
import { PostgresGuildsRepository } from '../../infra/persistence/guildsRepository';
import { ReplayWriter } from '../../application/services/replayWriter';
import { PostgresReplayRepository } from '../../infra/persistence/replayRepository';

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
  private readonly blockListMiddleware: BlockListMiddleware;
  private readonly moderationService: ModerationService;
  private readonly replayWriter: ReplayWriter;

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
    const playersRepo = new PostgresPlayersRepository({});
    const guildsRepo = new PostgresGuildsRepository({});
    const replayRepo = new PostgresReplayRepository({});
    this.sessionsRepo = new PostgresSessionsRepository({});
    this.softFailMonitor = createSoftFailMonitor(this.sessionsRepo);
    this.aiElasticityMonitor = createAiElasticityMonitor();
    this.blockListMiddleware = new BlockListMiddleware(playersRepo);
    this.chatDispatcher = new ChatDeliveryDispatcher(undefined, this.blockListMiddleware);
    this.ruleConfigService = createRuleConfigService();
    this.moderationService = new ModerationService(playersRepo, guildsRepo);
    this.replayWriter = new ReplayWriter(replayRepo);
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

    // Initialize replay recording
    try {
      await this.replayWriter.initializeReplay(this.state.arenaId);
      
      // Record arena creation event
      await this.replayWriter.appendEvent(this.state.arenaId, {
        type: 'arena_created',
        data: {
          arenaId: this.state.arenaId,
          tier: this.state.tier,
          maxPlayers: this.state.maxPlayers,
          ruleConfigVersion: this.state.ruleConfigVersion,
          startTime: this.state.startTime,
        },
        metadata: {
          roomId: this.roomId,
          tick: 0,
        },
      });

      this.roomLogger.debug({
        event: 'replay_initialized',
        arenaId: this.state.arenaId,
      }, 'Replay recording initialized');
    } catch (error) {
      this.roomLogger.error({
        event: 'replay_init_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to initialize replay recording');
    }

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
    this.onMessage('mute_player', this.handleMutePlayer.bind(this));
    this.onMessage('unmute_player', this.handleUnmutePlayer.bind(this));
    this.onMessage('kick_player', this.handleKickPlayer.bind(this));

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

      // Record tile placement event in replay
      if (this.replayWriter) {
        await this.replayWriter.appendEvent(this.state.arenaId, {
          type: 'tile_placed',
          data: {
            playerId: client.sessionId,
            x: message.x,
            y: message.y,
            color: message.color,
            tileCount: playerState.tileCount + 1,
          },
          metadata: {
            roomId: this.roomId,
            tick: this.state.currentTick,
          },
        });
      }

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
        // Record chat message in replay
        if (this.replayWriter) {
          await this.replayWriter.appendEvent(this.state.arenaId, {
            type: 'chat_message',
            data: {
              senderId: client.id,
              recipientId: message.recipientId,
              channelType: message.channelType || 'arena',
              content: message.content,
            },
            metadata: {
              roomId: this.roomId,
              tick: this.state.currentTick,
            },
          });
        }

        // Broadcast to relevant clients
        if (message.channelType === 'arena') {
          const broadcastStartTime = Date.now();
          this.broadcast('chat_message', {
            senderId: client.id,
            senderName: playerState.displayName,
            content: message.content,
            timestamp: chatMessage.timestamp.getTime(),
          });
          const broadcastDuration = Date.now() - broadcastStartTime;
          recordBroadcast(broadcastDuration, 'chat_message', this.clients.length);
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

  // Moderation handlers

  private async handleMutePlayer(client: Client, message: { targetPlayerId: string; durationMs?: number; reason?: string }) {
    try {
      const moderatorPlayer = this.state.players.get(client.id);
      if (!moderatorPlayer) {
        return;
      }

      const result = await this.moderationService.mutePlayer({
        moderatorId: client.id,
        targetPlayerId: message.targetPlayerId,
        durationMs: message.durationMs || 5 * 60 * 1000, // Default 5 minutes
        reason: message.reason || 'Arena moderation',
        scope: 'arena',
        scopeId: this.state.arenaId,
      });

      if (result.success) {
        // Record moderation action in replay
        if (this.replayWriter) {
          await this.replayWriter.appendEvent(this.state.arenaId, {
            type: 'player_muted',
            data: {
              moderatorId: client.id,
              targetPlayerId: message.targetPlayerId,
              durationMs: message.durationMs || 5 * 60 * 1000,
              reason: message.reason || 'Arena moderation',
            },
            metadata: {
              roomId: this.roomId,
              tick: this.state.currentTick,
            },
          });
        }

        this.broadcast('player_muted', {
          targetPlayerId: message.targetPlayerId,
          durationMs: message.durationMs || 5 * 60 * 1000,
          reason: message.reason || 'Arena moderation',
          moderatorId: client.id,
        });
        recordBroadcast(0, 'player_muted', this.clients.length); // Quick broadcast, no timing needed

        this.roomLogger.info({
          event: 'player_muted',
          moderatorId: client.id,
          targetPlayerId: message.targetPlayerId,
          durationMs: message.durationMs,
          reason: message.reason,
        }, `Player muted in arena: ${message.targetPlayerId}`);
      } else {
        client.send('moderation_error', { error: result.error });
      }
    } catch (error) {
      this.roomLogger.error({
        event: 'mute_error',
        moderatorId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to mute player');
      
      client.send('moderation_error', { error: 'Failed to mute player' });
    }
  }

  private async handleUnmutePlayer(client: Client, message: { targetPlayerId: string }) {
    try {
      const moderatorPlayer = this.state.players.get(client.id);
      if (!moderatorPlayer) {
        return;
      }

      const result = await this.moderationService.unmutePlayer({
        moderatorId: client.id,
        targetPlayerId: message.targetPlayerId,
        scope: 'arena',
        scopeId: this.state.arenaId,
      });

      if (result.success) {
        this.broadcast('player_unmuted', {
          targetPlayerId: message.targetPlayerId,
          moderatorId: client.id,
        });

        this.roomLogger.info({
          event: 'player_unmuted',
          moderatorId: client.id,
          targetPlayerId: message.targetPlayerId,
        }, `Player unmuted in arena: ${message.targetPlayerId}`);
      } else {
        client.send('moderation_error', { error: result.error });
      }
    } catch (error) {
      this.roomLogger.error({
        event: 'unmute_error',
        moderatorId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to unmute player');
      
      client.send('moderation_error', { error: 'Failed to unmute player' });
    }
  }

  private async handleKickPlayer(client: Client, message: { targetPlayerId: string; reason?: string }) {
    try {
      const moderatorPlayer = this.state.players.get(client.id);
      if (!moderatorPlayer) {
        return;
      }

      const result = await this.moderationService.kickPlayer({
        moderatorId: client.id,
        targetPlayerId: message.targetPlayerId,
        reason: message.reason || 'Arena moderation',
        scope: 'arena',
        scopeId: this.state.arenaId,
      });

      if (result.success) {
        // Record moderation action in replay
        if (this.replayWriter) {
          await this.replayWriter.appendEvent(this.state.arenaId, {
            type: 'player_kicked',
            data: {
              moderatorId: client.id,
              targetPlayerId: message.targetPlayerId,
              reason: message.reason || 'Arena moderation',
            },
            metadata: {
              roomId: this.roomId,
              tick: this.state.currentTick,
            },
          });
        }

        // Find and disconnect the target player
        const targetClient = this.clients.find(c => c.id === message.targetPlayerId);
        if (targetClient) {
          targetClient.send('kicked_from_room', {
            reason: message.reason || 'Arena moderation',
            moderatorId: client.id,
          });
          
          // Give them a moment to receive the message, then disconnect
          setTimeout(() => {
            targetClient.leave(1000); // Normal closure
          }, 1000);
        }

        this.broadcast('player_kicked', {
          targetPlayerId: message.targetPlayerId,
          reason: message.reason || 'Arena moderation',
          moderatorId: client.id,
        });
        recordBroadcast(0, 'player_kicked', this.clients.length); // Quick broadcast, no timing needed

        this.roomLogger.info({
          event: 'player_kicked',
          moderatorId: client.id,
          targetPlayerId: message.targetPlayerId,
          reason: message.reason,
        }, `Player kicked from arena: ${message.targetPlayerId}`);
      } else {
        client.send('moderation_error', { error: result.error });
      }
    } catch (error) {
      this.roomLogger.error({
        event: 'kick_error',
        moderatorId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to kick player');
      
      client.send('moderation_error', { error: 'Failed to kick player' });
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
    const startTime = Date.now();
    const processedTiles: Array<{ tileId: string; x: number; y: number; playerId: string; color: string }> = [];
    let conflictsResolved = 0;
    
    // Process all queued tiles
    while (this.tileQueue.length > 0) {
      const { client, message } = this.tileQueue.shift()!;
      
      const tileId = `${message.x},${message.y}`;
      
      // Check for conflicts (same position)
      const existingTile = this.state.tiles.get(tileId);
      if (existingTile) {
        this.conflictCount++;
        conflictsResolved++;
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
      const broadcastStartTime = Date.now();
      this.broadcast('tiles_updated', {
        tiles: processedTiles,
        tick: this.state.currentTick,
      });
      const broadcastDuration = Date.now() - broadcastStartTime;
      recordBroadcast(broadcastDuration, 'tiles_updated', this.clients.length);
    }

    // Record performance metrics
    const totalDuration = Date.now() - startTime;
    recordTileTickDuration(totalDuration, this.state.arenaId, this.clients.length);
    
    if (conflictsResolved > 0) {
      recordConflictResolution(totalDuration, this.state.arenaId, conflictsResolved);
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