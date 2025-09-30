import { TileMudError } from "@@/models/errorCodes.js";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
function clampLimit(limit) {
    if (typeof limit !== "number" || Number.isNaN(limit)) {
        return DEFAULT_LIMIT;
    }
    const clamped = Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
    return clamped;
}
function normalizeOffset(offset) {
    if (typeof offset !== "number" || Number.isNaN(offset) || offset <= 0) {
        return 0;
    }
    return Math.floor(offset);
}
function cloneOutcomePayload(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}
function serializeParticipants(players) {
    return players.map((player) => {
        const baseStats = {
            displayName: player.displayName
        };
        if ("stats" in player && player.stats && typeof player.stats === "object") {
            Object.assign(baseStats, player.stats);
        }
        if (typeof player.finalScore === "number") {
            baseStats.finalScore = player.finalScore;
        }
        if (player.role) {
            baseStats.role = player.role;
        }
        return {
            playerId: player.id,
            initiative: player.initiativeRank,
            stats: baseStats,
            displayName: player.displayName,
            role: player.role,
            finalScore: player.finalScore
        };
    });
}
export class OutcomeService {
    repository;
    constructor(dependencies) {
        this.repository = dependencies.repository;
    }
    async recordOutcome(data) {
        const endedAt = data.endedAt ?? new Date();
        const created = await this.repository.create({
            ...data,
            endedAt
        });
        return {
            outcome: created,
            serialized: this.serialize(created)
        };
    }
    async getOutcomeById(id, options = {}) {
        const outcome = await this.repository.findById(id);
        if (!outcome) {
            throw new TileMudError("INSTANCE_TERMINATED", { outcomeId: id }, options.requestId);
        }
        return this.serialize(outcome);
    }
    async getOutcomeByInstanceId(instanceId, options = {}) {
        const outcome = await this.repository.findByInstanceId(instanceId);
        if (!outcome) {
            throw new TileMudError("INSTANCE_TERMINATED", { instanceId }, options.requestId);
        }
        return this.serialize(outcome);
    }
    async listOutcomesForPlayer(playerId, options = {}) {
        const limit = clampLimit(options.limit);
        const offset = normalizeOffset(options.offset);
        const outcomes = await this.repository.findByPlayer(playerId, limit, offset);
        return {
            items: outcomes.map((outcome) => this.serialize(outcome))
        };
    }
    async listRecentOutcomes(options = {}) {
        const limit = clampLimit(options.limit);
        const offset = normalizeOffset(options.offset);
        const outcomes = await this.repository.findRecent(limit, offset);
        return {
            items: outcomes.map((outcome) => this.serialize(outcome))
        };
    }
    async getPlayerStatistics(playerId) {
        return this.repository.getPlayerStatistics(playerId);
    }
    serialize(outcome) {
        return {
            id: outcome.id,
            instanceId: outcome.instanceId,
            rulesetVersion: outcome.rulesetVersion,
            startedAt: outcome.startedAt.toISOString(),
            endedAt: outcome.endedAt.toISOString(),
            durationMs: outcome.durationMs,
            participants: serializeParticipants(outcome.participantsJson.players),
            outcome: cloneOutcomePayload(outcome.outcomeJson),
            createdAt: outcome.createdAt.toISOString()
        };
    }
    serializeMany(outcomes) {
        return outcomes.map((outcome) => this.serialize(outcome));
    }
}
//# sourceMappingURL=outcomeService.js.map