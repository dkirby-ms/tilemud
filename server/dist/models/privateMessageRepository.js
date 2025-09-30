// PostgreSQL implementation
export class PostgresPrivateMessageRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async create(data) {
        const query = `
      INSERT INTO private_messages (id, sender_id, recipient_id, content, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, NOW())
      RETURNING id, sender_id, recipient_id, content, created_at
    `;
        const result = await this.pool.query(query, [
            data.senderId,
            data.recipientId,
            data.content
        ]);
        if (result.rows.length === 0) {
            throw new Error("Failed to create private message");
        }
        return this.mapRowToPrivateMessage(result.rows[0]);
    }
    async findById(id) {
        const query = `
      SELECT id, sender_id, recipient_id, content, created_at
      FROM private_messages
      WHERE id = $1
    `;
        const result = await this.pool.query(query, [id]);
        if (result.rows.length === 0) {
            return null;
        }
        return this.mapRowToPrivateMessage(result.rows[0]);
    }
    async findByConversation(user1Id, user2Id, limit = 50, offset = 0) {
        const query = `
      SELECT id, sender_id, recipient_id, content, created_at
      FROM private_messages
      WHERE (sender_id = $1 AND recipient_id = $2) 
         OR (sender_id = $2 AND recipient_id = $1)
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `;
        const result = await this.pool.query(query, [user1Id, user2Id, limit, offset]);
        return result.rows.map((row) => this.mapRowToPrivateMessage(row));
    }
    async findByRecipient(recipientId, limit = 50, offset = 0) {
        const query = `
      SELECT id, sender_id, recipient_id, content, created_at
      FROM private_messages
      WHERE recipient_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
        const result = await this.pool.query(query, [recipientId, limit, offset]);
        return result.rows.map((row) => this.mapRowToPrivateMessage(row));
    }
    async findBySender(senderId, limit = 50, offset = 0) {
        const query = `
      SELECT id, sender_id, recipient_id, content, created_at
      FROM private_messages
      WHERE sender_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
        const result = await this.pool.query(query, [senderId, limit, offset]);
        return result.rows.map((row) => this.mapRowToPrivateMessage(row));
    }
    async getMessageThreads(userId, limit = 20) {
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
    async markAsRead(messageIds) {
        if (messageIds.length === 0)
            return;
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
    async purgeOldMessages(olderThanDays) {
        const query = `
      DELETE FROM private_messages
      WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
    `;
        const result = await this.pool.query(query);
        return result.rowCount || 0;
    }
    async purgeConversation(user1Id, user2Id) {
        const query = `
      DELETE FROM private_messages
      WHERE (sender_id = $1 AND recipient_id = $2) 
         OR (sender_id = $2 AND recipient_id = $1)
    `;
        const result = await this.pool.query(query, [user1Id, user2Id]);
        return result.rowCount || 0;
    }
    async getMessageCount(userId, unreadOnly = false) {
        let query;
        let params;
        if (unreadOnly) {
            query = `
        SELECT COUNT(*)
        FROM private_messages pm
        LEFT JOIN message_read_status mrs ON (pm.id = mrs.message_id AND mrs.user_id = pm.recipient_id)
        WHERE pm.recipient_id = $1 AND mrs.read_at IS NULL
      `;
            params = [userId];
        }
        else {
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
    mapRowToPrivateMessage(row) {
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
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async runScheduledPurge(retentionDays = 30) {
        const errors = [];
        let purgedCount = 0;
        try {
            purgedCount = await this.repository.purgeOldMessages(retentionDays);
        }
        catch (error) {
            errors.push(`Failed to purge old messages: ${error}`);
        }
        return { purgedCount, errors };
    }
    async purgeUserConversations(userId, targetUserIds) {
        const errors = [];
        let totalPurged = 0;
        for (const targetUserId of targetUserIds) {
            try {
                const purged = await this.repository.purgeConversation(userId, targetUserId);
                totalPurged += purged;
            }
            catch (error) {
                errors.push(`Failed to purge conversation with ${targetUserId}: ${error}`);
            }
        }
        return { purgedCount: totalPurged, errors };
    }
}
// Repository factory for dependency injection
export function createPrivateMessageRepository(pool) {
    return new PostgresPrivateMessageRepository(pool);
}
export function createMessagePurgeHelper(repository) {
    return new MessagePurgeHelper(repository);
}
//# sourceMappingURL=privateMessageRepository.js.map