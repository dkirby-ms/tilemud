// Error code catalog aligned with specification seed set

export type ErrorCategory =
  | "validation"
  | "conflict"
  | "capacity"
  | "rate_limit"
  | "state"
  | "security"
  | "internal";

type ErrorCatalogDefinitionShape = {
  /** Uppercase key used internally (e.g. RATE_LIMIT_EXCEEDED) */
  key: string;
  /** Stable numeric code string (e.g. E1006) */
  numericCode: string;
  /** Snake_case symbolic reason */
  reason: string;
  /** Grouping category */
  category: ErrorCategory;
  /** Whether the client can retry the request without changes */
  retryable: boolean;
  /** Human-facing message or localization token */
  humanMessage: string;
};

const ERROR_DEFINITIONS = [
  {
    key: "INVALID_TILE_PLACEMENT",
    numericCode: "E1001",
    reason: "invalid_tile_placement",
    category: "validation",
    retryable: false,
    humanMessage: "Tile action violates ruleset (illegal position/resource)",
  },
  {
    key: "PRECEDENCE_CONFLICT",
    numericCode: "E1002",
    reason: "precedence_conflict",
    category: "conflict",
    retryable: false,
    humanMessage: "Losing action/event in deterministic ordering",
  },
  {
    key: "INSTANCE_CAPACITY_EXCEEDED",
    numericCode: "E1003",
    reason: "instance_capacity_exceeded",
    category: "capacity",
    retryable: false,
    humanMessage: "Join rejected; 32 player limit reached",
  },
  {
    key: "INSTANCE_TERMINATED",
    numericCode: "E1004",
    reason: "instance_terminated",
    category: "state",
    retryable: false,
    humanMessage: "Instance no longer active (ephemeral failure or ended)",
  },
  {
    key: "GRACE_PERIOD_EXPIRED",
    numericCode: "E1005",
    reason: "grace_period_expired",
    category: "state",
    retryable: false,
    humanMessage: "Reconnect window elapsed; slot released",
  },
  {
    key: "RATE_LIMIT_EXCEEDED",
    numericCode: "E1006",
    reason: "rate_limit_exceeded",
    category: "rate_limit",
    retryable: true,
    humanMessage: "Channel-specific per-player limit exceeded",
  },
  {
    key: "CROSS_INSTANCE_ACTION",
    numericCode: "E1007",
    reason: "cross_instance_action",
    category: "validation",
    retryable: false,
    humanMessage: "Action references non-current instance",
  },
  {
    key: "UNAUTHORIZED_PRIVATE_MESSAGE",
    numericCode: "E1008",
    reason: "unauthorized_private_message",
    category: "security",
    retryable: false,
    humanMessage: "Sender lacks permission to message target",
  },
  {
    key: "RETENTION_EXPIRED",
    numericCode: "E1009",
    reason: "retention_expired",
    category: "state",
    retryable: false,
    humanMessage: "Requested private message aged beyond 30-day window",
  },
  {
    key: "INTERNAL_ERROR",
    numericCode: "E1010",
    reason: "internal_error",
    category: "internal",
    retryable: true,
    humanMessage: "Generic unexpected failure",
  },
] as const satisfies readonly ErrorCatalogDefinitionShape[];

export type ErrorDefinition = typeof ERROR_DEFINITIONS[number];
export type ErrorCodeKey = ErrorDefinition["key"];
export type ErrorReason = ErrorDefinition["reason"];

const NUMERIC_PATTERN = /^E(\d{4})$/u;

function parseNumericCode(numericCode: string): number {
  const match = NUMERIC_PATTERN.exec(numericCode);
  if (!match) {
    throw new Error(`Invalid numeric code format: ${numericCode}`);
  }
  return Number.parseInt(match[1], 10);
}

export const ERROR_CODES: Readonly<Record<ErrorCodeKey, number>> = Object.freeze(
  ERROR_DEFINITIONS.reduce<Record<ErrorCodeKey, number>>((acc, definition) => {
    acc[definition.key] = parseNumericCode(definition.numericCode);
    return acc;
  }, {} as Record<ErrorCodeKey, number>)
);

const ERROR_MESSAGES: Readonly<Record<ErrorCodeKey, string>> = Object.freeze(
  ERROR_DEFINITIONS.reduce<Record<ErrorCodeKey, string>>((acc, definition) => {
    acc[definition.key] = definition.humanMessage;
    return acc;
  }, {} as Record<ErrorCodeKey, string>)
);

const DEFINITIONS_BY_NUMERIC = new Map<number, (typeof ERROR_DEFINITIONS)[number]>();
const DEFINITIONS_BY_REASON = new Map<string, (typeof ERROR_DEFINITIONS)[number]>();

for (const definition of ERROR_DEFINITIONS) {
  DEFINITIONS_BY_NUMERIC.set(parseNumericCode(definition.numericCode), definition);
  DEFINITIONS_BY_REASON.set(definition.reason, definition);
}

