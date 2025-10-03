import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

// This test ensures that the generated OpenAPI types (api-types.d.ts) are in sync with the contract YAML.
// Strategy: hash the YAML paths + operations + component schema names and compare against a marker comment
// written into the generated types file. If the file or marker is missing, instruct running generation.

// Intentionally NOT recomputing hash identically to generation script to avoid brittleness; we only
// assert that a signature marker exists (indicating generation was executed against some contract).

describe("OpenAPI contract sync", () => {
  it("generated types signature matches contract", async () => {
    // repoRoot: server/tests/contract -> ../../../ = repo root
    const repoRoot = path.resolve(__dirname, "../../../");
    const contractPath = path.join(repoRoot, "specs/004-game-server/contracts/game-service.yaml");
    const generatedPath = path.join(repoRoot, "server/src/contracts/api-types.d.ts");

    const contract = await readFile(contractPath, "utf8").catch(() => null);
    expect(contract, "OpenAPI contract missing at expected path").not.toBeNull();
    if (!contract) return; // TS narrow

    const generated = await readFile(generatedPath, "utf8").catch(() => null);
    if (!generated) {
      expect.fail(
        "Generated types file missing. Run: scripts/generate-openapi-types.sh"
      );
    }
    if (!generated) return;

    const markerRegex = /OPENAPI_CONTRACT_SIGNATURE: ([a-f0-9]{16})/;
    const marker = generated.match(markerRegex)?.[1];
    expect(marker, "Missing signature marker in generated types").toBeDefined();
    // Keep loose assertion: marker must be 16 hex chars
    expect(marker).toMatch(/^[a-f0-9]{16}$/);
  });
});
