import { randomUUID } from "node:crypto";

export interface ReconnectToken {
  token: string;
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
  lastSequenceNumber: number;
}

export interface IssueReconnectTokenOptions {
  sessionId: string;
  lastSequenceNumber: number;
  ttlSeconds?: number;
  issuedAt?: Date;
}

export interface ReconnectTokenStore {
  issue(options: IssueReconnectTokenOptions): Promise<ReconnectToken>;
  get(token: string): Promise<ReconnectToken | null>;
  consume(token: string): Promise<ReconnectToken | null>;
  invalidateSession(sessionId: string): Promise<number>;
  pruneExpired(referenceTime?: Date): Promise<number>;
}

export const DEFAULT_RECONNECT_TOKEN_TTL_SECONDS = 30;

export function isReconnectTokenExpired(token: ReconnectToken, referenceTime = new Date()): boolean {
  return token.expiresAt.getTime() <= referenceTime.getTime();
}

export function cloneReconnectToken(token: ReconnectToken): ReconnectToken {
  return {
    token: token.token,
    sessionId: token.sessionId,
    issuedAt: new Date(token.issuedAt.getTime()),
    expiresAt: new Date(token.expiresAt.getTime()),
    lastSequenceNumber: token.lastSequenceNumber
  };
}

export class InMemoryReconnectTokenStore implements ReconnectTokenStore {
  private readonly tokens = new Map<string, ReconnectToken>();
  private readonly sessionIndex = new Map<string, Set<string>>();

  async issue(options: IssueReconnectTokenOptions): Promise<ReconnectToken> {
    await this.pruneExpired();

    const issuedAt = options.issuedAt ?? new Date();
    const ttl = (options.ttlSeconds ?? DEFAULT_RECONNECT_TOKEN_TTL_SECONDS) * 1000;
    const token: ReconnectToken = {
      token: randomUUID(),
      sessionId: options.sessionId,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + ttl),
      lastSequenceNumber: options.lastSequenceNumber
    };

    this.tokens.set(token.token, token);

    if (!this.sessionIndex.has(token.sessionId)) {
      this.sessionIndex.set(token.sessionId, new Set());
    }
    this.sessionIndex.get(token.sessionId)!.add(token.token);

    return cloneReconnectToken(token);
  }

  async get(token: string): Promise<ReconnectToken | null> {
    await this.pruneExpired();
    const entry = this.tokens.get(token);
    if (!entry) {
      return null;
    }

    if (isReconnectTokenExpired(entry)) {
      await this.deleteToken(token, entry.sessionId);
      return null;
    }

    return cloneReconnectToken(entry);
  }

  async consume(token: string): Promise<ReconnectToken | null> {
    await this.pruneExpired();
    const entry = this.tokens.get(token);

    if (!entry) {
      return null;
    }

    await this.deleteToken(token, entry.sessionId);

    if (isReconnectTokenExpired(entry)) {
      return null;
    }

    return cloneReconnectToken(entry);
  }

  async invalidateSession(sessionId: string): Promise<number> {
    const tokens = this.sessionIndex.get(sessionId);
    if (!tokens) {
      return 0;
    }

    let removed = 0;
    for (const token of tokens) {
      if (this.tokens.delete(token)) {
        removed += 1;
      }
    }

    this.sessionIndex.delete(sessionId);
    return removed;
  }

  async pruneExpired(referenceTime = new Date()): Promise<number> {
    let removed = 0;

    for (const [token, entry] of this.tokens.entries()) {
      if (isReconnectTokenExpired(entry, referenceTime)) {
        this.tokens.delete(token);
        const indexSet = this.sessionIndex.get(entry.sessionId);
        indexSet?.delete(token);
        if (indexSet && indexSet.size === 0) {
          this.sessionIndex.delete(entry.sessionId);
        }
        removed += 1;
      }
    }

    return removed;
  }

  private async deleteToken(token: string, sessionId: string): Promise<void> {
    this.tokens.delete(token);
    const indexSet = this.sessionIndex.get(sessionId);
    if (!indexSet) {
      return;
    }

    indexSet.delete(token);
    if (indexSet.size === 0) {
      this.sessionIndex.delete(sessionId);
    }
  }
}

export function createInMemoryReconnectTokenStore(): ReconnectTokenStore {
  return new InMemoryReconnectTokenStore();
}
