import { describe, expect, it } from "vitest";
import { createTestAgent } from "../utils/testServer.js";

const EXPECTED_ERROR_CODES = [
  { numericCode: "E1001", reason: "invalid_tile_placement" },
  { numericCode: "E1002", reason: "precedence_conflict" },
  { numericCode: "E1003", reason: "instance_capacity_exceeded" },
  { numericCode: "E1004", reason: "instance_terminated" },
  { numericCode: "E1005", reason: "grace_period_expired" },
  { numericCode: "E1006", reason: "rate_limit_exceeded" },
  { numericCode: "E1007", reason: "cross_instance_action" },
  { numericCode: "E1008", reason: "unauthorized_private_message" },
  { numericCode: "E1009", reason: "retention_expired" },
  { numericCode: "E1010", reason: "internal_error" }
];

describe("GET /errors/catalog", () => {
  it("returns the seeded error catalog", async () => {
    const agent = await createTestAgent();

    const response = await agent.get("/errors/catalog").expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining(
          EXPECTED_ERROR_CODES.map((expected) =>
            expect.objectContaining({
              numericCode: expected.numericCode,
              reason: expected.reason,
              category: expect.any(String),
              retryable: expect.any(Boolean),
              humanMessage: expect.any(String)
            })
          )
        )
      })
    );
  });
});
