import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageService } from "../../src/services/messageService.js";
import type {
  PrivateMessage,
  PrivateMessageRepository,
  CreatePrivateMessageData,
  MessageThread
} from "../../src/models/privateMessageRepository.js";
import { TileMudError } from "../../src/models/errorCodes.js";
import type { RateLimiterService, RateLimitDecision } from "../../src/services/rateLimiter.js";

describe("MessageService", () => {
  const makeMessage = (overrides: Partial<PrivateMessage> = {}): PrivateMessage => ({
    id: overrides.id ?? "message-id",
    senderId: overrides.senderId ?? "sender",
    recipientId: overrides.recipientId ?? "recipient",
    content: overrides.content ?? "hello",
    createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z")
  });

  type MockFn<Args extends any[] = any[], Return = unknown> = ReturnType<typeof vi.fn<Args, Return>>;

  type RepositoryMocks = {
    create: MockFn<[CreatePrivateMessageData], Promise<PrivateMessage>>;
    findById: MockFn<[string], Promise<PrivateMessage | null>>;
    findByRecipient: MockFn<[string, number?, number?], Promise<PrivateMessage[]>>;
    findBySender: MockFn<[string, number?, number?], Promise<PrivateMessage[]>>;
    findByConversation: MockFn<[string, string, number?, number?], Promise<PrivateMessage[]>>;
    markAsRead: MockFn<[string[]], Promise<void>>;
    getMessageThreads: MockFn<[string, number?], Promise<MessageThread[]>>;
    getMessageCount: MockFn<[string, boolean?], Promise<number>>;
    purgeOldMessages: MockFn<[number], Promise<number>>;
    purgeConversation: MockFn<[string, string], Promise<number>>;
  };

  let repositoryMocks: RepositoryMocks;
  let repository: PrivateMessageRepository;
  let rateLimiterDecision: RateLimitDecision;
  let rateLimiterEnforce: MockFn<[string, string], Promise<RateLimitDecision>>;
  let rateLimiter: Pick<RateLimiterService, "enforce">;
  let service: MessageService;

  beforeEach(() => {
    repositoryMocks = {
      create: vi.fn<[CreatePrivateMessageData], Promise<PrivateMessage>>(),
      findById: vi.fn<[string], Promise<PrivateMessage | null>>(),
      findByRecipient: vi.fn<[string, number?, number?], Promise<PrivateMessage[]>>(),
      findBySender: vi.fn<[string, number?, number?], Promise<PrivateMessage[]>>(),
      findByConversation: vi.fn<[string, string, number?, number?], Promise<PrivateMessage[]>>(),
      markAsRead: vi.fn<[string[]], Promise<void>>(),
      getMessageThreads: vi.fn<[string, number?], Promise<MessageThread[]>>(),
      getMessageCount: vi.fn<[string, boolean?], Promise<number>>(),
      purgeOldMessages: vi.fn<[number], Promise<number>>(),
      purgeConversation: vi.fn<[string, string], Promise<number>>()
    };

    repository = {
      create: repositoryMocks.create,
      findById: repositoryMocks.findById,
      findByRecipient: repositoryMocks.findByRecipient,
      findBySender: repositoryMocks.findBySender,
      findByConversation: repositoryMocks.findByConversation,
      markAsRead: repositoryMocks.markAsRead,
      getMessageThreads: repositoryMocks.getMessageThreads,
      getMessageCount: repositoryMocks.getMessageCount,
      purgeOldMessages: repositoryMocks.purgeOldMessages,
      purgeConversation: repositoryMocks.purgeConversation
    };

    rateLimiterDecision = {
      channel: "private_message",
      allowed: true,
      remaining: 5,
      limit: 10,
      windowMs: 10_000
    };

    rateLimiterEnforce = vi.fn<[string, string], Promise<RateLimitDecision>>().mockResolvedValue(rateLimiterDecision);

    rateLimiter = {
      enforce: rateLimiterEnforce
    };

    service = new MessageService({
      repository,
      rateLimiter: rateLimiter as RateLimiterService
    });
  });

  it("sends a private message after rate limiting and content validation", async () => {
    const storedMessage = makeMessage({
      content: "trimmed",
      senderId: "alice",
      recipientId: "bob",
      createdAt: new Date("2025-01-02T00:00:00.000Z")
    });
    repositoryMocks.create.mockResolvedValue(storedMessage);

    const result = await service.sendPrivateMessage({
      senderId: "alice",
      recipientId: "bob",
      content: "  trimmed  "
    });

    expect(rateLimiterEnforce).toHaveBeenCalledWith("private_message", "alice");
    expect(repositoryMocks.create).toHaveBeenCalledWith({
      senderId: "alice",
      recipientId: "bob",
      content: "trimmed"
    });
    expect(result.message).toBe(storedMessage);
    expect(result.serialized).toMatchObject({
      id: storedMessage.id,
      senderId: "alice",
      recipientId: "bob",
      content: "trimmed",
      createdAt: storedMessage.createdAt.toISOString()
    });
    expect(result.rateLimit).toBe(rateLimiterDecision);
  });

  it("throws when permission evaluator denies the send", async () => {
    service = new MessageService({
      repository,
      rateLimiter: rateLimiter as RateLimiterService,
      permissionEvaluator: vi.fn().mockResolvedValue(false)
    });

    await expect(
      service.sendPrivateMessage({
        senderId: "alice",
        recipientId: "bob",
        content: "nope",
        requestId: "req-1"
      })
    ).rejects.toBeInstanceOf(TileMudError);

    expect(rateLimiterEnforce).not.toHaveBeenCalled();
    expect(repositoryMocks.create).not.toHaveBeenCalled();
  });

  it("lists a merged conversation respecting since filtering", async () => {
    const baseTime = new Date("2025-03-01T12:00:00.000Z");
    const older = makeMessage({
      id: "m1",
      senderId: "alice",
      recipientId: "bob",
      createdAt: new Date(baseTime.getTime() - 60_000)
    });
    const newer = makeMessage({
      id: "m2",
      senderId: "bob",
      recipientId: "alice",
      createdAt: baseTime
    });

    repositoryMocks.findByConversation.mockResolvedValue([older, newer]);

    const result = await service.listConversation("alice", "bob", {
      limit: 10,
      since: new Date(baseTime.getTime() - 30_000).toISOString()
    });

    expect(repositoryMocks.findByConversation).toHaveBeenCalledWith("alice", "bob", 10, 0);
    expect(result.items).toEqual([
      {
        id: "m2",
        senderId: "bob",
        recipientId: "alice",
        content: newer.content,
        createdAt: newer.createdAt.toISOString()
      }
    ]);
  });

  it("lists inbound, outbound, and both directions distinctly", async () => {
    const inbound = [
      makeMessage({ id: "in1", recipientId: "alice", senderId: "bob", createdAt: new Date("2025-01-01T00:00:00Z") }),
      makeMessage({ id: "in2", recipientId: "alice", senderId: "carl", createdAt: new Date("2025-01-01T00:01:00Z") })
    ];
    const outbound = [
      makeMessage({ id: "out1", senderId: "alice", recipientId: "bob", createdAt: new Date("2025-01-01T00:02:00Z") })
    ];
    repositoryMocks.findByRecipient.mockResolvedValue(inbound);
    repositoryMocks.findBySender.mockResolvedValue(outbound);

    const inboundResult = await service.listMessagesForPlayer("alice", { direction: "inbound", limit: 10 });
    expect(inboundResult.items.map(m => m.id)).toEqual(["in2", "in1"]);

    const outboundResult = await service.listMessagesForPlayer("alice", { direction: "outbound", limit: 10 });
    expect(outboundResult.items.map(m => m.id)).toEqual(["out1"]);

    const bothResult = await service.listMessagesForPlayer("alice", { direction: "both", limit: 10 });
    expect(bothResult.items.map(m => m.id)).toEqual(["out1", "in2", "in1"]);
  });

  it("markMessagesAsRead is a no-op for empty list", async () => {
    await service.markMessagesAsRead([]);
    expect(repositoryMocks.markAsRead).not.toHaveBeenCalled();
  });

  it("purge helpers proxy to repository", async () => {
    repositoryMocks.purgeOldMessages.mockResolvedValue(5);
    repositoryMocks.purgeConversation.mockResolvedValue(2);
    const purgedOld = await service.purgeOldMessages(30);
    const purgedConv = await service.purgeConversation("alice", "bob");
    expect(purgedOld).toBe(5);
    expect(purgedConv).toBe(2);
    expect(repositoryMocks.purgeOldMessages).toHaveBeenCalledWith(30);
    expect(repositoryMocks.purgeConversation).toHaveBeenCalledWith("alice", "bob");
  });
});
