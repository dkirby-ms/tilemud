import { fileURLToPath } from "node:url";
import { initializeContainer, shutdownContainer } from "../infra/container.js";
import { createMessagePurgeHelper } from "../models/privateMessageRepository.js";
export async function purgePrivateMessages(options = {}) {
    const container = await initializeContainer();
    const logger = options.logger ?? container.logger ?? console;
    const retention = Math.max(1, Math.floor(options.retentionDays ?? 30));
    try {
        const helper = createMessagePurgeHelper(container.privateMessageRepository);
        let result;
        if (options.playerId && options.targetPlayerIds && options.targetPlayerIds.length) {
            result = await helper.purgeUserConversations(options.playerId, options.targetPlayerIds);
            logger.info?.("purge.private_messages.conversations", {
                playerId: options.playerId,
                targetCount: options.targetPlayerIds.length,
                purged: result.purgedCount,
                errors: result.errors
            });
        }
        else {
            result = await helper.runScheduledPurge(retention);
            logger.info?.("purge.private_messages.retention", {
                retentionDays: retention,
                purged: result.purgedCount,
                errors: result.errors
            });
        }
        return result;
    }
    catch (error) {
        logger.error?.("purge.private_messages.failed", { error });
        throw error;
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