import { z } from "zod";

const isoDateString = () => z.string().datetime({ message: "Expected ISO-8601 date" });
const sequenceNumberSchema = z.number().int().nonnegative();

export const moveDirectionSchema = z.enum(["north", "south", "east", "west"]);

export const intentMovePayloadSchema = z
  .object({
    sequence: sequenceNumberSchema,
    direction: moveDirectionSchema,
    magnitude: z.number().int().min(1).max(3),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const intentChatPayloadSchema = z
  .object({
    sequence: sequenceNumberSchema,
    channel: z.string().min(1).max(32),
    message: z.string().min(1).max(280),
    locale: z.string().min(2).max(8).optional()
  })
  .strict();

const actionTargetSchema = z
  .object({
    type: z.string().min(1),
    coordinates: z
      .object({
        x: z.number().int(),
        y: z.number().int()
      })
      .optional(),
    id: z.string().min(1).optional()
  })
  .catchall(z.unknown());

export const intentActionPayloadSchema = z
  .object({
    sequence: sequenceNumberSchema,
    actionId: z.string().min(1),
    kind: z.enum(["move", "chat", "ability", "system"]).optional().default("system"),
    target: actionTargetSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

const acknowledgedIntentSchema = z.object({
  intentType: z.string().min(1),
  sequence: sequenceNumberSchema
});

const durabilityMetadataSchema = z
  .object({
    persisted: z.boolean(),
    actionEventId: z.string().min(1),
    persistedAt: isoDateString(),
    duplicate: z.boolean().optional()
  })
  .strict();

const intentAckPayloadSchema = z
  .object({
    intentType: z.string().min(1),
    sequence: sequenceNumberSchema,
    status: z.enum(["applied", "duplicate", "rejected", "queued"]),
    acknowledgedAt: isoDateString(),
    durability: durabilityMetadataSchema.optional(),
    latencyMs: z.number().nonnegative().optional(),
    message: z.string().optional()
  })
  .strict();

const handshakeAckPayloadSchema = z
  .object({
    reason: z.literal("handshake"),
    sessionId: z.string().min(1),
    sequence: sequenceNumberSchema,
    version: z.string().min(1),
    acknowledgedIntents: z.array(acknowledgedIntentSchema),
    acknowledgedAt: isoDateString().optional()
  })
  .strict();

export const eventAckSchema = z.object({
  type: z.literal("event.ack"),
  payload: z.union([handshakeAckPayloadSchema, intentAckPayloadSchema])
});

const characterSnapshotSchema = z
  .object({
    characterId: z.string().min(1),
    displayName: z.string().min(1),
    position: z.object({
      x: z.number().int(),
      y: z.number().int()
    }),
    stats: z.record(z.string(), z.unknown()),
    inventory: z.record(z.string(), z.unknown())
  })
  .strict();

const stateEffectSchema = z
  .object({
    type: z.string().min(1),
    actionId: z.string().min(1).optional()
  })
  .catchall(z.unknown());

const worldSnapshotSchema = z
  .object({
    tiles: z.array(z.record(z.string(), z.unknown()))
  })
  .catchall(z.unknown());

export const eventStateDeltaSchema = z.object({
  type: z.literal("event.state_delta"),
  payload: z
    .object({
      sequence: sequenceNumberSchema,
      issuedAt: isoDateString(),
      character: characterSnapshotSchema.optional(),
      world: worldSnapshotSchema.optional(),
      effects: z.array(stateEffectSchema).optional(),
      reconnectToken: z
        .object({
          token: z.string().min(1),
          expiresAt: isoDateString()
        })
        .optional()
    })
    .strict()
});

const errorCategorySchema = z.enum(["CONSISTENCY", "RATE_LIMIT", "AUTH", "VALIDATION", "SYSTEM"]);

export const eventErrorSchema = z.object({
  type: z.literal("event.error"),
  payload: z
    .object({
      intentType: z.string().min(1).optional(),
      sequence: sequenceNumberSchema.optional(),
      code: z.string().min(1),
      category: errorCategorySchema,
      retryable: z.boolean().default(false),
      message: z.string().min(1)
    })
    .strict()
});

export const eventDegradedSchema = z.object({
  type: z.literal("event.degraded"),
  payload: z
    .object({
      dependency: z.enum(["redis", "postgres", "metrics", "unknown"]).default("unknown"),
      status: z.enum(["degraded", "recovered"]),
      observedAt: isoDateString(),
      message: z.string().optional()
    })
    .strict()
});

export const eventVersionMismatchSchema = z.object({
  type: z.literal("event.version_mismatch"),
  payload: z
    .object({
      expectedVersion: z.string().min(1),
      receivedVersion: z.string().min(1),
      disconnectAt: isoDateString().optional(),
      message: z.string().optional()
    })
    .strict()
});

export const eventDisconnectSchema = z.object({
  type: z.literal("event.disconnect"),
  payload: z
    .object({
      code: z.number().int(),
      reason: z.string().min(1)
    })
    .strict()
});

export const realtimeIntentEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("intent.move"), payload: intentMovePayloadSchema }),
  z.object({ type: z.literal("intent.chat"), payload: intentChatPayloadSchema }),
  z.object({ type: z.literal("intent.action"), payload: intentActionPayloadSchema })
]);

export const realtimeEventEnvelopeSchema = z.discriminatedUnion("type", [
  eventAckSchema,
  eventStateDeltaSchema,
  eventErrorSchema,
  eventDegradedSchema,
  eventVersionMismatchSchema,
  eventDisconnectSchema
]);

export type IntentMovePayload = z.infer<typeof intentMovePayloadSchema>;
export type IntentChatPayload = z.infer<typeof intentChatPayloadSchema>;
export type IntentActionPayload = z.infer<typeof intentActionPayloadSchema>;
export type RealtimeIntentEnvelope = z.infer<typeof realtimeIntentEnvelopeSchema>;
export type RealtimeEventEnvelope = z.infer<typeof realtimeEventEnvelopeSchema>;
export type EventAck = z.infer<typeof eventAckSchema>;
export type EventStateDelta = z.infer<typeof eventStateDeltaSchema>;
export type EventError = z.infer<typeof eventErrorSchema>;
export type EventDegraded = z.infer<typeof eventDegradedSchema>;
export type EventVersionMismatch = z.infer<typeof eventVersionMismatchSchema>;
export type EventDisconnect = z.infer<typeof eventDisconnectSchema>;

export const realtimeIntentSchemas = {
  "intent.move": intentMovePayloadSchema,
  "intent.chat": intentChatPayloadSchema,
  "intent.action": intentActionPayloadSchema
} as const;

export const realtimeEventSchemas = {
  "event.ack": eventAckSchema,
  "event.state_delta": eventStateDeltaSchema,
  "event.error": eventErrorSchema,
  "event.degraded": eventDegradedSchema,
  "event.version_mismatch": eventVersionMismatchSchema,
  "event.disconnect": eventDisconnectSchema
} as const;

export type RealtimeIntentType = keyof typeof realtimeIntentSchemas;
export type RealtimeEventType = keyof typeof realtimeEventSchemas;
