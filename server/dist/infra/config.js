import { z, ZodError } from "zod";
const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
const envSchema = z.object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),
    PORT: z.coerce
        .number({ invalid_type_error: "PORT must be a number" })
        .int("PORT must be an integer")
        .min(1, "PORT must be a valid integer between 1 and 65535")
        .max(65535, "PORT must be a valid integer between 1 and 65535"),
    LOG_LEVEL: logLevelSchema.optional().default("info")
});
let cachedConfig = null;
export function loadConfig(env = process.env) {
    try {
        const parsed = envSchema.parse(env);
        const config = {
            databaseUrl: parsed.DATABASE_URL,
            redisUrl: parsed.REDIS_URL,
            port: parsed.PORT,
            logLevel: parsed.LOG_LEVEL
        };
        cachedConfig = config;
        return config;
    }
    catch (error) {
        if (error instanceof ZodError) {
            const formatted = error.errors
                .map((issue) => {
                const [pathSegment] = issue.path;
                const identifier = typeof pathSegment === "string" ? pathSegment : "unknown";
                return `${identifier}: ${issue.message}`;
            })
                .join("; ");
            throw new Error(`Invalid configuration: ${formatted}`);
        }
        throw error;
    }
}
export function getConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }
    return loadConfig();
}
export function clearConfigCache() {
    cachedConfig = null;
}
//# sourceMappingURL=config.js.map