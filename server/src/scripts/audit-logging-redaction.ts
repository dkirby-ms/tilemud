#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { constants, access } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";

interface AuditFinding {
  source: string;
  line: number;
  message: string;
  sample: string;
}

const BANNED_KEYS = [
  "accessToken",
  "refreshToken",
  "idToken",
  "password",
  "ssn",
  "email",
  "phoneNumber",
  "pii",
  "rawPayload"
];

const SENSITIVE_PATTERNS: ReadonlyArray<{ description: string; regex: RegExp }> = [
  { description: "likely JWT token", regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { description: "email address", regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { description: "US SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { description: "unmasked token", regex: /token\s*"?\s*:\s*"(?!\*{3})[^"]+"/i }
];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function auditFile(filePath: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const readable = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: readable, crlfDelay: Infinity });

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;

    for (const key of BANNED_KEYS) {
      const keyPattern = new RegExp(`"${key}"\s*:\s*"(?!\*{3})`, "i");
      if (keyPattern.test(line)) {
        findings.push({
          source: filePath,
          line: lineNumber,
          message: `Sensitive key \"${key}\" appears unredacted`,
          sample: line.trim().slice(0, 160)
        });
      }
    }

  for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          source: filePath,
          line: lineNumber,
          message: pattern.description,
          sample: line.trim().slice(0, 160)
        });
      }
    }
  }

  return findings;
}

async function collectInputs(argv: string[]): Promise<string[]> {
  const inputs = argv.filter((segment) => !segment.startsWith("-"));
  if (inputs.length > 0) {
    const resolved = await Promise.all(inputs.map(async (entry) => {
      const absolute = path.resolve(process.cwd(), entry);
      return (await fileExists(absolute)) ? absolute : entry;
    }));
    return resolved.filter((entry) => entry.startsWith("/"));
  }

  return [];
}

async function main(): Promise<void> {
  const inputs = await collectInputs(process.argv.slice(2));
  if (inputs.length === 0) {
    // fallback: check default logfile locations if available
    const defaults = [
      path.resolve(process.cwd(), "logs/server.log"),
      path.resolve(process.cwd(), "logs/app.log"),
      path.resolve(process.cwd(), "../logs/server.log")
    ];
    for (const candidate of defaults) {
      if (await fileExists(candidate)) {
        inputs.push(candidate);
      }
    }
  }

  if (inputs.length === 0) {
    console.warn("audit: no log files supplied; provide paths as arguments");
    return;
  }

  const allFindings: AuditFinding[] = [];
  for (const input of inputs) {
    const findings = await auditFile(input);
    allFindings.push(...findings);
  }

  if (allFindings.length === 0) {
    console.log("audit: no potential PII findings detected");
    return;
  }

  console.error("audit: potential PII leakage detected");
  for (const finding of allFindings) {
    console.error(
      `${finding.source}:${finding.line}: ${finding.message}\n  sample: ${finding.sample}`
    );
  }
  process.exitCode = 1;
}

void main().catch((error) => {
  console.error("audit: failed to complete redaction audit", error);
  process.exitCode = 1;
});
