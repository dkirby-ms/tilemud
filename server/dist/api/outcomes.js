import { Router } from "express";
export function createOutcomesRouter(deps) {
    const router = Router();
    const { outcomeService, logger } = deps;
    // GET /outcomes/:id
    router.get("/outcomes/:id", async (req, res, next) => {
        try {
            const outcome = await outcomeService.getOutcomeById(req.params.id, {});
            res.status(200).json(outcome);
        }
        catch (error) {
            logger.debug?.({ err: error, outcomeId: req.params.id }, "outcome.fetch.error");
            next(error);
        }
    });
    // GET /players/:playerId/outcomes
    router.get("/players/:playerId/outcomes", async (req, res, next) => {
        try {
            const { limit, offset } = req.query;
            const list = await outcomeService.listOutcomesForPlayer(req.params.playerId, {
                limit: limit ? Number(limit) : undefined,
                offset: offset ? Number(offset) : undefined
            });
            res.status(200).json(list);
        }
        catch (error) {
            logger.error?.({ err: error }, "player.outcomes.error");
            next(error);
        }
    });
    return router;
}
//# sourceMappingURL=outcomes.js.map