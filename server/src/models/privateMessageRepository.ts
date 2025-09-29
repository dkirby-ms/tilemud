import { Pool } from "pg";

// PrivateMessage entity types
export interface PrivateMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: Date;
}

export interface CreatePrivateMessageData {
  senderId: string;
  recipientId: string;
  content: string;
}

export interface MessageThread {
  participantId: string;
  participantDisplayName?: string;
  lastMessage: PrivateMessage;
  unreadCount: number;
}

// Database row type
interface PrivateMessageRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  created_at: string;
}

// PrivateMessage repository interface
export interface PrivateMessageRepository {
  create(data: CreatePrivateMessageData): Promise<PrivateMessage>;
  findById(id: string): Promise<PrivateMessage | null>;
  findByConversation(user1Id: string, user2Id: string, limit?: number, offset?: number): Promise<PrivateMessage[]>;
  findByRecipient(recipientId: string, limit?: number, offset?: number): Promise<PrivateMessage[]>;
  findBySender(senderId: string, limit?: number, offset?: number): Promise<PrivateMessage[]>;
  getMessageThreads(userId: string, limit?: number): Promise<MessageThread[]>;
  markAsRead(messageIds: string[]): Promise<void>;
  purgeOldMessages(olderThanDays: number): Promise<number>;
  purgeConversation(user1Id: string, user2Id: string): Promise<number>;
  getMessageCount(userId: string, unreadOnly?: boolean): Promise<number>;
}

// PostgreSQL implementation
export class PostgresPrivateMessageRepository implements PrivateMessageRepository {
  constructor(private pool: Pool) {}

  async create(data: CreatePrivateMessageData): Promise<PrivateMessage> {
    const query = `
      INSERT INTO private_messages (id, sender_id, recipient_id, content, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, NOW())
      RETURNING id, sender_id, recipient_id, content, created_at
    `;
    
    const result = await this.pool.query<PrivateMessageRow>(query, [
      data.senderId,
      data.recipientId,
      data.content
    ]);
    
    if (result.rows.length === 0) {
      throw new Error("Failed to create private message");
    }
    
    return this.mapRowToPrivateMessage(result.rows[0]);
  }

