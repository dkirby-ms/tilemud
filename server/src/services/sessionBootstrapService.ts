import { createHash, randomUUID } from "node:crypto";
import { SERVER_BUILD_VERSION } from "../infra/version.js";
import type { CharacterProfile, CharacterProfileRepository } from "../models/characterProfile.js";
import type { PlayerSessionState, PlayerSessionStore } from "../models/playerSession.js";
import type { ReconnectToken, ReconnectTokenStore } from "../models/reconnectToken.js";

export interface TokenValidationResult {
  userId: string;
  metadata?: Record<string, unknown>;
}

export type TokenValidator = (token: string) => Promise<TokenValidationResult> | TokenValidationResult;

export interface SessionBootstrapServiceDependencies {
  characterProfiles: CharacterProfileRepository;
  playerSessions: PlayerSessionStore;
  reconnectTokens: ReconnectTokenStore;
  tokenValidator?: TokenValidator;
  buildVersion?: string;
  defaultRoomName?: string;
  now?: () => Date;
  generateSessionId?: () => string;
  characterIdFactory?: (userId: string) => string;
  reconnectTtlSeconds?: number;
}

export interface BootstrapSessionInput {
  token: string;
  reconnectToken?: string | null;
  clientVersion?: string;
}

export interface BootstrapSessionState {
  character?: {
    characterId: string;
    displayName: string;
    position: { x: number; y: number };
    stats: Record<string, unknown>;
    inventory: Record<string, unknown>;
  };
  world?: Record<string, unknown>;
}

export interface BootstrapSessionResult {
  version: string;
  issuedAt: string;
  session: {
    sessionId: string;
    userId: string;
    status: PlayerSessionState["status"];
    protocolVersion: string;
    lastSequenceNumber: number;
  };
  state: BootstrapSessionState;
  reconnect: {
    token: string;
    expiresAt: string;
  };
  realtime?: {
    room?: string;
    roomId?: string;
  };
}

export class SessionBootstrapService {
  private readonly characterProfiles: CharacterProfileRepository;
  private readonly playerSessions: PlayerSessionStore;
  private readonly reconnectTokens: ReconnectTokenStore;
  private readonly tokenValidator: TokenValidator;
  private readonly buildVersion: string;
  private readonly defaultRoomName: string | undefined;
  private readonly now: () => Date;
  private readonly generateSessionId: () => string;
  private readonly characterIdFactory: (userId: string) => string;
  private readonly reconnectTtlSeconds?: number;

  constructor(dependencies: SessionBootstrapServiceDependencies) {
    this.characterProfiles = dependencies.characterProfiles;
    this.playerSessions = dependencies.playerSessions;
    this.reconnectTokens = dependencies.reconnectTokens;
    this.tokenValidator = dependencies.tokenValidator ?? defaultTokenValidator;
    this.buildVersion = dependencies.buildVersion ?? SERVER_BUILD_VERSION;
    this.defaultRoomName = dependencies.defaultRoomName;
    this.now = dependencies.now ?? (() => new Date());
    this.generateSessionId = dependencies.generateSessionId ?? (() => randomUUID());
    this.characterIdFactory = dependencies.characterIdFactory ?? deterministicCharacterId;
    this.reconnectTtlSeconds = dependencies.reconnectTtlSeconds;
  }

  async bootstrapSession(input: BootstrapSessionInput): Promise<BootstrapSessionResult> {
    if (!input.token) {
      throw new Error("authorization_token_missing");
    }

    const { userId } = await this.tokenValidator(input.token);
    if (!userId) {
      throw new Error("authorization_token_invalid");
    }

    const issuedAt = this.now();

    let priorReconnect: ReconnectToken | null = null;
    if (input.reconnectToken) {
      try {
        priorReconnect = await this.reconnectTokens.consume(input.reconnectToken);
      } catch {
        priorReconnect = null;
      }

      if (priorReconnect?.sessionId) {
        // Tear down any lingering in-memory session for cleanliness.
        this.playerSessions.remove(priorReconnect.sessionId);
      }
    }

    const characterId = this.characterIdFactory(userId);
    const profile = await this.ensureCharacterProfile(characterId, userId);

    const lastSequenceNumber = priorReconnect?.lastSequenceNumber ?? 0;

    const sessionState = this.playerSessions.createOrUpdateSession({
      sessionId: this.generateSessionId(),
      userId,
      characterId,
      protocolVersion: this.buildVersion,
      status: "active",
      initialSequenceNumber: lastSequenceNumber,
      heartbeatAt: issuedAt
    });

    const reconnectToken = await this.reconnectTokens.issue({
      sessionId: sessionState.sessionId,
      lastSequenceNumber: sessionState.lastSequenceNumber,
      issuedAt,
      ttlSeconds: this.reconnectTtlSeconds
    });

    const result: BootstrapSessionResult = {
      version: this.buildVersion,
      issuedAt: issuedAt.toISOString(),
      session: {
        sessionId: sessionState.sessionId,
        userId: sessionState.userId,
        status: sessionState.status,
        protocolVersion: sessionState.protocolVersion,
        lastSequenceNumber: sessionState.lastSequenceNumber
      },
      state: this.createBootstrapState(profile),
      reconnect: {
        token: reconnectToken.token,
        expiresAt: reconnectToken.expiresAt.toISOString()
      },
      realtime: {
        room: this.defaultRoomName,
        roomId: undefined
      }
    };

    return result;
  }

  private async ensureCharacterProfile(characterId: string, userId: string): Promise<CharacterProfile> {
    const existing = await this.characterProfiles.getProfile(characterId, userId);
    if (existing) {
      return existing;
    }

    return this.characterProfiles.createProfile({
      characterId,
      userId,
      displayName: `Adventurer-${userId.slice(0, 6)}`,
      positionX: 0,
      positionY: 0,
      health: 100,
      inventory: {},
      stats: {}
    });
  }

  private createBootstrapState(profile: CharacterProfile): BootstrapSessionState {
    return {
      character: {
        characterId: profile.characterId,
        displayName: profile.displayName,
        position: {
          x: profile.positionX,
          y: profile.positionY
        },
        stats: profile.stats ?? {},
        inventory: profile.inventory ?? {}
      },
      world: {
        tiles: []
      }
    } satisfies BootstrapSessionState;
  }
}

function deterministicCharacterId(userId: string): string {
  const digest = createHash("sha256").update(userId).digest("hex").slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20)}`;
}

function defaultTokenValidator(token: string): TokenValidationResult {
  const prefix = "Bearer ";
  if (!token.startsWith(prefix)) {
    throw new Error("authorization_token_invalid_format");
  }

  const raw = token.slice(prefix.length).trim();
  if (!raw) {
    throw new Error("authorization_token_empty");
  }

  return {
    userId: raw
  } satisfies TokenValidationResult;
}
