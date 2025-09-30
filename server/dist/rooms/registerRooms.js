import { randomUUID } from "node:crypto";
import { BattleRoom } from "./BattleRoom.js";
import { LobbyRoom } from "./LobbyRoom.js";
export async function registerRooms(options) {
    if (!options.battleRoom?.dependencies) {
        throw new Error("Battle room dependencies are required");
    }
    const battleRoomName = options.battleRoom.name?.trim().length ? options.battleRoom.name.trim() : "battle";
    const lobbyRoomName = options.lobby?.name?.trim().length ? options.lobby.name.trim() : "lobby";
    const normalizedBattleDeps = normalizeBattleDependencies(options.battleRoom.dependencies, options.logger);
    const defaultRulesetVersion = await resolveDefaultRulesetVersion(options.lobby?.defaultRulesetVersion, options.ruleSetService);
    const lobbyDependencies = buildLobbyDependencies(options.lobby?.dependencies, normalizedBattleDeps, options.logger, battleRoomName);
    options.gameServer.define(battleRoomName, BattleRoom);
    options.gameServer.define(lobbyRoomName, LobbyRoom, {
        defaultRulesetVersion,
        services: lobbyDependencies
    });
    return {
        battleRoomName,
        lobbyRoomName,
        defaultRulesetVersion
    };
}
function normalizeBattleDependencies(dependencies, fallbackLogger) {
    return {
        ...dependencies,
        logger: dependencies.logger ?? fallbackLogger ?? console,
        now: dependencies.now ?? (() => Date.now()),
        defaultGracePeriodMs: dependencies.defaultGracePeriodMs ?? 60_000
    };
}
async function resolveDefaultRulesetVersion(explicit, ruleSetService) {
    if (explicit && explicit.trim().length > 0) {
        return explicit.trim();
    }
    const latest = await ruleSetService.getLatestRuleSet();
    if (!latest) {
        throw new Error("Unable to determine default ruleset version for lobby room registration");
    }
    return latest.version;
}
function buildLobbyDependencies(overrides, battleDeps, fallbackLogger, battleRoomName) {
    const logger = overrides?.logger ?? fallbackLogger ?? console;
    const now = overrides?.now ?? (() => Date.now());
    const idGenerator = overrides?.idGenerator ?? (() => randomUUID());
    const dependencies = {
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
//# sourceMappingURL=registerRooms.js.map