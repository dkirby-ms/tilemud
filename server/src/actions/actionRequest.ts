import { z } from "zod";

/**
 * Supported action request types that enter the per-room action pipeline.
 * These values form the discriminant for the `ActionRequest` union.
 */
export const actionRequestTypeSchema = z.enum([
  "tile_placement",
  "npc_event",
  "scripted_event"
]);

export type ActionRequestType = z.infer<typeof actionRequestTypeSchema>;

/**
 * ISO-like string identifier for an entity participating in an action.
 */
export type EntityIdentifier = string;

const coordinateSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative()
  })
  .strict();

const tagsSchema = z
  .record(z.union([z.string(), z.number(), z.boolean()]))
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tags supports a maximum of 16 entries"
      });
    }
  });

export const actionRequestMetadataSchema = z
  .object({
    dedupeKey: z.string().min(1).max(128).optional(),
    submittedAt: z.number().int().nonnegative().optional(),
    tags: tagsSchema.optional()
  })
  .strict();

export type ActionRequestMetadata = z.infer<typeof actionRequestMetadataSchema>;

const baseActionRequestSchema = z.object({
  id: z.string().min(1),
  instanceId: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  requestedTick: z.number().int().nonnegative().optional(),
  metadata: actionRequestMetadataSchema.optional()
});

const tilePlacementPayloadSchema = z
  .object({
    position: coordinateSchema,
    tileType: z.number().int().min(0),
    clientRequestId: z.string().min(1).max(64).optional(),
    orientation: z.number().int().optional()
  })
  .strict();

export type TilePlacementPayload = z.infer<typeof tilePlacementPayloadSchema>;

const npcEventPayloadSchema = z
  .object({
    eventType: z.string().min(1),
    data: z.unknown().optional()
  })
  .strict();

export type NpcEventPayload = z.infer<typeof npcEventPayloadSchema>;

const scriptedEventPayloadSchema = z
  .object({
    triggerId: z.string().min(1),
    eventType: z.string().min(1),
    data: z.unknown().optional()
  })
  .strict();

export type ScriptedEventPayload = z.infer<typeof scriptedEventPayloadSchema>;

const tilePlacementSchema = baseActionRequestSchema.extend({
  type: z.literal("tile_placement"),
  playerId: z.string().min(1),
  playerInitiative: z.number().int(),
  lastActionTick: z.number().int().nonnegative().optional(),
  payload: tilePlacementPayloadSchema
});

const npcEventSchema = baseActionRequestSchema.extend({
  type: z.literal("npc_event"),
  npcId: z.string().min(1),
  priorityTier: z.number().int().min(0),
  payload: npcEventPayloadSchema
});

const scriptedEventSchema = baseActionRequestSchema.extend({
  type: z.literal("scripted_event"),
  scriptId: z.string().min(1),
  priorityTier: z.number().int().min(0),
  payload: scriptedEventPayloadSchema
});

export const actionRequestSchema = z.discriminatedUnion("type", [
  tilePlacementSchema,
  npcEventSchema,
  scriptedEventSchema
]);

export type TilePlacementActionRequest = z.infer<typeof tilePlacementSchema>;
export type NpcEventActionRequest = z.infer<typeof npcEventSchema>;
export type ScriptedEventActionRequest = z.infer<typeof scriptedEventSchema>;
export type ActionRequest = z.infer<typeof actionRequestSchema>;

/**
 * Parse and validate an unknown payload as an ActionRequest, throwing on validation failures.
 */
export function parseActionRequest(input: unknown): ActionRequest {
  return actionRequestSchema.parse(input);
}

/**
 * Safely narrow an unknown value to an ActionRequest without throwing.
 */
export function isActionRequest(input: unknown): input is ActionRequest {
  const result = actionRequestSchema.safeParse(input);
  return result.success;
}

/**
 * Convenience helpers to narrow action variants without switching on string literals at the call
 * site. These also improve exhaustiveness checking when new variants are introduced.
 */
export function isTilePlacementAction(
  action: ActionRequest
): action is TilePlacementActionRequest {
  return action.type === "tile_placement";
}

export function isNpcEventAction(action: ActionRequest): action is NpcEventActionRequest {
  return action.type === "npc_event";
}

export function isScriptedEventAction(
  action: ActionRequest
): action is ScriptedEventActionRequest {
  return action.type === "scripted_event";
}

/**
 * Derived priority metadata used by the ordering comparator. NPC and scripted events leverage
 * their explicit priority tier, while tile placements rely on player initiative to break ties.
 */
export interface ActionPriorityDescriptor {
  /** Numeric tier where lower values execute earlier. */
  priorityTier: number;
  /**
   * Secondary precedence bucket used to group actions by type when tiers match. Lower values execute earlier.
   */
  categoryRank: number;
  /** For player actions we invert initiative so higher initiative wins (lower numeric rank). */
  initiativeRank: number;
  /**
   * Timestamp used for stable ordering when above ranks match. Typically derived from the enqueue timestamp.
   */
  timestamp: number;
}

const TYPE_CATEGORY_RANK: Record<ActionRequestType, number> = {
  npc_event: 0,
  scripted_event: 0,
  tile_placement: 1
};

/**
 * Compute deterministic ordering metadata for an action. This centralizes tie-breaking rules to
 * keep the comparator implementation straightforward and ensure any future variants follow the
 * same precedence semantics.
 */
export function getActionPriorityDescriptor(action: ActionRequest): ActionPriorityDescriptor {
  switch (action.type) {
    case "npc_event":
      return {
        priorityTier: action.priorityTier,
        categoryRank: TYPE_CATEGORY_RANK[action.type],
        initiativeRank: Number.POSITIVE_INFINITY,
        timestamp: action.timestamp
      };
    case "scripted_event":
      return {
        priorityTier: action.priorityTier,
        categoryRank: TYPE_CATEGORY_RANK[action.type],
        initiativeRank: Number.POSITIVE_INFINITY,
        timestamp: action.timestamp
      };
    case "tile_placement":
      return {
        priorityTier: Number.POSITIVE_INFINITY,
        categoryRank: TYPE_CATEGORY_RANK[action.type],
        initiativeRank: -action.playerInitiative,
        timestamp: action.timestamp
      };
    default: {
      const exhaustiveCheck: never = action;
      return exhaustiveCheck;
    }
  }
}
