import type {
  PrivateMessage,
  PrivateMessageRepository,
  CreatePrivateMessageData,
  MessageThread
} from "../models/privateMessageRepository.js";
import { TileMudError } from "../models/errorCodes.js";
import { RateLimiterService, RateLimitDecision } from "./rateLimiter.js";

export type MessageDirection = "inbound" | "outbound" | "both";

export interface SerializedPrivateMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
}

export interface SendPrivateMessageInput {
  senderId: string;
  recipientId: string;
  content: string;
  requestId?: string;
}

export interface SendPrivateMessageResult {
  message: PrivateMessage;
  serialized: SerializedPrivateMessage;
  rateLimit: RateLimitDecision;
}

export interface ListMessagesOptions {
  direction?: MessageDirection;
  limit?: number;
  since?: Date | string;
}

export interface ConversationOptions {
  limit?: number;
  offset?: number;
  since?: Date | string;
}

export interface MessageListResult {
  items: SerializedPrivateMessage[];
}

export type MessagePermissionEvaluator = (
  senderId: string,
  recipientId: string
) => boolean | Promise<boolean>;

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const MAX_CONTENT_LENGTH = 2000;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || Number.isNaN(limit)) {
    return DEFAULT_MESSAGE_LIMIT;
  }
  return Math.min(Math.max(1, Math.floor(limit)), MAX_MESSAGE_LIMIT);
}

function normalizeSince(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function serializeMessage(message: PrivateMessage): SerializedPrivateMessage {
  return {
    id: message.id,
    senderId: message.senderId,
    recipientId: message.recipientId,
    content: message.content,
    createdAt: message.createdAt.toISOString()
  };
}

function filterBySince(messages: PrivateMessage[], since?: Date): PrivateMessage[] {
  if (!since) {
    return messages;
  }
  const threshold = since.getTime();
  return messages.filter((message) => message.createdAt.getTime() >= threshold);
}

function sortMessages(messages: PrivateMessage[]): PrivateMessage[] {
  return [...messages].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function mergeAndSortMessages(a: PrivateMessage[], b: PrivateMessage[]): PrivateMessage[] {
  const merged: PrivateMessage[] = [];
  const seen = new Set<string>();

  for (const message of [...a, ...b]) {
    if (!seen.has(message.id)) {
      seen.add(message.id);
      merged.push(message);
    }
  }

  return sortMessages(merged);
}

function validateContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error("Message content must not be empty.");
  }
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Message content must not exceed ${MAX_CONTENT_LENGTH} characters.`);
  }
  return trimmed;
}

export interface MessageServiceDependencies {
  repository: PrivateMessageRepository;
  rateLimiter: RateLimiterService;
  permissionEvaluator?: MessagePermissionEvaluator;
}

export class MessageService {
  private readonly repository: PrivateMessageRepository;
  private readonly rateLimiter: RateLimiterService;
  private readonly permissionEvaluator?: MessagePermissionEvaluator;

  constructor(dependencies: MessageServiceDependencies) {
    this.repository = dependencies.repository;
    this.rateLimiter = dependencies.rateLimiter;
    this.permissionEvaluator = dependencies.permissionEvaluator;
  }

  async sendPrivateMessage(input: SendPrivateMessageInput): Promise<SendPrivateMessageResult> {
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

    const messageData: CreatePrivateMessageData = {
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

  async listMessagesForPlayer(playerId: string, options: ListMessagesOptions = {}): Promise<MessageListResult> {
    const direction = options.direction ?? "both";
    const limit = clampLimit(options.limit);
    const since = normalizeSince(options.since);

    let messages: PrivateMessage[];

    if (direction === "inbound") {
      const inbound = await this.repository.findByRecipient(playerId, limit * 2);
      messages = sortMessages(filterBySince(inbound, since)).slice(0, limit);
    } else if (direction === "outbound") {
      const outbound = await this.repository.findBySender(playerId, limit * 2);
      messages = sortMessages(filterBySince(outbound, since)).slice(0, limit);
    } else {
      const inbound = await this.repository.findByRecipient(playerId, limit * 2);
      const outbound = await this.repository.findBySender(playerId, limit * 2);
      const merged = mergeAndSortMessages(filterBySince(inbound, since), filterBySince(outbound, since));
      messages = merged.slice(0, limit);
    }

    return {
      items: messages.map(serializeMessage)
    };
  }

  async listConversation(
    playerId: string,
    otherPlayerId: string,
    options: ConversationOptions = {}
  ): Promise<MessageListResult> {
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const since = normalizeSince(options.since);

    const messages = await this.repository.findByConversation(playerId, otherPlayerId, limit, offset);
    const filtered = filterBySince(messages, since ?? undefined);

    return {
      items: sortMessages(filtered).map(serializeMessage)
    };
  }

  async markMessagesAsRead(messageIds: string[]): Promise<void> {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return;
    }
    await this.repository.markAsRead(messageIds);
  }

  async getMessageThreads(playerId: string, limit = DEFAULT_MESSAGE_LIMIT): Promise<MessageThread[]> {
    return this.repository.getMessageThreads(playerId, clampLimit(limit));
  }

  async getMessageCount(playerId: string, unreadOnly = false): Promise<number> {
    return this.repository.getMessageCount(playerId, unreadOnly);
  }

  async purgeOldMessages(retentionDays: number): Promise<number> {
    return this.repository.purgeOldMessages(retentionDays);
  }

  async purgeConversation(playerId: string, otherPlayerId: string): Promise<number> {
    return this.repository.purgeConversation(playerId, otherPlayerId);
  }

  serialize(message: PrivateMessage): SerializedPrivateMessage {
    return serializeMessage(message);
  }

  serializeMany(messages: PrivateMessage[]): SerializedPrivateMessage[] {
    return messages.map(serializeMessage);
  }
}
