import { type ActionRequest, getActionPriorityDescriptor, isTilePlacementAction } from "@@/actions/actionRequest.js";
import { compareActionRequests } from "@@/actions/ordering.js";
import type { RateLimitDecision, RateLimiterService } from "./rateLimiter.js";

export type EnqueueRejectionReason = "duplicate" | "queue_full";

export interface ActionPipelineOptions {
  /** Maximum number of pending actions retained in the queue. Defaults to 512. */
  maxQueueSize?: number;
}

export interface PipelineEnqueueResult {
  accepted: boolean;
  reason?: EnqueueRejectionReason;
  /** Present when the action passed through a rate limiter. */
  rateLimit?: RateLimitDecision;
}

export interface QueuedAction {
  action: ActionRequest;
  priority: ReturnType<typeof getActionPriorityDescriptor>;
}

const DEFAULT_MAX_QUEUE_SIZE = 512;

export class ActionPipeline {
  private readonly rateLimiter: RateLimiterService;
  private readonly maxQueueSize: number;
  private queue: ActionRequest[] = [];
  private readonly idIndex = new Set<string>();
  private readonly dedupeIndex = new Map<string, string>();

  constructor(dependencies: { rateLimiter: RateLimiterService; options?: ActionPipelineOptions }) {
    this.rateLimiter = dependencies.rateLimiter;
    this.maxQueueSize = dependencies.options?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  }

  get size(): number {
    return this.queue.length;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  async enqueue(action: ActionRequest): Promise<PipelineEnqueueResult> {
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

    let rateDecision: RateLimitDecision | undefined;
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

  peek(limit?: number): QueuedAction[] {
    const ordered = [...this.queue].sort(compareActionRequests);
    const take =
      typeof limit === "number" ? Math.min(Math.max(0, Math.floor(limit)), ordered.length) : ordered.length;
    return ordered.slice(0, take).map((action) => ({
      action,
      priority: getActionPriorityDescriptor(action)
    }));
  }

  drainBatch(limit?: number): QueuedAction[] {
    if (this.queue.length === 0) {
      return [];
    }

    const ordered = [...this.queue].sort(compareActionRequests);
    const take =
      typeof limit === "number" ? Math.min(Math.max(0, Math.floor(limit)), ordered.length) : ordered.length;
    const selected = ordered.slice(0, take);
    this.queue = ordered.slice(take);
    this.rebuildIndexes();

    return selected.map((action) => ({
      action,
      priority: getActionPriorityDescriptor(action)
    }));
  }

  removeWhere(predicate: (action: ActionRequest) => boolean): number {
    if (this.queue.length === 0) {
      return 0;
    }

    const retained: ActionRequest[] = [];
    let removed = 0;

    for (const action of this.queue) {
      if (predicate(action)) {
        removed += 1;
      } else {
        retained.push(action);
      }
    }

    if (removed > 0) {
      this.queue = retained;
      this.rebuildIndexes();
    }

    return removed;
  }

  clear(): void {
    this.queue = [];
    this.idIndex.clear();
    this.dedupeIndex.clear();
  }

  private rebuildIndexes(): void {
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
