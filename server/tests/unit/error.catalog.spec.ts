import { describe, expect, it } from "vitest";
import { ErrorCatalogService } from "../../src/services/errorCatalog.js";
import { ErrorCodeRegistry } from "../../src/models/errorCodes.js";

const EXPECTED_NUMERIC_CODES = ErrorCodeRegistry.listDefinitions().map(definition => definition.numericCode);

describe("ErrorCatalogService", () => {
  it("returns the full catalog sorted by numeric code", () => {
    const service = new ErrorCatalogService();

    const entries = service.listCatalog();

  expect(entries.map(entry => entry.numericCode)).toEqual(EXPECTED_NUMERIC_CODES);
  expect(entries.every(entry => typeof entry.humanMessage === "string" && entry.humanMessage.length > 0)).toBe(true);
  });

  it("retrieves entries by numeric code, reason, and key", () => {
    const service = new ErrorCatalogService();

    const byCode = service.getByNumericCode("E1006");
    expect(byCode).toMatchObject({ reason: "rate_limit_exceeded", category: "rate_limit" });

    const byReason = service.getByReason("unauthorized_private_message");
    expect(byReason).toMatchObject({ numericCode: "E1008" });

    const byKey = service.getByKey("RETENTION_EXPIRED");
    expect(byKey.numericCode).toBe("E1009");
  });

  it("honors the filter option when provided", () => {
    const service = new ErrorCatalogService({
      filter: definition => definition.category === "validation",
    });

    const entries = service.listCatalog();
    expect(entries).toHaveLength(2);
    expect(entries.map(entry => entry.category)).toEqual(["validation", "validation"]);

    expect(service.getByNumericCode("E1007")).toBeDefined();
    expect(service.getByNumericCode("E1006")).toBeUndefined();

    expect(() => service.getByKey("RATE_LIMIT_EXCEEDED")).toThrowError(
      /not available in this catalog instance/
    );
  });
});
