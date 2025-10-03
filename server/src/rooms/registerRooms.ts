import { randomUUID } from "node:crypto";
import type { Server } from "colyseus";
import { BattleRoom, type BattleRoomDependencies } from "./BattleRoom.js";
import { LobbyRoom, type LobbyRoomDependencies } from "./LobbyRoom.js";
import { GameRoom, type GameRoomDependencies } from "./GameRoom.js";
import type { RuleSetService } from "@@/services/rulesetService.js";

interface LoggerLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

export interface RegisterRoomsOptions {
  gameServer: Pick<Server, "define">;
  ruleSetService: Pick<RuleSetService, "getLatestRuleSet">;
  gameRoom: {
    name?: string;
    dependencies: GameRoomDependencies;
  };
  battleRoom: {
    name?: string;
    dependencies: BattleRoomDependencies;
  };
  lobby?: {
    name?: string;
    defaultRulesetVersion?: string;
    dependencies?: Omit<LobbyRoomDependencies, "battleRoomServices">;
  };
  logger?: LoggerLike;
}

export interface RegisterRoomsResult {
  gameRoomName: string;
  battleRoomName: string;
  lobbyRoomName: string;
  defaultRulesetVersion: string;
}

type NormalizedBattleDependencies = BattleRoomDependencies & Required<Pick<BattleRoomDependencies, "logger" | "now" | "defaultGracePeriodMs">>;
type NormalizedGameDependencies = GameRoomDependencies & Required<Pick<GameRoomDependencies, "logger">> & { now: () => Date };

type RuleSetServiceWithLatest = Pick<RuleSetService, "getLatestRuleSet">;

type LobbyDependencyOverrides = Omit<LobbyRoomDependencies, "battleRoomServices"> | undefined;

export async function registerRooms(options: RegisterRoomsOptions): Promise<RegisterRoomsResult> {
  if (!options.gameRoom?.dependencies) {
    throw new Error("Game room dependencies are required");
  }
  if (!options.battleRoom?.dependencies) {
    throw new Error("Battle room dependencies are required");
  }

  const gameRoomName = options.gameRoom.name?.trim().length ? options.gameRoom.name.trim() : "game";
  const battleRoomName = options.battleRoom.name?.trim().length ? options.battleRoom.name.trim() : "battle";
  const lobbyRoomName = options.lobby?.name?.trim().length ? options.lobby.name.trim() : "lobby";

  const normalizedGameDeps = normalizeGameDependencies(options.gameRoom.dependencies, options.logger);
  const normalizedBattleDeps = normalizeBattleDependencies(options.battleRoom.dependencies, options.logger);

  const defaultRulesetVersion = await resolveDefaultRulesetVersion(
    options.lobby?.defaultRulesetVersion,
    options.ruleSetService
  );

  const lobbyDependencies = buildLobbyDependencies(
    options.lobby?.dependencies,
    normalizedBattleDeps,
    options.logger,
    battleRoomName
  );

  options.gameServer.define(gameRoomName, GameRoom, {
    services: normalizedGameDeps
  });
  options.gameServer.define(battleRoomName, BattleRoom);

  options.gameServer.define(lobbyRoomName, LobbyRoom, {
    defaultRulesetVersion,
    services: lobbyDependencies
  });

  return {
    gameRoomName,
    battleRoomName,
    lobbyRoomName,
    defaultRulesetVersion
  } satisfies RegisterRoomsResult;
}

function normalizeBattleDependencies(
  dependencies: BattleRoomDependencies,
  fallbackLogger?: LoggerLike
): NormalizedBattleDependencies {
  return {
    ...dependencies,
    logger: dependencies.logger ?? fallbackLogger ?? console,
    now: dependencies.now ?? (() => Date.now()),
    defaultGracePeriodMs: dependencies.defaultGracePeriodMs ?? 60_000
  };
}

async function resolveDefaultRulesetVersion(
  explicit: string | undefined,
  ruleSetService: RuleSetServiceWithLatest
): Promise<string> {
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }

  const latest = await ruleSetService.getLatestRuleSet();
  if (!latest) {
    return "0.0.0-dev";
  }

  return latest.version;
}

function buildLobbyDependencies(
  overrides: LobbyDependencyOverrides,
  battleDeps: NormalizedBattleDependencies,
  fallbackLogger: LoggerLike | undefined,
  battleRoomName: string
): LobbyRoomDependencies {
  const logger = overrides?.logger ?? fallbackLogger ?? console;
  const now = overrides?.now ?? (() => Date.now());
  const idGenerator = overrides?.idGenerator ?? (() => randomUUID());
  const dependencies: LobbyRoomDependencies = {
    battleRoomServices: battleDeps,
    logger,
    now,
    idGenerator,
    battleRoomType: overrides?.battleRoomType ?? battleRoomName
  };

  if (typeof overrides?.createRoom === "function") {
    dependencies.createRoom = overrides.createRoom;
  }

  return dependencies;
}

function normalizeGameDependencies(
  dependencies: GameRoomDependencies,
  fallbackLogger?: LoggerLike
): NormalizedGameDependencies {
  return {
    ...dependencies,
    logger: dependencies.logger ?? fallbackLogger ?? console,
    now: dependencies.now ?? (() => new Date())
  } satisfies NormalizedGameDependencies;
}
