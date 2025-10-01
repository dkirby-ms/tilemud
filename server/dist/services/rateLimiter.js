import { randomBytes } from "node:crypto";
import { RateLimitError } from "../models/errorCodes.js";
const DEFAULT_CHANNEL_CONFIG = {
    chat_in_instance: {
        windows: [{ durationMs: 10_000, limit: 20 }]
    },
    private_message: {
        windows: [{ durationMs: 10_000, limit: 10 }]
    },
    tile_action: {
        windows: [
            { durationMs: 1_000, limit: 5 },
            { durationMs: 2_000, limit: 10 }
        ]
    }
};
export class RedisSlidingWindowStore {
    client;
    constructor(client) {
        this.client = client;
    }
    async cleanup(key, cutoffTimestamp) {
        await this.client.zRemRangeByScore(key, 0, cutoffTimestamp);
    }
    async count(key) {
        return this.client.zCard(key);
    }
    async add(key, score, member, ttlMs) {
        await this.client.zAdd(key, [{ score, value: member }]);
        await this.client.pExpire(key, ttlMs);
    }
    async getOldestScore(key) {
        const entries = await this.client.zRangeWithScores(key, 0, 0);
        if (entries.length === 0) {
            return null;
        }
        return entries[0].score;
    }
}
export class RateLimiterService {
    store;
    prefix;
    channels;
    clock;
    constructor(deps, options = {}) {
        this.store = deps.store;
        this.prefix = formatPrefix(options.prefix ?? "rate");
        this.clock = options.clock ?? (() => Date.now());
        this.channels = buildChannelConfig(options.channels);
    }
    static usingRedis(client, options) {
        return new RateLimiterService({ store: new RedisSlidingWindowStore(client) }, options);
    }
    async evaluate(channel, playerId) {
        const config = this.channels[channel];
        if (!config) {
            return { channel, allowed: true };
        }
        const now = this.clock();
        const windowStates = [];
        for (const window of config.windows) {
            const key = this.buildKey(channel, playerId, window.durationMs);
            await this.store.cleanup(key, now - window.durationMs);
            const count = await this.store.count(key);
            windowStates.push({ key, window, count });
        }
        const violatingWindows = windowStates.filter(state => state.count >= state.window.limit);
        if (violatingWindows.length > 0) {
            const retryAfterMs = await this.computeRetryAfter(now, violatingWindows);
            const representative = selectMostConstrainedWindow(violatingWindows);
            return {
                channel,
                allowed: false,
                retryAfter: msToSeconds(retryAfterMs),
                limit: representative.window.limit,
                windowMs: representative.window.durationMs,
                remaining: 0
            };
        }
        const memberId = generateMemberId(now);
        for (const state of windowStates) {
            await this.store.add(state.key, now, memberId, state.window.durationMs);
        }
        const limitingWindow = determineLimitingWindow(windowStates);
        const remaining = Math.max(0, limitingWindow.window.limit - (limitingWindow.count + 1));
        return {
            channel,
            allowed: true,
            remaining,
            limit: limitingWindow.window.limit,
            windowMs: limitingWindow.window.durationMs
        };
    }
    async enforce(channel, playerId) {
        const decision = await this.evaluate(channel, playerId);
        if (!decision.allowed) {
            throw new RateLimitError({
                channel: decision.channel,
                retryAfterSeconds: decision.retryAfter,
                limit: decision.limit,
                windowMs: decision.windowMs
            });
        }
        return decision;
    }
    buildKey(channel, playerId, durationMs) {
        return `${this.prefix}:${channel}:${playerId}:${durationMs}`;
    }
    async computeRetryAfter(now, violating) {
        let retryAfterMs = 0;
        for (const state of violating) {
            const oldestScore = await this.store.getOldestScore(state.key);
            const elapsed = oldestScore !== null ? now - oldestScore : 0;
            const wait = Math.max(0, state.window.durationMs - elapsed);
            retryAfterMs = Math.max(retryAfterMs, wait);
        }
        return retryAfterMs;
    }
}
function determineLimitingWindow(states) {
    return states.reduce((current, candidate) => {
        const currentRemaining = current.window.limit - (current.count + 1);
        const candidateRemaining = candidate.window.limit - (candidate.count + 1);
        if (candidateRemaining < currentRemaining) {
            return candidate;
        }
        if (candidateRemaining === currentRemaining && candidate.window.durationMs > current.window.durationMs) {
            return candidate;
        }
        return current;
    });
}
function selectMostConstrainedWindow(states) {
    return states.reduce((current, candidate) => {
        const currentWait = current.window.durationMs;
        const candidateWait = candidate.window.durationMs;
        if (candidateWait > currentWait) {
            return candidate;
        }
        if (candidateWait === currentWait) {
            return candidate.count > current.count ? candidate : current;
        }
        return current;
    });
}
function buildChannelConfig(overrides) {
    const merged = {};
    const sourceEntries = Object.entries(DEFAULT_CHANNEL_CONFIG);
    for (const [name, config] of sourceEntries) {
        merged[name] = normalizeChannelConfig(config);
    }
    if (overrides) {
        for (const [name, override] of Object.entries(overrides)) {
            if (!override) {
                delete merged[name];
                continue;
            }
            merged[name] = normalizeChannelConfig(override);
        }
    }
    return merged;
}
function normalizeChannelConfig(config) {
    const windows = [...config.windows]
        .map(window => ({
        durationMs: window.durationMs,
        limit: window.limit
    }))
        .filter(window => window.durationMs > 0 && window.limit > 0)
        .sort((a, b) => a.durationMs - b.durationMs);
    if (windows.length === 0) {
        throw new Error("Rate limit channel must define at least one valid window");
    }
    return {
        description: config.description,
        windows
    };
}
function formatPrefix(prefix) {
    return prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
}
function msToSeconds(ms) {
    if (ms <= 0) {
        return 1;
    }
    return Math.max(1, Math.ceil(ms / 1000));
}
function generateMemberId(now) {
    return `${now}-${randomBytes(4).toString("hex")}`;
}
export class InMemorySlidingWindowStore {
    buckets = new Map();
    async cleanup(key, cutoffTimestamp) {
        const entries = this.buckets.get(key);
        if (!entries) {
            return;
        }
        const filtered = entries.filter(score => score >= cutoffTimestamp);
        if (filtered.length === 0) {
            this.buckets.delete(key);
        }
        else {
            this.buckets.set(key, filtered);
        }
    }
    async count(key) {
        return this.buckets.get(key)?.length ?? 0;
    }
    async add(key, score, _member, _ttlMs) {
        const entries = this.buckets.get(key) ?? [];
        entries.push(score);
        this.buckets.set(key, entries);
    }
    async getOldestScore(key) {
        const entries = this.buckets.get(key);
        if (!entries || entries.length === 0) {
            return null;
        }
        return Math.min(...entries);
    }
}
export function createInMemoryRateLimiter(options = {}) {
    return new RateLimiterService({ store: new InMemorySlidingWindowStore() }, options);
}
export { DEFAULT_CHANNEL_CONFIG };
//# sourceMappingURL=rateLimiter.js.map