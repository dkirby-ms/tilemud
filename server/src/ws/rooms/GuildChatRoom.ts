import { Room, Client } from 'colyseus';
import { Schema, MapSchema, type } from '@colyseus/schema';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { 
  recordPlayerAction, 
  updatePlayerCount 
} from '../../infra/monitoring/metrics';
import { createSoftFailMonitor, SoftFailMonitor } from '../../application/services/softFailMonitor';

// Room state schemas

export class ChatMemberState extends Schema {
  @type('string') id!: string;
  @type('string') displayName!: string;
  @type('string') guildRole!: 'leader' | 'officer' | 'veteran' | 'member';
  @type('boolean') isOnline: boolean = true;
  @type('number') lastActivity!: number;
  @type('boolean') isMuted: boolean = false;
}

export class ChatMessageState extends Schema {
  @type('string') id!: string;
  @type('string') senderId!: string;
  @type('string') senderName!: string;
  @type('string') content!: string;
  @type('number') timestamp!: number;
  @type('string') messageType: 'chat' | 'system' | 'announcement' = 'chat';
}

export class GuildChatState extends Schema {
  @type('string') guildId!: string;
  @type('string') guildName!: string;
  @type('string') channelType: string = 'guild_chat';
  @type('boolean') isActive: boolean = true;
  @type('number') memberCount: number = 0;
  @type('number') createdAt!: number;
  @type({ map: ChatMemberState }) members = new MapSchema<ChatMemberState>();
  @type({ map: ChatMessageState }) recentMessages = new MapSchema<ChatMessageState>();
}

// Message types
interface GuildChatMessage {
  content: string;
  messageType?: 'chat' | 'announcement';
}

interface ModerationAction {
  action: 'mute' | 'unmute' | 'kick';
  targetPlayerId: string;
  reason?: string;
}

export class GuildChatRoom extends Room<GuildChatState> {
  private readonly MAX_RECENT_MESSAGES = 50;
  private readonly MESSAGE_RETENTION_MS = 12 * 60 * 60 * 1000; // 12 hours per spec

  private readonly logger = createServiceLogger('GuildChatRoom');
  private readonly roomLogger = this.logger.child({ roomId: this.roomId });

  // Service dependencies
  private readonly softFailMonitor: SoftFailMonitor;

  // Cleanup interval
  private cleanupInterval?: NodeJS.Timeout;

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

