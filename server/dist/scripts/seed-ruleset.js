import { fileURLToPath } from "node:url";
import { initializeContainer, shutdownContainer } from "../infra/container.js";
/** Example baseline rule set. In a real system this could load from JSON or external source. */
const BASE_RULESET = {
    version: "v1",
    metadata: {
        maxPlayers: 4,
        board: {
            width: 16,
            height: 16,
            initialTiles: []
        }
    },
    rules: {
        placement: {
            allowOverlap: false
        }
    }
};
export async function seedRuleset(logger = console) {
    const container = await initializeContainer();
    try {
        const existing = await container.ruleSetRepository.findByVersion(BASE_RULESET.version);
        if (existing) {
            logger.info?.("seed.ruleset.exists", { version: BASE_RULESET.version });
            return;
        }
        await container.ruleSetRepository.create({
            version: BASE_RULESET.version,
            metadataJson: {
                ...BASE_RULESET.metadata,
                rules: BASE_RULESET.rules
            }
        });
        logger.info?.("seed.ruleset.created", { version: BASE_RULESET.version });
    }
    finally {
        await shutdownContainer();
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    seedRuleset().catch((err) => {
        console.error("Rule set seed failed", err);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=seed-ruleset.js.map