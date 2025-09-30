import { Router } from "express";
export function createHealthRouter(logger) {
    const router = Router();
    router.get("/health", (_req, res) => {
        // Basic liveness; can be extended with DB/Redis checks later (T054)
        logger.debug?.("health.check");
        res.status(200).json({ status: "ok" });
    });
    return router;
}
//# sourceMappingURL=health.js.map