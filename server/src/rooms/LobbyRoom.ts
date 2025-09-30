import { Room, type Client, matchMaker } from "colyseus";
import { Schema, MapSchema, defineTypes } from "@colyseus/schema";
import { randomUUID } from "node:crypto";
import {
  type BattleRoomDependencies,
  type BattleRoomCreateOptions
} from "./BattleRoom.js";
import {
  RuleSetNotFoundError,
  type RuleSetDetail
} from "@@/services/rulesetService.js";

interface LoggerLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

class LobbyInstanceState extends Schema {
  instanceId = "";
  roomId = "";
  rulesetVersion = "";
  maxPlayers = 0;
  reservedSlots = 0;
  createdAt = 0;
  isPrivate = false;
}

defineTypes(LobbyInstanceState, {
  instanceId: "string",
  roomId: "string",
  rulesetVersion: "string",
  maxPlayers: "uint16",
  reservedSlots: "uint16",
  createdAt: "uint64",
  isPrivate: "boolean"
});

class LobbyRoomState extends Schema {
  instances = new MapSchema<LobbyInstanceState>();
}

defineTypes(LobbyRoomState, {
  instances: { map: LobbyInstanceState }
});

export interface LobbyRoomMetadata {
  defaultRulesetVersion: string;
  createdAt: string;
}

type CreateRoomFn = typeof matchMaker.createRoom;

export interface LobbyRoomDependencies {
  battleRoomServices: BattleRoomDependencies;
  logger?: LoggerLike;
  now?: () => number;
  idGenerator?: () => string;
  battleRoomType?: string;
  createRoom?: CreateRoomFn;
}

export interface LobbyRoomCreateOptions {
  defaultRulesetVersion: string;
  services: LobbyRoomDependencies;
}

type NormalizedDependencies = Required<Pick<LobbyRoomDependencies, "battleRoomServices">> & {
  logger: LoggerLike;
  now: () => number;
  idGenerator: () => string;
  battleRoomType: string;
  createRoom: CreateRoomFn;
};

type InstanceErrorReason = "format" | "ruleset_not_found" | "internal";

type MatchMode = "solo" | "matchmaking";

interface CreateOrJoinRequest {
  mode: MatchMode;
  rulesetVersion?: string;
  requestId: string | null;
}

interface InstanceReadyPayload {
  requestId: string | null;
  instanceId: string;
  roomId: string;
  rulesetVersion: string;
  mode: MatchMode;
}

interface RegisterInstanceInput {
  instanceId: string;
  roomId: string;
  ruleSet: RuleSetDetail;
  mode: MatchMode;
}

const CREATE_OR_JOIN_MESSAGE = "instance.create_or_join";
const INSTANCE_READY_MESSAGE = "instance.ready";
const INSTANCE_ERROR_MESSAGE = "instance.error";

export class LobbyRoom extends Room<LobbyRoomState, LobbyRoomMetadata> {
  private dependencies!: NormalizedDependencies;
  private defaultRulesetVersion!: string;

  async onCreate(options: LobbyRoomCreateOptions): Promise<void> {
    if (!options.defaultRulesetVersion || options.defaultRulesetVersion.trim().length === 0) {
      throw new Error("LobbyRoom requires a defaultRulesetVersion");
    }

    this.dependencies = this.normalizeDependencies(options.services);
    this.defaultRulesetVersion = options.defaultRulesetVersion.trim();
    this.autoDispose = false;

    this.setState(new LobbyRoomState());

    await this.setMetadata({
      defaultRulesetVersion: this.defaultRulesetVersion,
      createdAt: new Date(this.dependencies.now()).toISOString()
    });

    this.onMessage(CREATE_OR_JOIN_MESSAGE, (client, payload) => {
      this.handleInstanceRequest(client, payload).catch((error) => {
        this.dependencies.logger.error?.("lobby.instance.request_failed", error);
        this.sendInstanceError(client, {
          requestId: null,
          reason: "internal",
          message: "Failed to process matchmaking request"
        });
      });
    });
  }

