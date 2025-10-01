// Loads environment variables from .env (and optionally .env.local) using dotenv.
// This module should be imported before any config access.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
// Resolve server project root (directory containing package.json)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..", "..");
// Load order (do not override already-set vars):
// 1. server/.env.local
// 2. server/.env
const candidates = [
    path.join(serverRoot, ".env.local"),
    path.join(serverRoot, ".env")
];
for (const file of candidates) {
    if (fs.existsSync(file)) {
        dotenv.config({ path: file, override: false });
    }
}
// No implicit derivation from infra scripts anymore; keep behavior explicit.
//# sourceMappingURL=envBootstrap.js.map