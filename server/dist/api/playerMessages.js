import { Router } from "express";
export function createPlayerMessagesRouter(deps) {
    const router = Router();
    const { messageService, logger } = deps;
    // GET /players/:playerId/messages
    router.get("/players/:playerId/messages", async (req, res, next) => {
        try {
            const { direction, limit, since } = req.query;
            const list = await messageService.listMessagesForPlayer(req.params.playerId, {
                direction: typeof direction === "string" ? direction : undefined,
                limit: limit ? Number(limit) : undefined,
                since: typeof since === "string" ? since : undefined
            });
            res.status(200).json(list);
        }
        catch (error) {
            logger.error?.({ err: error }, "player.messages.error");
            next(error);
        }
    });
    return router;
}
//# sourceMappingURL=playerMessages.js.map