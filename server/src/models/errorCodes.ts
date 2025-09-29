// Error code registry aligned with contract catalog
// NOTE: This must stay in sync with test file `tests/unit/error.codes.spec.ts`

export const ERROR_CODES = {
  // Authentication & Authorization (1000-1099)
  AUTHENTICATION_REQUIRED: 1001,
  INVALID_TOKEN: 1002,
  TOKEN_EXPIRED: 1003,
  INSUFFICIENT_PERMISSIONS: 1004,

  // Player Management (1100-1199)
  PLAYER_NOT_FOUND: 1101,
  PLAYER_ALREADY_EXISTS: 1102,
  INVALID_PLAYER_STATE: 1103,
  PLAYER_DISCONNECTED: 1104,

  // Battle Instance (1200-1299)
  INSTANCE_NOT_FOUND: 1201,
  INSTANCE_FULL: 1202,
  INSTANCE_ALREADY_STARTED: 1203,
  INSTANCE_TERMINATED: 1204,
  INVALID_INSTANCE_STATE: 1205,

  // Game Actions (1300-1399)
  INVALID_ACTION_TYPE: 1301,
  ACTION_OUT_OF_TURN: 1302,
  INVALID_TILE_PLACEMENT: 1303,
  RATE_LIMIT_EXCEEDED: 1304,
  ACTION_VALIDATION_FAILED: 1305,

  // Board & Tiles (1400-1499)
  INVALID_BOARD_POSITION: 1401,
  TILE_ALREADY_PLACED: 1402,
  INVALID_TILE_TYPE: 1403,
  BOARD_SIZE_EXCEEDED: 1404,

  // System & Infrastructure (1500-1599)
  INTERNAL_SERVER_ERROR: 1500,
  DATABASE_ERROR: 1501,
  REDIS_ERROR: 1502,
  CONFIGURATION_ERROR: 1503,
  SERVICE_UNAVAILABLE: 1504,

  // Validation (1600-1699)
  INVALID_REQUEST_FORMAT: 1601,
  MISSING_REQUIRED_FIELD: 1602,
  FIELD_VALUE_OUT_OF_RANGE: 1603,
  INVALID_UUID_FORMAT: 1604,
} as const;

// Error message templates
const ERROR_MESSAGES: Record<keyof typeof ERROR_CODES, string> = {
  AUTHENTICATION_REQUIRED: "Authentication is required to access this resource",
  INVALID_TOKEN: "The provided authentication token is invalid",
  TOKEN_EXPIRED: "The authentication token has expired",
  INSUFFICIENT_PERMISSIONS: "Insufficient permissions to perform this action",

  PLAYER_NOT_FOUND: "Player not found",
  PLAYER_ALREADY_EXISTS: "Player already exists",
  INVALID_PLAYER_STATE: "Player is in an invalid state for this operation",
  PLAYER_DISCONNECTED: "Player is disconnected",

  INSTANCE_NOT_FOUND: "Battle instance not found",
  INSTANCE_FULL: "Battle instance is full",
  INSTANCE_ALREADY_STARTED: "Battle instance has already started",
  INSTANCE_TERMINATED: "Battle instance has been terminated",
  INVALID_INSTANCE_STATE: "Battle instance is in an invalid state",

  INVALID_ACTION_TYPE: "Invalid action type",
  ACTION_OUT_OF_TURN: "Action attempted out of turn",
  INVALID_TILE_PLACEMENT: "Invalid tile placement",
  RATE_LIMIT_EXCEEDED: "Rate limit exceeded",
  ACTION_VALIDATION_FAILED: "Action validation failed",

  INVALID_BOARD_POSITION: "Invalid board position",
  TILE_ALREADY_PLACED: "Tile already placed at this position",
  INVALID_TILE_TYPE: "Invalid tile type",
  BOARD_SIZE_EXCEEDED: "Board size limit exceeded",

  INTERNAL_SERVER_ERROR: "Internal server error",
  DATABASE_ERROR: "Database operation failed",
  REDIS_ERROR: "Redis operation failed",
  CONFIGURATION_ERROR: "Configuration error",
  SERVICE_UNAVAILABLE: "Service temporarily unavailable",

  INVALID_REQUEST_FORMAT: "Invalid request format",
  MISSING_REQUIRED_FIELD: "Missing required field",
  FIELD_VALUE_OUT_OF_RANGE: "Field value is out of valid range",
  INVALID_UUID_FORMAT: "Invalid UUID format",
};

