import { describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { LobbyRoom, type LobbyRoomCreateOptions, type LobbyRoomDependencies } from "../../src/rooms/LobbyRoom.js";
import type { BattleRoomDependencies } from "../../src/rooms/BattleRoom.js";
import { SnapshotService } from "../../src/services/snapshotService.js";
import { createInMemoryRateLimiter } from "../../src/services/rateLimiter.js";
import type { RuleSetDetail, RuleSetService } from "../../src/services/rulesetService.js";
import { RuleSetNotFoundError } from "../../src/services/rulesetService.js";

type CreateRoomFunction = NonNullable<LobbyRoomDependencies["createRoom"]>;
type CreateRoomMock = ReturnType<typeof vi.fn>;

class StubRuleSetService implements Pick<RuleSetService, "requireRuleSetByVersion"> {
  private readonly entries = new Map<string, RuleSetDetail>();
  private error: Error | null = null;

  constructor(initialDetail: RuleSetDetail) {
    this.entries.set(initialDetail.version, initialDetail);
  }

  addDetail(detail: RuleSetDetail): void {
    this.entries.set(detail.version, detail);
  }

  failWith(error: Error | null): void {
    this.error = error;
  }

  async requireRuleSetByVersion(version: string): Promise<RuleSetDetail> {
    if (this.error) {
      throw this.error;
    }
    const found = this.entries.get(version);
    if (!found) {
      throw new RuleSetNotFoundError({ type: "version", value: version });
    }
    return found;
  }
}

interface CreateDependenciesOptions {
  now?: () => number;
  createRoomMock?: CreateRoomMock;
}

function createRuleSetDetail(version = "1.0.0"): RuleSetDetail {
  return {
    id: `ruleset-${version}`,
    version,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    metadata: {
      description: "Test ruleset",
      tags: ["test"],
      maxPlayers: 32,
      board: {
        width: 6,
        height: 6,
        initialTiles: [{ x: 1, y: 1, tileType: 2 }]
      },
      placement: {
        adjacency: "orthogonal",
        allowFirstPlacementAnywhere: true
      },
      extras: {}
    }
  };
}

function createClient(sessionId: string): Client {
  return {
    id: sessionId,
    sessionId,
    state: 1,
    auth: {},
    userData: {},
    _enqueuedMessages: [],
    send: vi.fn(),
    error: vi.fn(),
    leave: vi.fn()
  } as unknown as Client;
}

function createBattleRoomDependencies(ruleSetService: StubRuleSetService, now: () => number): BattleRoomDependencies {
  const rateLimiter = createInMemoryRateLimiter({ clock: now });
  const snapshotService = new SnapshotService({ clock: now });
  const reconnectService = {
    createSession: vi.fn(),
    attemptReconnect: vi.fn(),
    removeSession: vi.fn()
  };
  const messageService = {
    sendPrivateMessage: vi.fn()
  };
  const outcomeService = {
    recordOutcome: vi.fn()
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  return {
    rateLimiter,
    snapshotService,
    outcomeService,
    reconnectService,
    messageService,
    ruleSetService,
    logger,
    now,
    defaultGracePeriodMs: 60_000
  } satisfies BattleRoomDependencies;
}

function createLobbyDependencies(options: CreateDependenciesOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const ruleSetDetail = createRuleSetDetail();
  const ruleSetService = new StubRuleSetService(ruleSetDetail);
  const battleRoomServices = createBattleRoomDependencies(ruleSetService, now);
  const logger = battleRoomServices.logger!;
  const createRoomMock: CreateRoomMock = options.createRoomMock ?? vi.fn();
  if (!options.createRoomMock) {
    createRoomMock.mockResolvedValue({ roomId: "battle-room-123" } as any);
  }

  const dependencies: LobbyRoomDependencies = {
    battleRoomServices,
    logger,
    now,
    createRoom: createRoomMock as CreateRoomFunction
  } satisfies LobbyRoomDependencies;

  return { dependencies, ruleSetService, logger, createRoomMock };
}

function createLobbyRoom() {
  const lobby = new LobbyRoom();
  const setMetadata = vi.fn().mockResolvedValue(undefined);
  const onMessage = vi.fn();

  Object.assign(lobby as unknown as { setMetadata: typeof setMetadata; onMessage: typeof onMessage }, {
    setMetadata,
    onMessage
  });

  return { lobby, setMetadata, onMessage };
}

function extractMessage<T = unknown>(client: Client, type: string): T | undefined {
  const mock = client.send as ReturnType<typeof vi.fn>;
  for (const call of mock.mock.calls) {
    const [event, payload] = call;
    if (event === type) {
      return payload as T;
    }
  }
  return undefined;
}

describe("LobbyRoom", () => {
  it("creates a new battle instance when none is available", async () => {
  const { dependencies, createRoomMock } = createLobbyDependencies({ now: () => 1_000 });
    const { lobby } = createLobbyRoom();
    await lobby.onCreate({
      defaultRulesetVersion: "1.0.0",
      services: dependencies
    } satisfies LobbyRoomCreateOptions);

    const client = createClient("session-1");

    await (lobby as unknown as { handleInstanceRequest(client: Client, payload: unknown): Promise<void> })
      .handleInstanceRequest(client, { mode: "solo", requestId: "req-1" });

  expect(createRoomMock).toHaveBeenCalledTimes(1);
  const [roomName, optionsArg] = createRoomMock.mock.calls[0] as [string, Record<string, unknown>];
  expect(roomName).toBe("battle");
  expect(optionsArg).toMatchObject({
      rulesetVersion: "1.0.0",
      services: dependencies.battleRoomServices
    });

    const response = extractMessage<{ roomId: string; instanceId: string; rulesetVersion: string; requestId: string }>(client, "instance.ready");
    expect(response).toEqual(
      expect.objectContaining({
        roomId: "battle-room-123",
        rulesetVersion: "1.0.0",
        requestId: "req-1"
      })
    );
    expect(response?.instanceId).toBeDefined();

    const instanceId = response?.instanceId ?? "";
    const state = lobby.state.instances.get(instanceId);
    expect(state).toBeDefined();
    expect(state?.roomId).toBe("battle-room-123");
    expect(state?.reservedSlots).toBe(1);
  });

  it("reuses an existing matchmaking instance when capacity available", async () => {
    const { dependencies, createRoomMock } = createLobbyDependencies({ now: (() => {
      let current = 1_000;
      return () => (current += 1);
    })() });
    const { lobby } = createLobbyRoom();
    await lobby.onCreate({
      defaultRulesetVersion: "1.0.0",
      services: dependencies
    } satisfies LobbyRoomCreateOptions);

    const firstClient = createClient("session-1");
    await (lobby as unknown as { handleInstanceRequest(client: Client, payload: unknown): Promise<void> })
      .handleInstanceRequest(firstClient, { mode: "matchmaking" });

    const firstResponse = extractMessage<{ roomId: string; instanceId: string }>(firstClient, "instance.ready");
    expect(firstResponse).toBeDefined();
    const instanceId = firstResponse?.instanceId ?? "";

  createRoomMock.mockClear();

    const secondClient = createClient("session-2");
    await (lobby as unknown as { handleInstanceRequest(client: Client, payload: unknown): Promise<void> })
      .handleInstanceRequest(secondClient, { mode: "matchmaking" });

  expect(createRoomMock).not.toHaveBeenCalled();

    const secondResponse = extractMessage<{ instanceId: string }>(secondClient, "instance.ready");
    expect(secondResponse?.instanceId).toBe(instanceId);

    const state = lobby.state.instances.get(instanceId);
    expect(state?.reservedSlots).toBe(2);
  });

  it("returns error when requested rule set is missing", async () => {
    const { dependencies, ruleSetService, createRoomMock } = createLobbyDependencies();
    ruleSetService.failWith(new RuleSetNotFoundError({ type: "version", value: "2.0.0" }));

    const { lobby } = createLobbyRoom();
    await lobby.onCreate({
      defaultRulesetVersion: "1.0.0",
      services: dependencies
    } satisfies LobbyRoomCreateOptions);

    const client = createClient("session-1");

    await (lobby as unknown as { handleInstanceRequest(client: Client, payload: unknown): Promise<void> })
      .handleInstanceRequest(client, { mode: "matchmaking", rulesetVersion: "2.0.0", requestId: "req-err" });

  expect(createRoomMock).not.toHaveBeenCalled();

    const errorResponse = extractMessage<{ reason: string; requestId: string | null }>(client, "instance.error");
    expect(errorResponse).toEqual(
      expect.objectContaining({
        reason: "ruleset_not_found",
        requestId: "req-err"
      })
    );
  });

  it("returns internal error when matchmaker fails", async () => {
    const { dependencies, createRoomMock } = createLobbyDependencies();
    createRoomMock.mockRejectedValueOnce(new Error("boom"));
    const { lobby } = createLobbyRoom();
    await lobby.onCreate({
      defaultRulesetVersion: "1.0.0",
      services: dependencies
    } satisfies LobbyRoomCreateOptions);

    const client = createClient("session-1");

    await (lobby as unknown as { handleInstanceRequest(client: Client, payload: unknown): Promise<void> })
      .handleInstanceRequest(client, { mode: "matchmaking" });

    const errorResponse = extractMessage<{ reason: string }>(client, "instance.error");
    expect(errorResponse?.reason).toBe("internal");
    expect(lobby.state.instances.size).toBe(0);
  });

  it("supports custom rulesetVersion in payload", async () => {
    const { dependencies, ruleSetService } = createLobbyDependencies();
    const alternate = createRuleSetDetail("2.5.0");
    ruleSetService.addDetail(alternate);

    const { lobby } = createLobbyRoom();
    await lobby.onCreate({
      defaultRulesetVersion: "1.0.0",
      services: dependencies
    } satisfies LobbyRoomCreateOptions);

    const client = createClient("session-3");

    await (lobby as unknown as { handleInstanceRequest(client: Client, payload: unknown): Promise<void> })
      .handleInstanceRequest(client, { rulesetVersion: "2.5.0", mode: "matchmaking" });

    const response = extractMessage<{ rulesetVersion: string }>(client, "instance.ready");
    expect(response?.rulesetVersion).toBe("2.5.0");
  });
});
