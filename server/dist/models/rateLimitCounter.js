// Rate limit counter implementation using Redis
export class RateLimitCounter {
    redis;
    defaultConfig;
    constructor(options) {
        this.redis = options.redis;
        this.defaultConfig = {
            keyPrefix: "rate_limit:",
            ...options.defaultConfig
        };
    }
    async checkLimit(identifier, channel = "default", config) {
        const finalConfig = { ...this.defaultConfig, ...config };
        const key = this.buildKey(identifier, channel, finalConfig.keyPrefix);
        const currentTime = Date.now();
        const windowStart = currentTime - finalConfig.windowSizeMs;
        // Use Redis transaction to ensure atomicity
        const pipeline = this.redis.pipeline();
        // Remove expired entries
        pipeline.zremrangebyscore(key, 0, windowStart);
        // Count current requests in window
        pipeline.zcard(key);
        // Add current request with timestamp as score
        pipeline.zadd(key, currentTime, `${currentTime}-${Math.random()}`);
        // Set expiration for cleanup
        pipeline.expire(key, Math.ceil(finalConfig.windowSizeMs / 1000));
        const results = await pipeline.exec();
        if (!results || results.some(([err]) => err)) {
            throw new Error("Redis rate limit operation failed");
        }
        const currentCount = results[1][1] + 1; // +1 for the request we just added
        const allowed = currentCount <= finalConfig.maxRequests;
        if (!allowed) {
            // Remove the request we just added since it's not allowed
            await this.redis.zrem(key, `${currentTime}-${Math.random()}`);
        }
        const resetTimeMs = currentTime + finalConfig.windowSizeMs;
        const remainingRequests = Math.max(0, finalConfig.maxRequests - currentCount);
        const result = {
            allowed,
            remainingRequests: allowed ? remainingRequests : 0,
            resetTimeMs
        };
        if (!allowed) {
            // Calculate retry-after based on oldest request in window
            const oldestRequests = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
            if (oldestRequests.length >= 2) {
                const oldestTimestamp = parseInt(oldestRequests[1]);
                result.retryAfterMs = Math.max(0, oldestTimestamp + finalConfig.windowSizeMs - currentTime);
            }
            else {
                result.retryAfterMs = finalConfig.windowSizeMs;
            }
        }
        return result;
    }
    async getRemainingRequests(identifier, channel = "default", config) {
        const finalConfig = { ...this.defaultConfig, ...config };
        const key = this.buildKey(identifier, channel, finalConfig.keyPrefix);
        const currentTime = Date.now();
        const windowStart = currentTime - finalConfig.windowSizeMs;
        // Clean up expired entries and count current
        await this.redis.zremrangebyscore(key, 0, windowStart);
        const currentCount = await this.redis.zcard(key);
        return Math.max(0, finalConfig.maxRequests - currentCount);
    }
    async resetLimit(identifier, channel = "default", keyPrefix) {
        const prefix = keyPrefix || this.defaultConfig.keyPrefix;
        const key = this.buildKey(identifier, channel, prefix);
        await this.redis.del(key);
    }
    async getAllLimits(identifier, keyPrefix) {
        const prefix = keyPrefix || this.defaultConfig.keyPrefix;
        const pattern = `${prefix}${identifier}:*`;
        const keys = await this.redis.keys(pattern);
        const results = [];
        for (const key of keys) {
            const channel = key.split(':').pop() || 'default';
            const count = await this.redis.zcard(key);
            const ttl = await this.redis.ttl(key);
            const resetTimeMs = ttl > 0 ? Date.now() + (ttl * 1000) : 0;
            results.push({ channel, count, resetTimeMs });
        }
        return results;
    }
    async cleanupExpiredLimits(olderThanMs = 24 * 60 * 60 * 1000, // 24 hours
    batchSize = 100) {
        const keyPrefix = this.defaultConfig.keyPrefix;
        const pattern = `${keyPrefix}*`;
        let cursor = 0;
        let deletedCount = 0;
        do {
            const [newCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', batchSize);
            cursor = parseInt(newCursor);
            if (keys.length > 0) {
                const pipeline = this.redis.pipeline();
                for (const key of keys) {
                    // Check if key has any entries older than threshold
                    const cutoff = Date.now() - olderThanMs;
                    pipeline.zremrangebyscore(key, 0, cutoff);
                }
                const results = await pipeline.exec();
                if (results) {
                    deletedCount += results.reduce((sum, [, count]) => sum + (count || 0), 0);
                }
            }
        } while (cursor !== 0);
        return deletedCount;
    }
    buildKey(identifier, channel, keyPrefix) {
        return `${keyPrefix}${identifier}:${channel}`;
    }
}
// Pre-configured rate limit instances
export class GameRateLimits {
    counter;
    constructor(redis) {
        this.counter = new RateLimitCounter({
            redis,
            defaultConfig: {
                windowSizeMs: 60000, // 1 minute
                maxRequests: 10,
                keyPrefix: "game_rate_limit:"
            }
        });
    }
    // Action rate limiting (tile placement, etc.)
    async checkActionLimit(playerId) {
        return this.counter.checkLimit(playerId, "actions", {
            windowSizeMs: 10000, // 10 seconds
            maxRequests: 5
        });
    }
    // Chat message rate limiting
    async checkChatLimit(playerId) {
        return this.counter.checkLimit(playerId, "chat", {
            windowSizeMs: 60000, // 1 minute
            maxRequests: 20
        });
    }
    // Private message rate limiting
    async checkPrivateMessageLimit(playerId) {
        return this.counter.checkLimit(playerId, "private_messages", {
            windowSizeMs: 300000, // 5 minutes
            maxRequests: 10
        });
    }
    // Instance creation rate limiting
    async checkInstanceCreationLimit(playerId) {
        return this.counter.checkLimit(playerId, "instance_creation", {
            windowSizeMs: 3600000, // 1 hour
            maxRequests: 3
        });
    }
    // API request rate limiting
    async checkApiLimit(identifier) {
        return this.counter.checkLimit(identifier, "api", {
            windowSizeMs: 60000, // 1 minute
            maxRequests: 100
        });
    }
    async resetPlayerLimits(playerId) {
        await Promise.all([
            this.counter.resetLimit(playerId, "actions"),
            this.counter.resetLimit(playerId, "chat"),
            this.counter.resetLimit(playerId, "private_messages"),
            this.counter.resetLimit(playerId, "instance_creation")
        ]);
    }
    async getPlayerLimitStatus(playerId) {
        const [actions, chat, privateMessages, instanceCreation] = await Promise.all([
            this.getRemainingOnly(playerId, "actions", { windowSizeMs: 10000, maxRequests: 5 }),
            this.getRemainingOnly(playerId, "chat", { windowSizeMs: 60000, maxRequests: 20 }),
            this.getRemainingOnly(playerId, "private_messages", { windowSizeMs: 300000, maxRequests: 10 }),
            this.getRemainingOnly(playerId, "instance_creation", { windowSizeMs: 3600000, maxRequests: 3 })
        ]);
        return {
            actions,
            chat,
            privateMessages,
            instanceCreation
        };
    }
    async getRemainingOnly(playerId, channel, config) {
        const remaining = await this.counter.getRemainingRequests(playerId, channel, config);
        const finalConfig = { ...this.counter['defaultConfig'], ...config };
        return {
            allowed: remaining > 0,
            remainingRequests: remaining,
            resetTimeMs: Date.now() + finalConfig.windowSizeMs
        };
    }
}
// Factory function for dependency injection
export function createRateLimitCounter(redis, config) {
    return new RateLimitCounter({
        redis,
        defaultConfig: {
            windowSizeMs: 60000,
            maxRequests: 10,
            keyPrefix: "rate_limit:",
            ...config
        }
    });
}
export function createGameRateLimits(redis) {
    return new GameRateLimits(redis);
}
//# sourceMappingURL=rateLimitCounter.js.map