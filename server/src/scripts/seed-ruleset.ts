import { fileURLToPath } from "node:url";
import { initializeContainer, shutdownContainer } from "../infra/container.js";
import type { AppLogger } from "../logging/logger.js";
import type { RuleSetMetadata } from "../services/rulesetService.js";

const DEFAULT_RULESET_VERSION = "1.0.0";

const DEFAULT_RULESET_METADATA: RuleSetMetadata = {
  description: "Baseline arena with symmetric spawn tiles and neutral control points.",
  tags: ["baseline", "solo", "pvp"],
  maxPlayers: 16,
  board: {
    width: 16,
    height: 16,
    initialTiles: [
      { x: 7, y: 7, tileType: 1 },
      { x: 8, y: 8, tileType: 1 },
      { x: 7, y: 8, tileType: 2 },
      { x: 8, y: 7, tileType: 2 },
      { x: 0, y: 0, tileType: 9 },
      { x: 15, y: 15, tileType: 9 }
    ]
  },
  placement: {
    adjacency: "orthogonal",
    allowFirstPlacementAnywhere: true
  },
  extras: {
    ruleSetName: "baseline-arena",
    placementInitiative: "player",
    npcScriptVersion: "1.0.0"
  }
};

export interface SeedRulesetOptions {
  version?: string;
  metadata?: RuleSetMetadata;
  logger?: AppLogger;
  /**
   * When true (default) the script will treat an existing version as success and avoid throwing.
   * Set to false to receive an error if the version already exists.
   */
  allowIfExists?: boolean;
}

export async function seedRuleset(options: SeedRulesetOptions = {}): Promise<void> {
  const container = await initializeContainer();
  const logger = options.logger ?? container.logger ?? console;
  const version = options.version ?? DEFAULT_RULESET_VERSION;
  const metadata = options.metadata ?? DEFAULT_RULESET_METADATA;
  const allowIfExists = options.allowIfExists ?? true;

  try {
    const existing = await container.ruleSetService.getRuleSetByVersion(version);
    if (existing) {
      const message = allowIfExists
        ? "seed.ruleset.exists"
        : "seed.ruleset.exists.error";
      logger.info?.(message, { version });
      if (!allowIfExists) {
        throw new Error(`Rule set version ${version} already exists.`);
      }
      return;
    }

    const created = await container.ruleSetService.publishRuleSet({
      version,
      metadata
    });

    logger.info?.("seed.ruleset.created", {
      version: created.version,
      ruleSetId: created.id,
      initialTileCount: created.metadata.board.initialTiles.length
    });
  } catch (error) {
    logger.error?.("seed.ruleset.failed", { version, error });
    throw error;
  } finally {
    await shutdownContainer();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedRuleset().catch((err) => {
    console.error("Rule set seed failed", err);
    process.exitCode = 1;
  });
}
