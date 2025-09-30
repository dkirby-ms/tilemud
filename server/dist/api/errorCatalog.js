import { Router } from "express";
export function createErrorCatalogRouter(deps) {
    const router = Router();
    const { errorCatalog, logger } = deps;
    router.get("/errors/catalog", (_req, res) => {
        const items = errorCatalog.listCatalog();
        logger.debug?.({ count: items.length }, "errors.catalog.list");
        res.status(200).json({ items });
    });
    return router;
}
//# sourceMappingURL=errorCatalog.js.map