  async findById(id: string): Promise<PrivateMessage | null> {
    const query = `
      SELECT id, sender_id, recipient_id, content, created_at
      FROM private_messages
      WHERE id = $1
    `;
    
    const result = await this.pool.query<PrivateMessageRow>(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.mapRowToPrivateMessage(result.rows[0]);
  }

  async findByConversation(user1Id: string, user2Id: string, limit = 50, offset = 0): Promise<PrivateMessage[]> {
    const query = `
      SELECT id, sender_id, recipient_id, content, created_at
      FROM private_messages
      WHERE (sender_id = $1 AND recipient_id = $2) 
         OR (sender_id = $2 AND recipient_id = $1)
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `;
    
    const result = await this.pool.query<PrivateMessageRow>(query, [user1Id, user2Id, limit, offset]);
    return result.rows.map((row: PrivateMessageRow) => this.mapRowToPrivateMessage(row));
  }

  async findByRecipient(recipientId: string, limit = 50, offset = 0): Promise<PrivateMessage[]> {
    const query = `
      SELECT id, sender_id, recipient_id, content, created_at
      FROM private_messages
      WHERE recipient_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await this.pool.query<PrivateMessageRow>(query, [recipientId, limit, offset]);
    return result.rows.map((row: PrivateMessageRow) => this.mapRowToPrivateMessage(row));
  }

  async findBySender(senderId: string, limit = 50, offset = 0): Promise<PrivateMessage[]> {
    const query = `
      SELECT id, sender_id, recipient_id, content, created_at
      FROM private_messages
      WHERE sender_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await this.pool.query<PrivateMessageRow>(query, [senderId, limit, offset]);
    return result.rows.map((row: PrivateMessageRow) => this.mapRowToPrivateMessage(row));
  }

  async getMessageThreads(userId: string, limit = 20): Promise<MessageThread[]> {
    const query = `
      WITH conversation_partners AS (
        SELECT DISTINCT 
          CASE 
            WHEN sender_id = $1 THEN recipient_id 
            ELSE sender_id 
          END as participant_id
        FROM private_messages
        WHERE sender_id = $1 OR recipient_id = $1
      ),
      latest_messages AS (
        SELECT DISTINCT ON (participant_id) 
          cp.participant_id,
          pm.id, pm.sender_id, pm.recipient_id, pm.content, pm.created_at,
          COUNT(pm2.id) as unread_count
        FROM conversation_partners cp
        JOIN private_messages pm ON (
          (pm.sender_id = $1 AND pm.recipient_id = cp.participant_id) OR
          (pm.sender_id = cp.participant_id AND pm.recipient_id = $1)
        )
        LEFT JOIN private_messages pm2 ON (
          pm2.sender_id = cp.participant_id AND 
          pm2.recipient_id = $1 AND
          pm2.created_at > COALESCE(
            (SELECT last_read_at FROM message_read_status WHERE user_id = $1 AND conversation_with = cp.participant_id),
            '1970-01-01'::timestamptz
          )
        )
        GROUP BY cp.participant_id, pm.id, pm.sender_id, pm.recipient_id, pm.content, pm.created_at
        ORDER BY participant_id, pm.created_at DESC
      )
      SELECT 
        lm.participant_id,
        p.display_name as participant_display_name,
        lm.id, lm.sender_id, lm.recipient_id, lm.content, lm.created_at,
        lm.unread_count
      FROM latest_messages lm
      LEFT JOIN players p ON p.id = lm.participant_id
      ORDER BY lm.created_at DESC
      LIMIT $2
    `;
    
    const result = await this.pool.query(query, [userId, limit]);
    
    return result.rows.map(row => ({
      participantId: row.participant_id,
      participantDisplayName: row.participant_display_name,
      lastMessage: {
        id: row.id,
        senderId: row.sender_id,
        recipientId: row.recipient_id,
        content: row.content,
        createdAt: new Date(row.created_at)
      },
      unreadCount: parseInt(row.unread_count) || 0
    }));
  }

  async markAsRead(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    
    // This is a simplified implementation - in production you'd want a proper read tracking table
    // For now, we'll just update a theoretical read status table
    const query = `
      INSERT INTO message_read_status (user_id, message_id, read_at)
      SELECT recipient_id, id, NOW()
      FROM private_messages
      WHERE id = ANY($1)
      ON CONFLICT (user_id, message_id) DO UPDATE SET read_at = NOW()
    `;
    
    await this.pool.query(query, [messageIds]);
  }

  async purgeOldMessages(olderThanDays: number): Promise<number> {
    const query = `
      DELETE FROM private_messages
      WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
    `;
    
    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }

  async purgeConversation(user1Id: string, user2Id: string): Promise<number> {
    const query = `
      DELETE FROM private_messages
      WHERE (sender_id = $1 AND recipient_id = $2) 
         OR (sender_id = $2 AND recipient_id = $1)
    `;
    
    const result = await this.pool.query(query, [user1Id, user2Id]);
    return result.rowCount || 0;
  }

  async getMessageCount(userId: string, unreadOnly = false): Promise<number> {
    let query: string;
    let params: any[];
    
    if (unreadOnly) {
      query = `
        SELECT COUNT(*)
        FROM private_messages pm
        LEFT JOIN message_read_status mrs ON (pm.id = mrs.message_id AND mrs.user_id = pm.recipient_id)
        WHERE pm.recipient_id = $1 AND mrs.read_at IS NULL
      `;
      params = [userId];
    } else {
      query = `
        SELECT COUNT(*)
        FROM private_messages
        WHERE sender_id = $1 OR recipient_id = $1
      `;
      params = [userId];
    }
    
    const result = await this.pool.query(query, params);
    return parseInt(result.rows[0].count) || 0;
  }

  private mapRowToPrivateMessage(row: PrivateMessageRow): PrivateMessage {
    return {
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      content: row.content,
      createdAt: new Date(row.created_at)
    };
  }
}

// Utility functions for message purging
export class MessagePurgeHelper {
  constructor(private repository: PrivateMessageRepository) {}

  async runScheduledPurge(retentionDays = 30): Promise<{ purgedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let purgedCount = 0;
    
    try {
      purgedCount = await this.repository.purgeOldMessages(retentionDays);
    } catch (error) {
      errors.push(`Failed to purge old messages: ${error}`);
    }
    
    return { purgedCount, errors };
  }

  async purgeUserConversations(userId: string, targetUserIds: string[]): Promise<{ purgedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let totalPurged = 0;
    
    for (const targetUserId of targetUserIds) {
      try {
        const purged = await this.repository.purgeConversation(userId, targetUserId);
        totalPurged += purged;
      } catch (error) {
        errors.push(`Failed to purge conversation with ${targetUserId}: ${error}`);
      }
    }
    
    return { purgedCount: totalPurged, errors };
  }
}

// Repository factory for dependency injection
export function createPrivateMessageRepository(pool: Pool): PrivateMessageRepository {
  return new PostgresPrivateMessageRepository(pool);
}

export function createMessagePurgeHelper(repository: PrivateMessageRepository): MessagePurgeHelper {
  return new MessagePurgeHelper(repository);
}