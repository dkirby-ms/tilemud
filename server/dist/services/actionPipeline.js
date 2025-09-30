import { getActionPriorityDescriptor, isTilePlacementAction } from "@@/actions/actionRequest.js";
import { compareActionRequests } from "@@/actions/ordering.js";
const DEFAULT_MAX_QUEUE_SIZE = 512;
export class ActionPipeline {
    rateLimiter;
    maxQueueSize;
    queue = [];
    idIndex = new Set();
    dedupeIndex = new Map();
    constructor(dependencies) {
        this.rateLimiter = dependencies.rateLimiter;
        this.maxQueueSize = dependencies.options?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    }
    get size() {
        return this.queue.length;
    }
    get isEmpty() {
        return this.queue.length === 0;
    }
    async enqueue(action) {
        if (this.idIndex.has(action.id)) {
            return { accepted: false, reason: "duplicate" };
        }
        const dedupeKey = action.metadata?.dedupeKey;
        if (dedupeKey && this.dedupeIndex.has(dedupeKey)) {
            return { accepted: false, reason: "duplicate" };
        }
        if (this.queue.length >= this.maxQueueSize) {
            return { accepted: false, reason: "queue_full" };
        }
        let rateDecision;
        if (isTilePlacementAction(action)) {
            rateDecision = await this.rateLimiter.enforce("tile_action", action.playerId);
        }
        this.queue.push(action);
        this.idIndex.add(action.id);
        if (dedupeKey) {
            this.dedupeIndex.set(dedupeKey, action.id);
        }
        return {
            accepted: true,
            rateLimit: rateDecision
        };
    }
    peek(limit) {
        const ordered = [...this.queue].sort(compareActionRequests);
        const take = typeof limit === "number" ? Math.min(Math.max(0, Math.floor(limit)), ordered.length) : ordered.length;
        return ordered.slice(0, take).map((action) => ({
            action,
            priority: getActionPriorityDescriptor(action)
        }));
    }
    drainBatch(limit) {
        if (this.queue.length === 0) {
            return [];
        }
        const ordered = [...this.queue].sort(compareActionRequests);
        const take = typeof limit === "number" ? Math.min(Math.max(0, Math.floor(limit)), ordered.length) : ordered.length;
        const selected = ordered.slice(0, take);
        this.queue = ordered.slice(take);
        this.rebuildIndexes();
        return selected.map((action) => ({
            action,
            priority: getActionPriorityDescriptor(action)
        }));
    }
    removeWhere(predicate) {
        if (this.queue.length === 0) {
            return 0;
        }
        const retained = [];
        let removed = 0;
        for (const action of this.queue) {
            if (predicate(action)) {
                removed += 1;
            }
            else {
                retained.push(action);
            }
        }
        if (removed > 0) {
            this.queue = retained;
            this.rebuildIndexes();
        }
        return removed;
    }
    clear() {
        this.queue = [];
        this.idIndex.clear();
        this.dedupeIndex.clear();
    }
    rebuildIndexes() {
        this.idIndex.clear();
        this.dedupeIndex.clear();
        for (const action of this.queue) {
            this.idIndex.add(action.id);
            const dedupeKey = action.metadata?.dedupeKey;
            if (dedupeKey) {
                this.dedupeIndex.set(dedupeKey, action.id);
            }
        }
    }
}
//# sourceMappingURL=actionPipeline.js.map