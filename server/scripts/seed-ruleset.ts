// @ts-nocheck
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { RuleSetMetadata } from "@@/services/rulesetService.js";
import { seedRuleset } from "@@/scripts/seed-ruleset.js";

interface CliOptions {
  version?: string;
  metadataPath?: string;
  allowIfExists?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) {
      continue;
    }
    const [flag, value] = raw.includes("=") ? raw.split("=", 2) : [raw, argv[i + 1]];
    switch (flag) {
      case "--version":
        options.version = value;
        if (!raw.includes("=")) i += 1;
        break;
      case "--metadata":
        options.metadataPath = value;
        if (!raw.includes("=")) i += 1;
        break;
      case "--allow-existing":
        options.allowIfExists = value === undefined ? true : value !== "false";
        if (!raw.includes("=")) i += 1;
        break;
      case "--fail-on-existing":
        options.allowIfExists = false;
        break;
      default:
        break;
    }
  }
  return options;
}

async function loadMetadata(path?: string): Promise<RuleSetMetadata | undefined> {
  if (!path) return undefined;
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as RuleSetMetadata;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const metadata = await loadMetadata(options.metadataPath);
  await seedRuleset({
    version: options.version,
    metadata,
    allowIfExists: options.allowIfExists
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Rule set seed failed", err);
    process.exitCode = 1;
  });
}
