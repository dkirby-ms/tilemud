import { TileMudError } from "../models/errorCodes.js";
import { ErrorCodeRegistry } from "../models/errorCodes.js";
function mapErrorCodeToStatus(code) {
    switch (code) {
        case "INSTANCE_TERMINATED":
            return 404;
        case "UNAUTHORIZED_PRIVATE_MESSAGE":
            return 403;
        case "INVALID_TILE_PLACEMENT":
        case "CROSS_INSTANCE_ACTION":
            return 400;
        case "RATE_LIMIT_EXCEEDED":
            return 429;
        default:
            return 500;
    }
}
export function createErrorMiddleware(logger) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express error signature requires 4 args
    return function errorMiddleware(err, _req, res, _next) {
        if (err instanceof TileMudError) {
            const status = mapErrorCodeToStatus(err.code);
            const def = err.definition;
            logger.warn?.({ err, code: err.code }, "request.error.tilemud");
            res.status(status).json({
                numericCode: def.numericCode,
                reason: def.reason,
                category: def.category,
                retryable: def.retryable,
                humanMessage: def.humanMessage,
                details: err.details
            });
            return;
        }
        // Unknown error -> INTERNAL_ERROR
        logger.error?.({ err }, "request.error.unhandled");
        const internal = ErrorCodeRegistry.getDefinitionByKey("INTERNAL_ERROR");
        res.status(500).json({
            numericCode: internal.numericCode,
            reason: internal.reason,
            category: internal.category,
            retryable: internal.retryable,
            humanMessage: internal.humanMessage
        });
    };
}
//# sourceMappingURL=errorMiddleware.js.map