export interface ErrorCatalogEntry {
  numericCode: string;
  reason: ErrorReason;
  category: ErrorCategory;
  retryable: boolean;
  humanMessage: string;
}

export interface ErrorResponseBody extends ErrorCatalogEntry {
  details?: unknown;
  timestamp: string;
  requestId?: string;
}

// Error response structure
export interface ErrorResponse {
  success: false;
  error: ErrorResponseBody;
}

// Success response structure
export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  timestamp: string;
  requestId?: string;
}

// Response type union
export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

function cloneDefinition(definition: (typeof ERROR_DEFINITIONS)[number]): ErrorDefinition {
  return { ...definition };
}

// Error registry utilities
export class ErrorCodeRegistry {
  static listDefinitions(): readonly ErrorDefinition[] {
    return ERROR_DEFINITIONS;
  }

  static getAllCodes(): Record<string, number> {
    return { ...ERROR_CODES };
  }

  static getDefinitionByKey(key: ErrorCodeKey): ErrorDefinition {
    const definition = ERROR_DEFINITIONS.find((entry) => entry.key === key);
    if (!definition) {
      throw new Error(`Unknown error code key: ${key}`);
    }
    return cloneDefinition(definition);
  }

  static getDefinitionByNumericCode(code: number | string): ErrorDefinition | undefined {
    const numeric = typeof code === "string" ? parseNumericCode(code) : code;
    const definition = DEFINITIONS_BY_NUMERIC.get(numeric);
    return definition ? cloneDefinition(definition) : undefined;
  }

  static getDefinitionByReason(reason: ErrorReason): ErrorDefinition | undefined {
    const definition = DEFINITIONS_BY_REASON.get(reason);
    return definition ? cloneDefinition(definition) : undefined;
  }

  static getMessage(code: number): string | undefined {
    return DEFINITIONS_BY_NUMERIC.get(code)?.humanMessage;
  }

  static getCodeByName(name: ErrorCodeKey): number {
    return ERROR_CODES[name];
  }

  static validateCodeRange(code: number): boolean {
    return DEFINITIONS_BY_NUMERIC.has(code);
  }

  static getCategoryByCode(code: number): ErrorCategory | "unknown" {
    return DEFINITIONS_BY_NUMERIC.get(code)?.category ?? "unknown";
  }

  static verifyCodeUniqueness(): boolean {
    return DEFINITIONS_BY_NUMERIC.size === ERROR_DEFINITIONS.length;
  }

  static verifyMessageCompleteness(): boolean {
    return ERROR_DEFINITIONS.every((definition) => definition.humanMessage.trim().length > 0);
  }
}

export function mapDefinitionToEntry(definition: ErrorDefinition): ErrorCatalogEntry {
  const { numericCode, reason, category, retryable, humanMessage } = definition;
  return { numericCode, reason, category, retryable, humanMessage };
}

export function createErrorResponse(
  code: ErrorCodeKey,
  options: { details?: unknown; requestId?: string; humanMessageOverride?: string } = {}
): ErrorResponse {
  const definition = ErrorCodeRegistry.getDefinitionByKey(code);
  const timestamp = new Date().toISOString();

  return {
    success: false,
    error: {
  numericCode: definition.numericCode,
  reason: definition.reason,
      category: definition.category,
      retryable: definition.retryable,
      humanMessage: options.humanMessageOverride ?? definition.humanMessage,
      details: options.details,
      timestamp,
      requestId: options.requestId,
    },
  };
}

export function createSuccessResponse<T>(
  data: T,
  requestId?: string
): SuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    requestId,
  };
}

// Custom error classes
export class TileMudError extends Error {
  public readonly definition: ErrorDefinition;

  constructor(
    public readonly code: ErrorCodeKey,
    public readonly details?: unknown,
    public readonly requestId?: string
  ) {
    const definition = ErrorCodeRegistry.getDefinitionByKey(code);
    super(definition.humanMessage);
    this.definition = definition;
    this.name = "TileMudError";
  }

  toResponse(): ErrorResponse {
    return createErrorResponse(this.code, {
      details: this.details,
      requestId: this.requestId,
    });
  }
}

export class ValidationError extends TileMudError {
  constructor(details?: unknown, requestId?: string, code: ErrorCodeKey = "INVALID_TILE_PLACEMENT") {
    super(code, details, requestId);
    this.name = "ValidationError";
  }
}

export class DatabaseError extends TileMudError {
  constructor(details?: unknown, requestId?: string) {
    super("INTERNAL_ERROR", details, requestId);
    this.name = "DatabaseError";
  }
}

export class RateLimitError extends TileMudError {
  constructor(details?: unknown, requestId?: string) {
    super("RATE_LIMIT_EXCEEDED", details, requestId);
    this.name = "RateLimitError";
  }
}

// Type exports for convenience
export type ErrorCode = ErrorCodeKey;
export type ErrorCodeValue = typeof ERROR_CODES[keyof typeof ERROR_CODES];