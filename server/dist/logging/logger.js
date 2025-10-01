import pinoPkg from "pino";
// pino has both CJS/ESM signatures; treat imported value as callable factory
const pino = pinoPkg;
function buildOptions(options = {}) {
    const level = options.level || process.env.LOG_LEVEL || "info";
    const base = {
        level,
        name: options.name || "tilemud"
    };
    if (options.pretty || process.env.LOG_PRETTY === "true") {
        // Lazy require to keep ESM compatibility without extra deps when not needed
        return {
            ...base,
            transport: {
                target: "pino-pretty",
                options: {
                    colorize: true,
                    translateTime: "SYS:standard",
                    singleLine: true
                }
            }
        }; // transport not in base LoggerOptions typing pre v9
    }
    return base;
}
let rootLogger = null;
export function getLogger(options) {
    if (!rootLogger) {
        rootLogger = pino(buildOptions(options));
    }
    return rootLogger;
}
export function createChildLogger(binding) {
    return getLogger().child(binding);
}
export function getAppLogger() {
    const base = getLogger();
    const adapter = {
        debug: (...args) => { base.debug?.(args[0], ...args.slice(1)); },
        info: (...args) => { base.info?.(args[0], ...args.slice(1)); },
        warn: (...args) => { base.warn?.(args[0], ...args.slice(1)); },
        error: (...args) => { base.error?.(args[0], ...args.slice(1)); },
        child: (bindings) => {
            const child = base.child?.(bindings);
            return {
                debug: (...args) => { child.debug?.(args[0], ...args.slice(1)); },
                info: (...args) => { child.info?.(args[0], ...args.slice(1)); },
                warn: (...args) => { child.warn?.(args[0], ...args.slice(1)); },
                error: (...args) => { child.error?.(args[0], ...args.slice(1)); },
                child: adapter.child // reuse top-level child to maintain chain
            };
        }
    };
    return adapter;
}
//# sourceMappingURL=logger.js.map