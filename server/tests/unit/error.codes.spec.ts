import { describe, expect, it } from "vitest";

// Error code definitions
const ERROR_CODES = {
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

// Error registry utilities
class ErrorCodeRegistry {
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

describe("Error Code Registry", () => {
  it("maintains immutability of error codes", () => {
    const originalCodes = ErrorCodeRegistry.getAllCodes();
    const retrievedCodes = ErrorCodeRegistry.getAllCodes();
    
    // Attempting to modify retrieved codes should not affect the original
    retrievedCodes.AUTHENTICATION_REQUIRED = 9999;
    
    const freshCodes = ErrorCodeRegistry.getAllCodes();
    expect(freshCodes.AUTHENTICATION_REQUIRED).toBe(1001);
    expect(freshCodes).toEqual(originalCodes);
  });

  it("ensures all error codes are unique", () => {
    const isUnique = ErrorCodeRegistry.verifyCodeUniqueness();
    expect(isUnique).toBe(true);
    
    // Manual verification for critical codes
    const codes = Object.values(ERROR_CODES);
    const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);
    expect(duplicates).toHaveLength(0);
  });

  it("maintains complete message mapping", () => {
    const isComplete = ErrorCodeRegistry.verifyMessageCompleteness();
    expect(isComplete).toBe(true);
    
    // Verify each code has a corresponding message
    const codeKeys = Object.keys(ERROR_CODES) as Array<keyof typeof ERROR_CODES>;
    for (const key of codeKeys) {
      expect(ERROR_MESSAGES[key]).toBeDefined();
      expect(ERROR_MESSAGES[key]).not.toBe("");
    }
  });

  it("retrieves correct error messages by code", () => {
    expect(ErrorCodeRegistry.getMessage(1001)).toBe("Authentication is required to access this resource");
    expect(ErrorCodeRegistry.getMessage(1101)).toBe("Player not found");
    expect(ErrorCodeRegistry.getMessage(1201)).toBe("Battle instance not found");
    expect(ErrorCodeRegistry.getMessage(1301)).toBe("Invalid action type");
    expect(ErrorCodeRegistry.getMessage(1401)).toBe("Invalid board position");
    expect(ErrorCodeRegistry.getMessage(1500)).toBe("Internal server error");
    expect(ErrorCodeRegistry.getMessage(1601)).toBe("Invalid request format");
  });

  it("returns undefined for non-existent error codes", () => {
    expect(ErrorCodeRegistry.getMessage(9999)).toBeUndefined();
    expect(ErrorCodeRegistry.getMessage(0)).toBeUndefined();
    expect(ErrorCodeRegistry.getMessage(-1)).toBeUndefined();
  });

  it("retrieves codes by name correctly", () => {
    expect(ErrorCodeRegistry.getCodeByName("AUTHENTICATION_REQUIRED")).toBe(1001);
    expect(ErrorCodeRegistry.getCodeByName("PLAYER_NOT_FOUND")).toBe(1101);
    expect(ErrorCodeRegistry.getCodeByName("INSTANCE_FULL")).toBe(1202);
    expect(ErrorCodeRegistry.getCodeByName("INVALID_TILE_PLACEMENT")).toBe(1303);
    expect(ErrorCodeRegistry.getCodeByName("INTERNAL_SERVER_ERROR")).toBe(1500);
  });

  it("validates error code ranges correctly", () => {
    // Valid ranges
    expect(ErrorCodeRegistry.validateCodeRange(1001)).toBe(true);
    expect(ErrorCodeRegistry.validateCodeRange(1699)).toBe(true);
    expect(ErrorCodeRegistry.validateCodeRange(1350)).toBe(true);
    
    // Invalid ranges
    expect(ErrorCodeRegistry.validateCodeRange(1000)).toBe(false);
    expect(ErrorCodeRegistry.validateCodeRange(1700)).toBe(false);
    expect(ErrorCodeRegistry.validateCodeRange(999)).toBe(false);
    expect(ErrorCodeRegistry.validateCodeRange(2000)).toBe(false);
  });

  it("categorizes error codes correctly", () => {
    expect(ErrorCodeRegistry.getCategoryByCode(1001)).toBe("Authentication");
    expect(ErrorCodeRegistry.getCategoryByCode(1101)).toBe("Player Management");
    expect(ErrorCodeRegistry.getCategoryByCode(1201)).toBe("Battle Instance");
    expect(ErrorCodeRegistry.getCategoryByCode(1301)).toBe("Game Actions");
    expect(ErrorCodeRegistry.getCategoryByCode(1401)).toBe("Board & Tiles");
    expect(ErrorCodeRegistry.getCategoryByCode(1501)).toBe("System & Infrastructure");
    expect(ErrorCodeRegistry.getCategoryByCode(1601)).toBe("Validation");
    expect(ErrorCodeRegistry.getCategoryByCode(9999)).toBe("Unknown");
  });

  it("maintains proper error code ranges per category", () => {
    // Authentication: 1000-1099
    expect(ERROR_CODES.AUTHENTICATION_REQUIRED).toBeGreaterThanOrEqual(1001);
    expect(ERROR_CODES.INSUFFICIENT_PERMISSIONS).toBeLessThanOrEqual(1099);
    
    // Player Management: 1100-1199
    expect(ERROR_CODES.PLAYER_NOT_FOUND).toBeGreaterThanOrEqual(1100);
    expect(ERROR_CODES.PLAYER_DISCONNECTED).toBeLessThanOrEqual(1199);
    
    // Battle Instance: 1200-1299
    expect(ERROR_CODES.INSTANCE_NOT_FOUND).toBeGreaterThanOrEqual(1200);
    expect(ERROR_CODES.INVALID_INSTANCE_STATE).toBeLessThanOrEqual(1299);
    
    // Game Actions: 1300-1399
    expect(ERROR_CODES.INVALID_ACTION_TYPE).toBeGreaterThanOrEqual(1300);
    expect(ERROR_CODES.ACTION_VALIDATION_FAILED).toBeLessThanOrEqual(1399);
    
    // Board & Tiles: 1400-1499
    expect(ERROR_CODES.INVALID_BOARD_POSITION).toBeGreaterThanOrEqual(1400);
    expect(ERROR_CODES.BOARD_SIZE_EXCEEDED).toBeLessThanOrEqual(1499);
    
    // System & Infrastructure: 1500-1599
    expect(ERROR_CODES.INTERNAL_SERVER_ERROR).toBeGreaterThanOrEqual(1500);
    expect(ERROR_CODES.SERVICE_UNAVAILABLE).toBeLessThanOrEqual(1599);
    
    // Validation: 1600-1699
    expect(ERROR_CODES.INVALID_REQUEST_FORMAT).toBeGreaterThanOrEqual(1600);
    expect(ERROR_CODES.INVALID_UUID_FORMAT).toBeLessThanOrEqual(1699);
  });

  it("prevents accidental modification of error constants", () => {
    // TypeScript should prevent this at compile time, but test runtime behavior
    const originalValue = ERROR_CODES.AUTHENTICATION_REQUIRED;
    
    // Attempt to modify (should fail silently in non-strict mode or throw in strict)
    try {
      (ERROR_CODES as any).AUTHENTICATION_REQUIRED = 9999;
    } catch (error) {
      // Expected in strict mode
    }
    
    // Value should remain unchanged
    expect(ERROR_CODES.AUTHENTICATION_REQUIRED).toBe(originalValue);
  });

  it("provides consistent error message formatting", () => {
    const messages = Object.values(ERROR_MESSAGES);
    
    // All messages should be non-empty strings
    for (const message of messages) {
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
      expect(message.trim()).toBe(message); // No leading/trailing whitespace
    }
    
    // Messages should not end with periods (for consistency)
    const messagesWithPeriods = messages.filter(msg => msg.endsWith("."));
    expect(messagesWithPeriods).toHaveLength(0);
  });
});