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
const npcEventPayloadSchema = z
    .object({
    eventType: z.string().min(1),
    data: z.unknown().optional()
})
    .strict();
const scriptedEventPayloadSchema = z
    .object({
    triggerId: z.string().min(1),
    eventType: z.string().min(1),
    data: z.unknown().optional()
})
    .strict();
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
/**
 * Parse and validate an unknown payload as an ActionRequest, throwing on validation failures.
 */
export function parseActionRequest(input) {
    return actionRequestSchema.parse(input);
}
/**
 * Safely narrow an unknown value to an ActionRequest without throwing.
 */
export function isActionRequest(input) {
    const result = actionRequestSchema.safeParse(input);
    return result.success;
}
/**
 * Convenience helpers to narrow action variants without switching on string literals at the call
 * site. These also improve exhaustiveness checking when new variants are introduced.
 */
export function isTilePlacementAction(action) {
    return action.type === "tile_placement";
}
export function isNpcEventAction(action) {
    return action.type === "npc_event";
}
export function isScriptedEventAction(action) {
    return action.type === "scripted_event";
}
const TYPE_CATEGORY_RANK = {
    npc_event: 0,
    scripted_event: 0,
    tile_placement: 1
};
/**
 * Compute deterministic ordering metadata for an action. This centralizes tie-breaking rules to
 * keep the comparator implementation straightforward and ensure any future variants follow the
 * same precedence semantics.
 */
export function getActionPriorityDescriptor(action) {
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
            const exhaustiveCheck = action;
            return exhaustiveCheck;
        }
    }
}
//# sourceMappingURL=actionRequest.js.map