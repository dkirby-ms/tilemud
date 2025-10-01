// @ts-nocheck
import { fileURLToPath } from "node:url";
import { purgePrivateMessages } from "@@/scripts/purge-private-messages.js";

interface CliOptions {
  retentionDays?: number;
  playerId?: string;
  targets?: string[];
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
      case "--retention-days":
      case "--retention":
        options.retentionDays = value ? Number.parseInt(value, 10) : undefined;
        if (!raw.includes("=")) i += 1;
        break;
      case "--player":
      case "--player-id":
        options.playerId = value;
        if (!raw.includes("=")) i += 1;
        break;
      case "--targets":
      case "--target":
        options.targets = value?.split(",").filter(Boolean);
        if (!raw.includes("=")) i += 1;
        break;
      default:
        break;
    }
  }
  return options;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await purgePrivateMessages({
    retentionDays: args.retentionDays,
    playerId: args.playerId,
    targetPlayerIds: args.targets
  });

  if (result.errors.length) {
    console.error("purge.private_messages.partial", result);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ purged: result.purgedCount }, null, 2));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Private message purge failed", err);
    process.exitCode = 1;
  });
}