// Error response structure
export interface ErrorResponse {
  success: false;
  error: {
    code: number;
    message: string;
    details?: any;
    timestamp: string;
    requestId?: string;
  };
}

// Success response structure
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  timestamp: string;
  requestId?: string;
}

// Response type union
export type ApiResponse<T = any> = SuccessResponse<T> | ErrorResponse;

// Error registry utilities
export class ErrorCodeRegistry {
  static getAllCodes(): Record<string, number> {
    return { ...ERROR_CODES };
  }

  static getMessage(code: number): string | undefined {
    const codeEntry = Object.entries(ERROR_CODES).find(([, value]) => value === code);
    if (!codeEntry) return undefined;
    
    const codeName = codeEntry[0] as keyof typeof ERROR_CODES;
    return ERROR_MESSAGES[codeName];
  }

  static getCodeByName(name: keyof typeof ERROR_CODES): number {
    return ERROR_CODES[name];
  }

  static validateCodeRange(code: number): boolean {
    return code >= 1001 && code <= 1699;
  }

  static getCategoryByCode(code: number): string {
    if (code >= 1001 && code <= 1099) return "Authentication";
    if (code >= 1100 && code <= 1199) return "Player Management";
    if (code >= 1200 && code <= 1299) return "Battle Instance";
    if (code >= 1300 && code <= 1399) return "Game Actions";
    if (code >= 1400 && code <= 1499) return "Board & Tiles";
    if (code >= 1500 && code <= 1599) return "System & Infrastructure";
    if (code >= 1600 && code <= 1699) return "Validation";
    return "Unknown";
  }

  static verifyCodeUniqueness(): boolean {
    const codes = Object.values(ERROR_CODES);
    const uniqueCodes = new Set(codes);
    return codes.length === uniqueCodes.size;
  }

  static verifyMessageCompleteness(): boolean {
    const codeKeys = Object.keys(ERROR_CODES) as Array<keyof typeof ERROR_CODES>;
    const messageKeys = Object.keys(ERROR_MESSAGES) as Array<keyof typeof ERROR_MESSAGES>;
    
    return codeKeys.length === messageKeys.length && 
           codeKeys.every(key => messageKeys.includes(key));
  }
}

// Error creation utilities
export function createErrorResponse(
  code: keyof typeof ERROR_CODES, 
  details?: any, 
  requestId?: string
): ErrorResponse {
  return {
    success: false,
    error: {
      code: ERROR_CODES[code],
      message: ERROR_MESSAGES[code],
      details,
      timestamp: new Date().toISOString(),
      requestId
    }
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
    requestId
  };
}

// Custom error classes
export class TileMudError extends Error {
  constructor(
    public readonly code: keyof typeof ERROR_CODES,
    public readonly details?: any,
    public readonly requestId?: string
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'TileMudError';
  }

  toResponse(): ErrorResponse {
    return createErrorResponse(this.code, this.details, this.requestId);
  }
}

export class ValidationError extends TileMudError {
  constructor(details?: any, requestId?: string) {
    super('ACTION_VALIDATION_FAILED', details, requestId);
    this.name = 'ValidationError';
  }
}

export class DatabaseError extends TileMudError {
  constructor(details?: any, requestId?: string) {
    super('DATABASE_ERROR', details, requestId);
    this.name = 'DatabaseError';
  }
}

export class RateLimitError extends TileMudError {
  constructor(details?: any, requestId?: string) {
    super('RATE_LIMIT_EXCEEDED', details, requestId);
    this.name = 'RateLimitError';
  }
}

// Type exports for convenience
export type ErrorCode = keyof typeof ERROR_CODES;
export type ErrorCodeValue = typeof ERROR_CODES[keyof typeof ERROR_CODES];