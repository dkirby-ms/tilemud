import { Client, type Room } from "colyseus.js";
import type { ZodSchema } from "zod";
import {
  eventAckSchema,
  eventDegradedSchema,
  eventDisconnectSchema,
  eventErrorSchema,
  eventStateDeltaSchema,
  eventVersionMismatchSchema,
  realtimeIntentEnvelopeSchema,
  type EventDegraded,
  type RealtimeIntentEnvelope
} from "@/types";
import { getSessionState, useSessionStore } from "./sessionStore";

export interface LoggerLike {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface JoinPayload {
  sessionId: string;
  userId: string;
  reconnectToken?: string | null;
  clientVersion: string;
  lastSequenceNumber?: number;
}

interface RoomAdapter {
  onMessage<T = unknown>(type: string, callback: (payload: T) => void): void;
  onError(callback: (code: number, message?: string) => void): void;
  onLeave(callback: (code: number) => void): void;
  send(type: string, payload: unknown): void;
  leave(consented?: boolean): Promise<void>;
}

interface SessionTransport {
  connect(payload: JoinPayload): Promise<RoomAdapter>;
  dispose?: () => void;
}

class ColyseusRoomAdapter implements RoomAdapter {
  private readonly room: Room;

  constructor(room: Room) {
    this.room = room;
  }

  onMessage<T = unknown>(type: string, callback: (payload: T) => void): void {
    this.room.onMessage<T>(type, callback);
  }

  onError(callback: (code: number, message?: string) => void): void {
    this.room.onError(callback);
  }

  onLeave(callback: (code: number) => void): void {
    this.room.onLeave(callback);
  }

  send(type: string, payload: unknown): void {
    this.room.send(type, payload);
  }

  async leave(consented?: boolean): Promise<void> {
    await this.room.leave(consented);
  }
}

class ColyseusTransport implements SessionTransport {
  private client: Client | null = null;
  private readonly endpoint: string;
  private readonly roomName: string;

  constructor(endpoint: string, roomName: string) {
    this.endpoint = endpoint;
    this.roomName = roomName;
  }

  async connect(payload: JoinPayload): Promise<RoomAdapter> {
    this.client = new Client(this.endpoint);
    const room = await this.client.joinOrCreate(this.roomName, payload);
    return new ColyseusRoomAdapter(room);
  }

  dispose(): void {
    this.client = null;
  }
}

export interface SessionRealtimeClientOptions {
  endpoint?: string;
  roomName?: string;
  transport?: SessionTransport;
  logger?: LoggerLike;
}

const parsePayload = <T>(schema: ZodSchema<T>, data: unknown, logger?: LoggerLike, context?: string): T | null => {
  const result = schema.safeParse(data);
  if (!result.success) {
    logger?.warn?.("session.connector.parse_failed", {
      context,
      issues: result.error.issues
    });
    return null;
  }
  return result.data;
};

export class SessionRealtimeClient {
  private readonly transport: SessionTransport;
  private readonly logger: LoggerLike;
  private room: RoomAdapter | null = null;
  private disposed = false;

  constructor(options: SessionRealtimeClientOptions = {}) {
    this.logger = options.logger ?? console;

    if (options.transport) {
      this.transport = options.transport;
    } else {
      if (!options.endpoint) {
        throw new Error("endpoint is required when no transport is provided");
      }
      this.transport = new ColyseusTransport(options.endpoint, options.roomName ?? "GameRoom");
    }
  }

  isConnected(): boolean {
    return this.room !== null && !this.disposed;
  }

  async connect(payload: JoinPayload): Promise<void> {
    if (this.disposed) {
      throw new Error("SessionRealtimeClient has been disposed");
    }
    if (this.room) {
      this.logger.warn?.("session.connector.connect_already_joined", { sessionId: payload.sessionId });
      return;
    }

    const store = getSessionState();
    store.startConnect(payload.clientVersion);

    try {
      const room = await this.transport.connect(payload);
      this.room = room;
      this.registerHandlers(room);
      this.logger.info?.("session.connector.connected", {
        sessionId: payload.sessionId,
        userId: payload.userId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.markUnavailable(message);
      this.logger.error?.("session.connector.connect_failed", {
        error: message
      });
      throw error;
    }
  }

  async disconnect(consented = true): Promise<void> {
    if (!this.room) {
      return;
    }

    try {
      await this.room.leave(consented);
    } catch (error) {
      this.logger.warn?.("session.connector.disconnect_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.room = null;
      getSessionState().markTerminated(consented ? undefined : "Disconnected by server");
      this.transport.dispose?.();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.disconnect();
  }

  async sendIntent(envelope: RealtimeIntentEnvelope): Promise<void> {
    if (!this.room) {
      throw new Error("Cannot send intent without an active realtime session");
    }

    const validation = parsePayload(realtimeIntentEnvelopeSchema, envelope, this.logger, "intent.validate");
    if (!validation) {
      throw new Error("Invalid intent payload");
    }

    this.room.send(validation.type, validation.payload);
  }

  private registerHandlers(room: RoomAdapter): void {
    room.onMessage("event.ack", (payload) => {
      const parsed = parsePayload(eventAckSchema, { type: "event.ack", payload }, this.logger, "ack");
      if (!parsed) return;
  useSessionStore.getState().handleAckEvent(parsed);
    });

    room.onMessage("event.state_delta", (payload) => {
      const parsed = parsePayload(eventStateDeltaSchema, { type: "event.state_delta", payload }, this.logger, "state_delta");
      if (!parsed) return;
  useSessionStore.getState().handleStateDelta(parsed);
    });

    room.onMessage("event.degraded", (payload) => {
      const parsed = parsePayload(eventDegradedSchema, { type: "event.degraded", payload }, this.logger, "degraded");
      if (!parsed) return;
      const normalized: EventDegraded = {
        type: "event.degraded",
        payload: {
          dependency: parsed.payload.dependency ?? "unknown",
          status: parsed.payload.status,
          observedAt: parsed.payload.observedAt,
          ...(parsed.payload.message ? { message: parsed.payload.message } : {})
        }
      };
      useSessionStore.getState().handleDegradedEvent(normalized);
    });

    room.onMessage("event.version_mismatch", (payload) => {
      const parsed = parsePayload(eventVersionMismatchSchema, { type: "event.version_mismatch", payload }, this.logger, "version_mismatch");
      if (!parsed) return;
  useSessionStore.getState().handleVersionMismatch(parsed);
    });

    room.onMessage("event.error", (payload) => {
      const parsed = parsePayload(eventErrorSchema, { type: "event.error", payload }, this.logger, "error");
      if (!parsed) return;
      useSessionStore.setState({ lastError: parsed.payload.message });
    });

    room.onMessage("event.disconnect", (payload) => {
      const parsed = parsePayload(eventDisconnectSchema, { type: "event.disconnect", payload }, this.logger, "disconnect_event");
      if (!parsed) return;
      useSessionStore.getState().markTerminated(parsed.payload.reason);
    });

    room.onError((code, message) => {
      const reason = message ?? `Realtime transport error (${code})`;
      useSessionStore.getState().markUnavailable(reason);
      this.logger.error?.("session.connector.transport_error", { code, message: reason });
    });

    room.onLeave((code) => {
      const reason = code === 1000 ? undefined : `Realtime session closed (${code})`;
      useSessionStore.getState().markTerminated(reason);
      this.room = null;
    });
  }
}