  protected async handleInstanceRequest(client: Client, rawPayload: unknown): Promise<void> {
    const request = this.parseCreateOrJoinRequest(rawPayload);
    const requestId = request.requestId;

    let version = request.rulesetVersion ?? this.defaultRulesetVersion;
    version = version.trim();

    if (version.length === 0) {
      this.sendInstanceError(client, {
        requestId,
        reason: "format",
        message: "rulesetVersion is required"
      });
      return;
    }

    let ruleSet: RuleSetDetail;
    try {
      ruleSet = await this.dependencies.battleRoomServices.ruleSetService.requireRuleSetByVersion(version);
    } catch (error) {
      if (error instanceof RuleSetNotFoundError) {
        this.sendInstanceError(client, {
          requestId,
          reason: "ruleset_not_found",
          message: `No rule set found for version ${version}`
        });
        return;
      }

      this.dependencies.logger.error?.("lobby.ruleset.lookup_failed", error);
      this.sendInstanceError(client, {
        requestId,
        reason: "internal",
        message: "Unable to resolve rule set"
      });
      return;
    }

    if (request.mode !== "solo") {
      const joinable = this.findJoinableInstance(ruleSet.version);
      if (joinable) {
        joinable.reservedSlots += 1;
        this.dependencies.logger.info?.("lobby.match.found", {
          instanceId: joinable.instanceId,
          roomId: joinable.roomId,
          rulesetVersion: joinable.rulesetVersion
        });
        this.sendInstanceReady(client, {
          requestId,
          instanceId: joinable.instanceId,
          roomId: joinable.roomId,
          rulesetVersion: joinable.rulesetVersion,
          mode: request.mode
        });
        return;
      }
    }

    const instanceId = this.dependencies.idGenerator();
    const creationOptions: BattleRoomCreateOptions = {
      instanceId,
      rulesetVersion: ruleSet.version,
      services: this.dependencies.battleRoomServices,
      startedAt: this.dependencies.now()
    };

    try {
  const created = await this.dependencies.createRoom(this.dependencies.battleRoomType, creationOptions);
      const roomId = this.extractRoomId(created);
      if (!roomId) {
        throw new Error("matchMaker.createRoom returned an invalid response");
      }

      const entry = this.registerInstance({
        instanceId,
        roomId,
        ruleSet,
        mode: request.mode
      });

      this.dependencies.logger.info?.("lobby.match.created", {
        instanceId: entry.instanceId,
        roomId: entry.roomId,
        rulesetVersion: entry.rulesetVersion,
        mode: request.mode
      });

      this.sendInstanceReady(client, {
        requestId,
        instanceId: entry.instanceId,
        roomId: entry.roomId,
        rulesetVersion: entry.rulesetVersion,
        mode: request.mode
      });
    } catch (error) {
      this.dependencies.logger.error?.("lobby.match.create_failed", error);
      this.sendInstanceError(client, {
        requestId,
        reason: "internal",
        message: "Failed to create battle instance"
      });
    }
  }

  public releaseReservation(instanceId: string): void {
    const entry = this.state.instances.get(instanceId);
    if (!entry) {
      return;
    }

    if (entry.reservedSlots > 0) {
      entry.reservedSlots -= 1;
    }

    if (entry.reservedSlots <= 0) {
      this.state.instances.delete(instanceId);
    }
  }

  public closeInstance(instanceId: string): void {
    this.state.instances.delete(instanceId);
  }

  private normalizeDependencies(deps: LobbyRoomDependencies): NormalizedDependencies {
    if (!deps || !deps.battleRoomServices) {
      throw new Error("LobbyRoom requires battleRoomServices dependency");
    }

    return {
      battleRoomServices: deps.battleRoomServices,
      logger: deps.logger ?? console,
      now: deps.now ?? (() => Date.now()),
      idGenerator: deps.idGenerator ?? (() => randomUUID()),
      battleRoomType: deps.battleRoomType ?? "battle",
      createRoom: deps.createRoom ?? ((roomName, options) => matchMaker.createRoom(roomName, options))
    };
  }

  private parseCreateOrJoinRequest(rawPayload: unknown): CreateOrJoinRequest {
    if (!rawPayload || typeof rawPayload !== "object") {
      return {
        mode: "matchmaking",
        rulesetVersion: undefined,
        requestId: null
      };
    }

    const source = rawPayload as Record<string, unknown>;
    const requestId = typeof source.requestId === "string" && source.requestId.trim().length > 0
      ? source.requestId.trim()
      : null;

    const rawMode = typeof source.mode === "string" ? source.mode.toLowerCase() : undefined;
    const mode: MatchMode = rawMode === "solo" ? "solo" : "matchmaking";

    const rulesetVersion = typeof source.rulesetVersion === "string"
      ? source.rulesetVersion.trim()
      : undefined;

    return {
      mode,
      rulesetVersion,
      requestId
    };
  }

  private findJoinableInstance(rulesetVersion: string): LobbyInstanceState | undefined {
    for (const entry of this.state.instances.values()) {
      if (entry.rulesetVersion === rulesetVersion && !entry.isPrivate && entry.reservedSlots < entry.maxPlayers) {
        return entry;
      }
    }
    return undefined;
  }

  private registerInstance(input: RegisterInstanceInput): LobbyInstanceState {
    const entry = new LobbyInstanceState();
    entry.instanceId = input.instanceId;
    entry.roomId = input.roomId;
    entry.rulesetVersion = input.ruleSet.version;
    entry.maxPlayers = Math.max(1, input.ruleSet.metadata.maxPlayers);
    entry.reservedSlots = 1;
    entry.createdAt = this.dependencies.now();
    entry.isPrivate = input.mode === "solo";
    this.state.instances.set(entry.instanceId, entry);
    return entry;
  }

  private extractRoomId(created: unknown): string | null {
    if (typeof created === "string") {
      return created;
    }

    if (created && typeof created === "object" && "roomId" in created) {
      const candidate = (created as { roomId?: unknown }).roomId;
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }

    return null;
  }

  private sendInstanceReady(client: Client, payload: InstanceReadyPayload): void {
    client.send(INSTANCE_READY_MESSAGE, {
      requestId: payload.requestId,
      instanceId: payload.instanceId,
      roomId: payload.roomId,
      rulesetVersion: payload.rulesetVersion,
      mode: payload.mode
    });
  }

  private sendInstanceError(
    client: Client,
    payload: { requestId: string | null; reason: InstanceErrorReason; message: string }
  ): void {
    client.send(INSTANCE_ERROR_MESSAGE, {
      requestId: payload.requestId,
      reason: payload.reason,
      message: payload.message
    });
  }
}