    this.roomLogger.info({
      event: 'guild_chat_room_initialized',
      roomId: this.roomId,
    }, `GuildChatRoom initialized: ${this.roomId}`);
  }

  override async onCreate(options: any) {
    this.roomLogger.info({
      event: 'guild_chat_room_created',
      options,
    }, `Creating guild chat room with options: ${JSON.stringify(options)}`);

    // Initialize guild chat state
    this.state = new GuildChatState();
    this.state.guildId = options.guildId || `guild-${this.roomId}`;
    this.state.guildName = options.guildName || 'Unknown Guild';
    this.state.createdAt = Date.now();

    // Set max clients based on guild tier or use default
    this.maxClients = options.maxMembers || 100; // Default guild size limit
    
    this.roomLogger.info({
      event: 'guild_chat_configured',
      guildId: this.state.guildId,
      guildName: this.state.guildName,
      maxMembers: this.maxClients,
    }, `Guild chat configured: ${this.state.guildName} (max ${this.maxClients} members)`);

    // Set up message handlers
    this.onMessage('guild_chat', this.handleGuildChatMessage.bind(this));
    this.onMessage('moderation', this.handleModerationAction.bind(this));
    this.onMessage('heartbeat', this.handleHeartbeat.bind(this));

    // Start periodic cleanup of old messages
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldMessages();
    }, 5 * 60 * 1000); // Every 5 minutes

    try {
      // Mock service initialization
      recordPlayerAction('guild_chat_created', this.state.guildId, 'success');

    } catch (error) {
      this.roomLogger.error({
        event: 'service_initialization_failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Failed to initialize services: ${error}`);

      recordPlayerAction('guild_chat_created', this.state.guildId, 'failure');
      throw error;
    }
  }

  override async onAuth(client: Client, options: any) {
    this.roomLogger.debug({
      event: 'auth_attempt',
      clientId: client.id,
      options,
    }, `Authentication attempt for client: ${client.id}`);

    // TODO: Implement guild membership validation
    if (!options.sessionTicket || !options.guildId) {
      this.roomLogger.warn({
        event: 'auth_failed_missing_data',
        clientId: client.id,
      }, `Authentication failed - missing session ticket or guild ID`);
      return false;
    }

    // Verify guild membership
    if (options.guildId !== this.state.guildId) {
      this.roomLogger.warn({
        event: 'auth_failed_wrong_guild',
        clientId: client.id,
        expectedGuild: this.state.guildId,
        providedGuild: options.guildId,
      }, `Authentication failed - wrong guild`);
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
          displayName: options.displayName || client.id.substring(0, 8),
          guildRole: options.guildRole || 'member'
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
        event: 'member_joined',
        clientId: client.id,
        auth,
        currentMembers: this.clients.length,
      }, `Guild member joined: ${client.id} (${auth?.displayName})`);

      // Create member state
      const memberState = new ChatMemberState();
      memberState.id = client.id;
      memberState.displayName = auth?.displayName || client.id.substring(0, 8);
      memberState.guildRole = auth?.guildRole || 'member';
      memberState.lastActivity = Date.now();
      memberState.isOnline = true;

      this.state.members.set(client.id, memberState);
      this.state.memberCount = this.clients.length;

      // Update monitoring services
      updatePlayerCount(this.state.guildId, 'guild_chat', this.clients.length);

      // Send system message about member joining
      this.addSystemMessage(`${memberState.displayName} joined the guild chat.`);

      // Send chat history to new member
      this.sendChatHistory(client);

      recordPlayerAction('guild_join', this.state.guildId, 'success');

    } catch (error) {
      this.roomLogger.error({
        event: 'join_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Error during member join: ${client.id}`);

      recordPlayerAction('guild_join', this.state.guildId, 'failure');
      throw error;
    }
  }

  override async onLeave(client: Client, consented: boolean = false) {
    try {
      this.roomLogger.info({
        event: 'member_left',
        clientId: client.id,
        consented,
        remainingMembers: this.clients.length - 1,
      }, `Guild member left: ${client.id}`);

      // Get member info before removal
      const memberState = this.state.members.get(client.id);
      const memberName = memberState?.displayName || client.id;

      // Update member status for brief period (for reconnection)
      if (memberState && !consented) {
        memberState.isOnline = false;
        memberState.lastActivity = Date.now();

        // Allow brief reconnection period for guild chat
        this.roomLogger.debug({
          event: 'allowing_reconnection',
          clientId: client.id,
        }, `Allowing reconnection for ${client.id}`);

        try {
          // Allow reconnection within grace period
          await this.allowReconnection(client, 60); // 60 seconds grace period for chat
          
          this.roomLogger.info({
            event: 'member_reconnected',
            clientId: client.id,
          }, `Guild member reconnected: ${client.id}`);

          // Update state back to online
          if (memberState) {
            memberState.isOnline = true;
            memberState.lastActivity = Date.now();
          }
          
          return; // Early return for successful reconnection

        } catch (reconnectError) {
          this.roomLogger.warn({
            event: 'reconnection_failed',
            clientId: client.id,
            error: reconnectError instanceof Error ? reconnectError.message : 'Unknown error',
          }, `Reconnection failed for ${client.id}`);
        }
      }

      // Remove member permanently
      this.state.members.delete(client.id);
      this.state.memberCount = this.clients.length;

      // Update monitoring services
      updatePlayerCount(this.state.guildId, 'guild_chat', this.clients.length);

      // Send system message about member leaving
      this.addSystemMessage(`${memberName} left the guild chat.`);

      recordPlayerAction('guild_leave', this.state.guildId, 'success');

    } catch (error) {
      this.roomLogger.error({
        event: 'leave_error',
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, `Error during member leave: ${client.id}`);

      recordPlayerAction('guild_leave', this.state.guildId, 'failure');
    }
  }

  override onDispose() {
    this.roomLogger.info({
      event: 'guild_chat_room_disposed',
      roomId: this.roomId,
      finalMemberCount: this.clients.length,
      guildId: this.state.guildId,
    }, `Guild chat room disposed: ${this.roomId}`);

    // Clean up intervals
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clean up monitoring services
    this.softFailMonitor.cleanupSessionData(
      this.state.guildId,
      Array.from(this.state.members.keys())
    );
  }

  // Message handlers

  private handleGuildChatMessage(client: Client, message: GuildChatMessage) {
    const memberState = this.state.members.get(client.id);
    if (!memberState) {
      this.roomLogger.warn({
        event: 'message_from_non_member',
        clientId: client.id,
      }, `Message from non-member: ${client.id}`);
      return;
    }

    if (memberState.isMuted) {
      client.send('message_rejected', {
        reason: 'You are muted in this guild chat.',
      });
      return;
    }

    // Update member activity
    memberState.lastActivity = Date.now();

    // Create message
    const messageId = `msg-${Date.now()}-${client.id}`;
    const chatMessage = new ChatMessageState();
    chatMessage.id = messageId;
    chatMessage.senderId = client.id;
    chatMessage.senderName = memberState.displayName;
    chatMessage.content = message.content;
    chatMessage.timestamp = Date.now();
    chatMessage.messageType = message.messageType || 'chat';

    // Add to recent messages (with rotation)
    this.state.recentMessages.set(messageId, chatMessage);
    this.rotateMessages();

    // Broadcast to all guild members
    this.broadcast('guild_chat_message', {
      id: messageId,
      senderId: client.id,
      senderName: memberState.displayName,
      senderRole: memberState.guildRole,
      content: message.content,
      messageType: chatMessage.messageType,
      timestamp: chatMessage.timestamp,
    });

    this.roomLogger.debug({
      event: 'guild_message_sent',
      senderId: client.id,
      senderName: memberState.displayName,
      messageType: chatMessage.messageType,
    }, `Guild message sent by ${memberState.displayName}`);

    recordPlayerAction('guild_chat_sent', this.state.guildId, 'success');
  }

  private handleModerationAction(client: Client, action: ModerationAction) {
    const moderatorState = this.state.members.get(client.id);
    if (!moderatorState) {
      return;
    }

    // Check permissions - only officers and leaders can moderate
    if (moderatorState.guildRole !== 'officer' && moderatorState.guildRole !== 'leader') {
      client.send('moderation_rejected', {
        reason: 'Insufficient permissions for moderation actions.',
      });
      return;
    }

    const targetState = this.state.members.get(action.targetPlayerId);
    if (!targetState) {
      client.send('moderation_rejected', {
        reason: 'Target member not found.',
      });
      return;
    }

    // Prevent moderating higher or equal rank members (except leader can moderate officers)
    const canModerate = this.canModerateTarget(moderatorState.guildRole, targetState.guildRole);
    if (!canModerate) {
      client.send('moderation_rejected', {
        reason: 'Cannot moderate this member due to guild hierarchy.',
      });
      return;
    }

    switch (action.action) {
      case 'mute':
        targetState.isMuted = true;
        this.addSystemMessage(`${targetState.displayName} was muted by ${moderatorState.displayName}${action.reason ? ` (${action.reason})` : ''}.`);
        break;
      
      case 'unmute':
        targetState.isMuted = false;
        this.addSystemMessage(`${targetState.displayName} was unmuted by ${moderatorState.displayName}.`);
        break;
      
      case 'kick':
        // Find the client and kick them
        const targetClient = this.clients.find(c => c.id === action.targetPlayerId);
        if (targetClient) {
          this.addSystemMessage(`${targetState.displayName} was kicked from the guild chat by ${moderatorState.displayName}${action.reason ? ` (${action.reason})` : ''}.`);
          targetClient.leave(1000, 'Kicked from guild chat');
        }
        break;
    }

    this.roomLogger.info({
      event: 'moderation_action',
      moderator: client.id,
      moderatorName: moderatorState.displayName,
      action: action.action,
      target: action.targetPlayerId,
      targetName: targetState.displayName,
      reason: action.reason,
    }, `Moderation action: ${action.action} by ${moderatorState.displayName}`);

    recordPlayerAction('guild_moderation', this.state.guildId, 'success');
  }

  private handleHeartbeat(client: Client, _message: any) {
    const memberState = this.state.members.get(client.id);
    if (memberState) {
      memberState.lastActivity = Date.now();
      memberState.isOnline = true;
    }

    client.send('heartbeat_ack', { timestamp: Date.now() });
  }

  // Helper methods

  private addSystemMessage(content: string) {
    const messageId = `sys-${Date.now()}`;
    const systemMessage = new ChatMessageState();
    systemMessage.id = messageId;
    systemMessage.senderId = 'system';
    systemMessage.senderName = 'System';
    systemMessage.content = content;
    systemMessage.timestamp = Date.now();
    systemMessage.messageType = 'system';

    this.state.recentMessages.set(messageId, systemMessage);
    this.rotateMessages();

    // Broadcast system message
    this.broadcast('guild_chat_message', {
      id: messageId,
      senderId: 'system',
      senderName: 'System',
      senderRole: 'system',
      content,
      messageType: 'system',
      timestamp: systemMessage.timestamp,
    });
  }

  private rotateMessages() {
    const messageIds = Array.from(this.state.recentMessages.keys());
    
    // Remove excess messages (keep only MAX_RECENT_MESSAGES)
    while (messageIds.length > this.MAX_RECENT_MESSAGES) {
      const oldestId = messageIds.shift();
      if (oldestId) {
        this.state.recentMessages.delete(oldestId);
      }
    }
  }

  private cleanupOldMessages() {
    const now = Date.now();
    const messagesToDelete: string[] = [];

    for (const [messageId, message] of this.state.recentMessages.entries()) {
      if (now - message.timestamp > this.MESSAGE_RETENTION_MS) {
        messagesToDelete.push(messageId);
      }
    }

    for (const messageId of messagesToDelete) {
      this.state.recentMessages.delete(messageId);
    }

    if (messagesToDelete.length > 0) {
      this.roomLogger.debug({
        event: 'messages_cleaned_up',
        count: messagesToDelete.length,
      }, `Cleaned up ${messagesToDelete.length} old messages`);
    }
  }

  private sendChatHistory(client: Client) {
    const messages = Array.from(this.state.recentMessages.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(msg => ({
        id: msg.id,
        senderId: msg.senderId,
        senderName: msg.senderName,
        content: msg.content,
        messageType: msg.messageType,
        timestamp: msg.timestamp,
      }));

    client.send('chat_history', { messages });
  }

  private canModerateTarget(moderatorRole: string, targetRole: string): boolean {
    const roleHierarchy = {
      'leader': 4,
      'officer': 3,
      'veteran': 2,
      'member': 1,
    };

    const moderatorLevel = roleHierarchy[moderatorRole as keyof typeof roleHierarchy] || 0;
    const targetLevel = roleHierarchy[targetRole as keyof typeof roleHierarchy] || 0;

    return moderatorLevel > targetLevel;
  }
}