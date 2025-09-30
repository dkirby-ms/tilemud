import { TileMudError } from "@@/models/errorCodes.js";
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const MAX_CONTENT_LENGTH = 2000;
function clampLimit(limit) {
    if (typeof limit !== "number" || Number.isNaN(limit)) {
        return DEFAULT_MESSAGE_LIMIT;
    }
    return Math.min(Math.max(1, Math.floor(limit)), MAX_MESSAGE_LIMIT);
}
function normalizeSince(value) {
    if (!value) {
        return undefined;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
function serializeMessage(message) {
    return {
        id: message.id,
        senderId: message.senderId,
        recipientId: message.recipientId,
        content: message.content,
        createdAt: message.createdAt.toISOString()
    };
}
function filterBySince(messages, since) {
    if (!since) {
        return messages;
    }
    const threshold = since.getTime();
    return messages.filter((message) => message.createdAt.getTime() >= threshold);
}
function sortMessages(messages) {
    return [...messages].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
function mergeAndSortMessages(a, b) {
    const merged = [];
    const seen = new Set();
    for (const message of [...a, ...b]) {
        if (!seen.has(message.id)) {
            seen.add(message.id);
            merged.push(message);
        }
    }
    return sortMessages(merged);
}
function validateContent(content) {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
        throw new Error("Message content must not be empty.");
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
        throw new Error(`Message content must not exceed ${MAX_CONTENT_LENGTH} characters.`);
    }
    return trimmed;
}
export class MessageService {
    repository;
    rateLimiter;
    permissionEvaluator;
    constructor(dependencies) {
        this.repository = dependencies.repository;
        this.rateLimiter = dependencies.rateLimiter;
        this.permissionEvaluator = dependencies.permissionEvaluator;
    }
    async sendPrivateMessage(input) {
        if (input.senderId === input.recipientId) {
            throw new Error("Cannot send a private message to the same player.");
        }
        if (this.permissionEvaluator) {
            const allowed = await this.permissionEvaluator(input.senderId, input.recipientId);
            if (!allowed) {
                throw new TileMudError("UNAUTHORIZED_PRIVATE_MESSAGE", {
                    senderId: input.senderId,
                    recipientId: input.recipientId
                }, input.requestId);
            }
        }
        const sanitizedContent = validateContent(input.content);
        const rateLimitDecision = await this.rateLimiter.enforce("private_message", input.senderId);
        const messageData = {
            senderId: input.senderId,
            recipientId: input.recipientId,
            content: sanitizedContent
        };
        const message = await this.repository.create(messageData);
        return {
            message,
            serialized: serializeMessage(message),
            rateLimit: rateLimitDecision
        };
    }
    async listMessagesForPlayer(playerId, options = {}) {
        const direction = options.direction ?? "both";
        const limit = clampLimit(options.limit);
        const since = normalizeSince(options.since);
        let messages;
        if (direction === "inbound") {
            const inbound = await this.repository.findByRecipient(playerId, limit * 2);
            messages = sortMessages(filterBySince(inbound, since)).slice(0, limit);
        }
        else if (direction === "outbound") {
            const outbound = await this.repository.findBySender(playerId, limit * 2);
            messages = sortMessages(filterBySince(outbound, since)).slice(0, limit);
        }
        else {
            const inbound = await this.repository.findByRecipient(playerId, limit * 2);
            const outbound = await this.repository.findBySender(playerId, limit * 2);
            const merged = mergeAndSortMessages(filterBySince(inbound, since), filterBySince(outbound, since));
            messages = merged.slice(0, limit);
        }
        return {
            items: messages.map(serializeMessage)
        };
    }
    async listConversation(playerId, otherPlayerId, options = {}) {
        const limit = clampLimit(options.limit);
        const offset = Math.max(0, Math.floor(options.offset ?? 0));
        const since = normalizeSince(options.since);
        const messages = await this.repository.findByConversation(playerId, otherPlayerId, limit, offset);
        const filtered = filterBySince(messages, since ?? undefined);
        return {
            items: sortMessages(filtered).map(serializeMessage)
        };
    }
    async markMessagesAsRead(messageIds) {
        if (!Array.isArray(messageIds) || messageIds.length === 0) {
            return;
        }
        await this.repository.markAsRead(messageIds);
    }
    async getMessageThreads(playerId, limit = DEFAULT_MESSAGE_LIMIT) {
        return this.repository.getMessageThreads(playerId, clampLimit(limit));
    }
    async getMessageCount(playerId, unreadOnly = false) {
        return this.repository.getMessageCount(playerId, unreadOnly);
    }
    async purgeOldMessages(retentionDays) {
        return this.repository.purgeOldMessages(retentionDays);
    }
    async purgeConversation(playerId, otherPlayerId) {
        return this.repository.purgeConversation(playerId, otherPlayerId);
    }
    serialize(message) {
        return serializeMessage(message);
    }
    serializeMany(messages) {
        return messages.map(serializeMessage);
    }
}
//# sourceMappingURL=messageService.js.map