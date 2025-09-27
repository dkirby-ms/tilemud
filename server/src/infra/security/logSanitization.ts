/**
 * Security Audit: Secrets and Rate Limit Error Sanitization
 * 
 * This utility ensures sensitive information is not exposed in logs
 * and that rate limit errors are properly sanitized.
 * 
 * FR-015: Administrative moderation and safety
 * FR-012: Rate limiting and abuse prevention
 */

import { createServiceLogger } from '../monitoring/logger';

const logger = createServiceLogger('SecurityAudit');

// Patterns for sensitive data that should not appear in logs
const SENSITIVE_PATTERNS = [
  // Database credentials
  /postgresql:\/\/[^:]+:[^@]+@/gi,
  /mysql:\/\/[^:]+:[^@]+@/gi,
  /mongodb:\/\/[^:]+:[^@]+@/gi,
  
  // API keys and tokens
  /['"](sk|pk|api)[-_]?[a-zA-Z0-9]{16,}['"]/gi,
  /bearer\s+[a-zA-Z0-9+/]{20,}/gi,
  /['"](access|session|jwt)[-_]?token['"]:\s*['"][^'"]{16,}['"]/gi,
  
  // Password fields
  /['"](password|passwd|pwd)['"]:\s*['"][^'"]+['"]/gi,
  /password=\w+/gi,
  
  // Private keys
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
  /-----BEGIN\s+CERTIFICATE-----[\s\S]*?-----END\s+CERTIFICATE-----/gi,
  
  // Player IDs in certain contexts (privacy)
  /playerId['":]?\s*['"][^'"]{20,}['"]/gi,
  
  // Session IDs
  /sessionId['":]?\s*['"][^'"]{20,}['"]/gi,
  
  // Email addresses (privacy)
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
];

// Fields that should be redacted from log objects
const SENSITIVE_FIELDS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'apiKey',
  'token',
  'accessToken',
  'sessionToken',
  'refreshToken',
  'privateKey',
  'publicKey',
  'certificate',
  'connectionString',
  'databaseUrl',
  'email',
  'emailAddress',
  'creditCard',
  'ssn',
  'phoneNumber',
];

export interface SanitizationOptions {
  redactSensitiveFields?: boolean;
  sanitizeStrings?: boolean;
  preserveStructure?: boolean;
  replacementText?: string;
}

/**
 * Sanitize log data to remove sensitive information
 */
export function sanitizeLogData(
  data: any, 
  options: SanitizationOptions = {}
): any {
  const {
    redactSensitiveFields = true,
    sanitizeStrings = true,
    preserveStructure = true,
    replacementText = '[REDACTED]'
  } = options;

  if (data === null || data === undefined) {
    return data;
  }

  // Handle strings
  if (typeof data === 'string') {
    if (sanitizeStrings) {
      return sanitizeString(data, replacementText);
    }
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitizeLogData(item, options));
  }

  // Handle objects
  if (typeof data === 'object') {
    const sanitized: any = preserveStructure ? {} : {};

    for (const [key, value] of Object.entries(data)) {
      const keyLower = key.toLowerCase();
      
      // Check if field should be redacted
      if (redactSensitiveFields && SENSITIVE_FIELDS.some(field => keyLower.includes(field))) {
        sanitized[key] = replacementText;
      } else if (typeof value === 'string' && sanitizeStrings) {
        sanitized[key] = sanitizeString(value, replacementText);
      } else {
        sanitized[key] = sanitizeLogData(value, options);
      }
    }

    return sanitized;
  }

  return data;
}

/**
 * Sanitize string content by removing sensitive patterns
 */
function sanitizeString(text: string, replacement: string = '[REDACTED]'): string {
  let sanitized = text;

  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

/**
 * Sanitize rate limit error messages to prevent information leakage
 */
export function sanitizeRateLimitError(
  error: any,
  clientInfo?: { ip?: string; userId?: string }
): { error: string; code: string; retryAfterMs?: number } {
  const sanitized: {
    error: string;
    code: string;
    retryAfterMs?: number;
  } = {
    error: 'Rate limit exceeded',
    code: 'RATE_LIMITED',
  };

  // Extract safe retry information
  if (error && typeof error.retryAfterMs === 'number') {
    // Cap retry time to prevent abuse
    sanitized.retryAfterMs = Math.min(error.retryAfterMs, 300000); // Max 5 minutes
  }

  // Log the rate limit event securely
  logger.warn({
    event: 'rate_limit_triggered',
    clientIp: clientInfo?.ip ? hashClientIdentifier(clientInfo.ip) : 'unknown',
    userId: clientInfo?.userId ? hashClientIdentifier(clientInfo.userId) : 'anonymous',
    retryAfterMs: sanitized.retryAfterMs,
    timestamp: Date.now(),
  }, 'Rate limit exceeded for client');

  return sanitized;
}

/**
 * Hash client identifiers for privacy-preserving logging
 */
function hashClientIdentifier(identifier: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(identifier).digest('hex').substring(0, 8);
}

/**
 * Audit log entries for sensitive data exposure
 */
export function auditLogEntry(logEntry: any): {
  hasSensitiveData: boolean;
  violations: string[];
  sanitizedEntry: any;
} {
  const violations: string[] = [];
  const sanitizedEntry = sanitizeLogData(logEntry);

  // Convert log entry to string for pattern matching
  const logString = JSON.stringify(logEntry);

  // Check for sensitive patterns
  for (let i = 0; i < SENSITIVE_PATTERNS.length; i++) {
    const pattern = SENSITIVE_PATTERNS[i];
    if (pattern && pattern.test(logString)) {
      violations.push(`Sensitive pattern ${i + 1} detected`);
    }
  }

  // Check for sensitive field names
  const checkForSensitiveFields = (obj: any, path: string = ''): void => {
    if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${key}` : key;
        const keyLower = key.toLowerCase();
        
        if (SENSITIVE_FIELDS.some(field => keyLower.includes(field))) {
          violations.push(`Sensitive field detected: ${fullPath}`);
        }
        
        if (typeof value === 'object') {
          checkForSensitiveFields(value, fullPath);
        }
      }
    }
  };

  checkForSensitiveFields(logEntry);

  return {
    hasSensitiveData: violations.length > 0,
    violations,
    sanitizedEntry,
  };
}

/**
 * Create a secure logging wrapper that automatically sanitizes data
 */
export function createSecureLogger(serviceName: string) {
  const baseLogger = createServiceLogger(serviceName);

  return {
    debug: (data: any, message?: string) => {
      const sanitized = sanitizeLogData(data);
      baseLogger.debug(sanitized, message);
    },

    info: (data: any, message?: string) => {
      const sanitized = sanitizeLogData(data);
      baseLogger.info(sanitized, message);
    },

    warn: (data: any, message?: string) => {
      const sanitized = sanitizeLogData(data);
      baseLogger.warn(sanitized, message);
    },

    error: (data: any, message?: string) => {
      const sanitized = sanitizeLogData(data);
      baseLogger.error(sanitized, message);
    },

    // Audit existing log entry
    audit: (data: any) => {
      const auditResult = auditLogEntry(data);
      if (auditResult.hasSensitiveData) {
        logger.warn({
          event: 'sensitive_data_in_logs',
          violations: auditResult.violations,
          service: serviceName,
        }, 'Sensitive data detected in log entry');
      }
      return auditResult;
    },
  };
}

/**
 * Middleware to sanitize request/response logs
 */
export function createLoggingSanitizationMiddleware() {
  return (req: any, res: any, next: any) => {
    // Sanitize request logging
    const originalSend = res.send;
    res.send = function(data: any) {
      // Log response with sanitization
      const sanitizedData = sanitizeLogData(data);
      logger.debug({
        event: 'http_response',
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseData: sanitizedData,
      }, `HTTP ${req.method} ${req.path} - ${res.statusCode}`);

      return originalSend.call(this, data);
    };

    // Sanitize request data in logs
    const sanitizedBody = sanitizeLogData(req.body);
    const sanitizedQuery = sanitizeLogData(req.query);

    logger.debug({
      event: 'http_request',
      method: req.method,
      path: req.path,
      body: sanitizedBody,
      query: sanitizedQuery,
    }, `HTTP ${req.method} ${req.path}`);

    next();
  };
}

/**
 * Run security audit on log files
 */
export async function auditLogFiles(logDirectory: string): Promise<{
  filesAudited: number;
  violationsFound: number;
  violations: Array<{
    file: string;
    line: number;
    violation: string;
  }>;
}> {
  const fs = require('fs');
  const path = require('path');
  const readline = require('readline');

  const results = {
    filesAudited: 0,
    violationsFound: 0,
    violations: [] as Array<{ file: string; line: number; violation: string; }>,
  };

  if (!fs.existsSync(logDirectory)) {
    logger.warn(`Log directory does not exist: ${logDirectory}`);
    return results;
  }

  const files = fs.readdirSync(logDirectory)
    .filter((file: string) => file.endsWith('.log') || file.endsWith('.json'));

  for (const filename of files) {
    const filePath = path.join(logDirectory, filename);
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream });

    let lineNumber = 0;

    for await (const line of rl) {
      lineNumber++;
      
      try {
        let logData;
        try {
          logData = JSON.parse(line);
        } catch {
          // Not JSON, treat as plain text
          logData = line;
        }

        const auditResult = auditLogEntry(logData);
        if (auditResult.hasSensitiveData) {
          results.violationsFound++;
          for (const violation of auditResult.violations) {
            results.violations.push({
              file: filename,
              line: lineNumber,
              violation,
            });
          }
        }
      } catch (error) {
        logger.error({
          event: 'log_audit_error',
          file: filename,
          line: lineNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        }, 'Error auditing log line');
      }
    }

    results.filesAudited++;
  }

  return results;
}

// Export for testing
export {
  SENSITIVE_PATTERNS,
  SENSITIVE_FIELDS,
  sanitizeString,
  hashClientIdentifier,
};