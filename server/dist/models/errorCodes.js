// Error code catalog aligned with specification seed set
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
];
const NUMERIC_PATTERN = /^E(\d{4})$/u;
function parseNumericCode(numericCode) {
    const match = NUMERIC_PATTERN.exec(numericCode);
    if (!match) {
        throw new Error(`Invalid numeric code format: ${numericCode}`);
    }
    return Number.parseInt(match[1], 10);
}
export const ERROR_CODES = Object.freeze(ERROR_DEFINITIONS.reduce((acc, definition) => {
    acc[definition.key] = parseNumericCode(definition.numericCode);
    return acc;
}, {}));
const ERROR_MESSAGES = Object.freeze(ERROR_DEFINITIONS.reduce((acc, definition) => {
    acc[definition.key] = definition.humanMessage;
    return acc;
}, {}));
const DEFINITIONS_BY_NUMERIC = new Map();
const DEFINITIONS_BY_REASON = new Map();
for (const definition of ERROR_DEFINITIONS) {
    DEFINITIONS_BY_NUMERIC.set(parseNumericCode(definition.numericCode), definition);
    DEFINITIONS_BY_REASON.set(definition.reason, definition);
}
function cloneDefinition(definition) {
    return { ...definition };
}
// Error registry utilities
export class ErrorCodeRegistry {
    static listDefinitions() {
        return ERROR_DEFINITIONS;
    }
    static getAllCodes() {
        return { ...ERROR_CODES };
    }
    static getDefinitionByKey(key) {
        const definition = ERROR_DEFINITIONS.find((entry) => entry.key === key);
        if (!definition) {
            throw new Error(`Unknown error code key: ${key}`);
        }
        return cloneDefinition(definition);
    }
    static getDefinitionByNumericCode(code) {
        const numeric = typeof code === "string" ? parseNumericCode(code) : code;
        const definition = DEFINITIONS_BY_NUMERIC.get(numeric);
        return definition ? cloneDefinition(definition) : undefined;
    }
    static getDefinitionByReason(reason) {
        const definition = DEFINITIONS_BY_REASON.get(reason);
        return definition ? cloneDefinition(definition) : undefined;
    }
    static getMessage(code) {
        return DEFINITIONS_BY_NUMERIC.get(code)?.humanMessage;
    }
    static getCodeByName(name) {
        return ERROR_CODES[name];
    }
    static validateCodeRange(code) {
        return DEFINITIONS_BY_NUMERIC.has(code);
    }
    static getCategoryByCode(code) {
        return DEFINITIONS_BY_NUMERIC.get(code)?.category ?? "unknown";
    }
    static verifyCodeUniqueness() {
        return DEFINITIONS_BY_NUMERIC.size === ERROR_DEFINITIONS.length;
    }
    static verifyMessageCompleteness() {
        return ERROR_DEFINITIONS.every((definition) => definition.humanMessage.trim().length > 0);
    }
}
export function mapDefinitionToEntry(definition) {
    const { numericCode, reason, category, retryable, humanMessage } = definition;
    return { numericCode, reason, category, retryable, humanMessage };
}
export function createErrorResponse(code, options = {}) {
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
export function createSuccessResponse(data, requestId) {
    return {
        success: true,
        data,
        timestamp: new Date().toISOString(),
        requestId,
    };
}
// Custom error classes
export class TileMudError extends Error {
    code;
    details;
    requestId;
    definition;
    constructor(code, details, requestId) {
        const definition = ErrorCodeRegistry.getDefinitionByKey(code);
        super(definition.humanMessage);
        this.code = code;
        this.details = details;
        this.requestId = requestId;
        this.definition = definition;
        this.name = "TileMudError";
    }
    toResponse() {
        return createErrorResponse(this.code, {
            details: this.details,
            requestId: this.requestId,
        });
    }
}
export class ValidationError extends TileMudError {
    constructor(details, requestId, code = "INVALID_TILE_PLACEMENT") {
        super(code, details, requestId);
        this.name = "ValidationError";
    }
}
export class DatabaseError extends TileMudError {
    constructor(details, requestId) {
        super("INTERNAL_ERROR", details, requestId);
        this.name = "DatabaseError";
    }
}
export class RateLimitError extends TileMudError {
    constructor(details, requestId) {
        super("RATE_LIMIT_EXCEEDED", details, requestId);
        this.name = "RateLimitError";
    }
}
//# sourceMappingURL=errorCodes.js.map