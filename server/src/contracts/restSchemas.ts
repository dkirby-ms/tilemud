import { z } from "zod";

const isoDateString = () => z.string().datetime({ message: "Expected ISO-8601 timestamp" });

export const reconnectTokenSchema = z
  .object({
    token: z.string().min(1),
    expiresAt: isoDateString()
  })
  .strict();

export const positionSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int()
  })
  .strict();

export const characterSnapshotSchema = z
  .object({
    characterId: z.string().min(1),
    displayName: z.string().min(1),
    position: positionSchema,
    stats: z.record(z.string(), z.unknown()),
    inventory: z.record(z.string(), z.unknown())
  })
  .strict();

export const worldSnapshotSchema = z
  .object({
    tiles: z.array(z.record(z.string(), z.unknown()))
  })
  .catchall(z.unknown());

export const sessionStatusSchema = z.enum(["connecting", "active", "reconnecting", "terminating"]);

export const sessionSnapshotSchema = z
  .object({
    sessionId: z.string().min(1),
    userId: z.string().min(1),
    status: sessionStatusSchema,
    protocolVersion: z.string().min(1),
    lastSequenceNumber: z.number().int().nonnegative()
  })
  .strict();

export const sessionBootstrapRequestSchema = z
  .object({
    reconnectToken: z.string().min(1).nullable().optional(),
    clientVersion: z.string().min(1).optional()
  })
  .strict();

export const sessionBootstrapResponseSchema = z
  .object({
    version: z.string().min(1),
    issuedAt: isoDateString(),
    session: sessionSnapshotSchema,
    state: z
      .object({
        character: characterSnapshotSchema.optional(),
        world: worldSnapshotSchema.optional()
      })
      .strict(),
    reconnect: reconnectTokenSchema,
    realtime: z
      .object({
        room: z.string().min(1).optional(),
        roomId: z.string().min(1).optional()
      })
      .optional()
  })
  .strict();

const dependencyStatusSchema = z.enum(["available", "degraded", "unavailable"]);

const dependencyHealthSchema = z
  .object({
    status: dependencyStatusSchema,
    latencyMs: z.number().nonnegative().optional(),
    checkedAt: isoDateString().optional(),
    message: z.string().optional()
  })
  .strict();

export const healthResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded", "unavailable"]),
    version: z.string().min(1),
    dependencies: z
      .object({
        postgres: dependencyHealthSchema,
        redis: dependencyHealthSchema,
        metrics: dependencyHealthSchema.optional()
      })
      .strict(),
    observedAt: isoDateString().optional()
  })
  .strict();

export const versionResponseSchema = z
  .object({
    version: z.string().min(1),
    protocol: z.string().min(1),
    updatedAt: isoDateString()
  })
  .strict();

export type SessionBootstrapRequest = z.infer<typeof sessionBootstrapRequestSchema>;
export type SessionBootstrapResponse = z.infer<typeof sessionBootstrapResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type VersionResponse = z.infer<typeof versionResponseSchema>;

export const restSchemas = {
  sessionBootstrap: {
    request: sessionBootstrapRequestSchema,
    response: sessionBootstrapResponseSchema
  },
  health: {
    response: healthResponseSchema
  },
  version: {
    response: versionResponseSchema
  }
} as const;
