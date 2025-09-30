import { fileURLToPath } from "node:url";
import { initializeContainer, shutdownContainer } from "../infra/container.js";
export async function purgePrivateMessages(options = {}) {
    const retention = Math.max(1, Math.floor(options.retentionDays ?? 30));
    const logger = options.logger ?? console;
    const container = await initializeContainer();
    try {
        const deleted = await container.privateMessageRepository.purgeOldMessages(retention);
        logger.info?.("purge.private_messages", { retentionDays: retention, deleted });
        return deleted;
    }
    finally {
        await shutdownContainer();
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    purgePrivateMessages().catch((err) => {
        console.error("Private message purge failed", err);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=purge-private-messages.js.map