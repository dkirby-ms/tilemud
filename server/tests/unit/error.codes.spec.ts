import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ErrorCatalogEntry,
  ErrorCodeRegistry,
  ErrorDefinition,
  RateLimitError,
  TileMudError,
  ValidationError,
  createErrorResponse
} from "../../src/models/errorCodes.js";

const EXPECTED_DEFINITIONS: ErrorCatalogEntry[] = [
  {
    numericCode: "E1001",
    reason: "invalid_tile_placement",
    category: "validation",
    retryable: false,
    humanMessage: "Tile action violates ruleset (illegal position/resource)",
  },
  {
    numericCode: "E1002",
    reason: "precedence_conflict",
    category: "conflict",
    retryable: false,
    humanMessage: "Losing action/event in deterministic ordering",
  },
  {
    numericCode: "E1003",
    reason: "instance_capacity_exceeded",
    category: "capacity",
    retryable: false,
    humanMessage: "Join rejected; 32 player limit reached",
  },
  {
    numericCode: "E1004",
    reason: "instance_terminated",
    category: "state",
    retryable: false,
    humanMessage: "Instance no longer active (ephemeral failure or ended)",
  },
  {
    numericCode: "E1005",
    reason: "grace_period_expired",
    category: "state",
    retryable: false,
    humanMessage: "Reconnect window elapsed; slot released",
  },
  {
    numericCode: "E1006",
    reason: "rate_limit_exceeded",
    category: "rate_limit",
    retryable: true,
    humanMessage: "Channel-specific per-player limit exceeded",
  },
  {
    numericCode: "E1007",
    reason: "cross_instance_action",
    category: "validation",
    retryable: false,
    humanMessage: "Action references non-current instance",
  },
  {
    numericCode: "E1008",
    reason: "unauthorized_private_message",
    category: "security",
    retryable: false,
    humanMessage: "Sender lacks permission to message target",
  },
  {
    numericCode: "E1009",
    reason: "retention_expired",
    category: "state",
    retryable: false,
    humanMessage: "Requested private message aged beyond 30-day window",
  },
  {
    numericCode: "E1010",
    reason: "internal_error",
    category: "internal",
    retryable: true,
    humanMessage: "Generic unexpected failure",
  },
];

function flattenDefinition(definition: ErrorDefinition): ErrorCatalogEntry {
  return {
    numericCode: definition.numericCode,
    reason: definition.reason,
    category: definition.category,
    retryable: definition.retryable,
    humanMessage: definition.humanMessage,
  };
}

describe("Error Code Registry", () => {
  it("exposes the canonical seed catalog", () => {
    const definitions = ErrorCodeRegistry.listDefinitions().map(flattenDefinition);
    expect(definitions).toEqual(EXPECTED_DEFINITIONS);
  });

  it("returns immutable numeric mappings", () => {
    const snapshot = ErrorCodeRegistry.getAllCodes();
    snapshot.RATE_LIMIT_EXCEEDED = 0 as unknown as number;

    expect(ErrorCodeRegistry.getAllCodes()).toEqual(ERROR_CODES);
    expect(ERROR_CODES.RATE_LIMIT_EXCEEDED).toBe(1006);
  });

  it("retrieves definitions by numeric code and reason", () => {
    const byNumeric = ErrorCodeRegistry.getDefinitionByNumericCode("E1006");
    expect(byNumeric).toMatchObject({ reason: "rate_limit_exceeded", category: "rate_limit" });

    const byReason = ErrorCodeRegistry.getDefinitionByReason("grace_period_expired");
    expect(byReason).toMatchObject({ numericCode: "E1005", category: "state" });

    expect(ErrorCodeRegistry.getDefinitionByNumericCode("E9999")).toBeUndefined();
    expect(ErrorCodeRegistry.getDefinitionByReason("does_not_exist" as never)).toBeUndefined();
  });

  it("validates uniqueness and message completeness", () => {
    expect(ErrorCodeRegistry.verifyCodeUniqueness()).toBe(true);
    expect(ErrorCodeRegistry.verifyMessageCompleteness()).toBe(true);
  });

  it("provides human messages for known codes", () => {
    expect(ErrorCodeRegistry.getMessage(1001)).toBe("Tile action violates ruleset (illegal position/resource)");
    expect(ErrorCodeRegistry.getMessage(1010)).toBe("Generic unexpected failure");
    expect(ErrorCodeRegistry.getMessage(9999)).toBeUndefined();
  });

  it("categorizes codes using the catalog metadata", () => {
    expect(ErrorCodeRegistry.getCategoryByCode(1002)).toBe("conflict");
    expect(ErrorCodeRegistry.getCategoryByCode(1008)).toBe("security");
    expect(ErrorCodeRegistry.getCategoryByCode(9999)).toBe("unknown");
  });

  it("creates standardized error responses", () => {
    const response = createErrorResponse("RATE_LIMIT_EXCEEDED", {
      details: { channel: "chat" },
      requestId: "req-123",
    });

    expect(response).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          numericCode: "E1006",
          reason: "rate_limit_exceeded",
          category: "rate_limit",
          retryable: true,
          details: { channel: "chat" },
          requestId: "req-123",
        }),
      })
    );
  });

  it("allows TileMudError subclasses to serialize", () => {
    const rateLimitErr = new RateLimitError({ channel: "chat" }, "req-0001");
    const validationErr = new ValidationError({ field: "tile" }, "req-0002");
    const genericErr = new TileMudError("INTERNAL_ERROR", { cause: "boom" });

    for (const err of [rateLimitErr, validationErr, genericErr]) {
      const serialized = err.toResponse();
      expect(serialized.success).toBe(false);
      expect(serialized.error.numericCode).toMatch(/^E\d{4}$/u);
      expect(typeof serialized.error.humanMessage).toBe("string");
    }
  });
});