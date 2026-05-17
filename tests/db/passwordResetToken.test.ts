import { describe, expect, it } from "vitest";

import { hashPasswordResetToken } from "../../src/db/passwordResetQueries";

describe("hashPasswordResetToken", () => {
  it("returns 64-char lowercase hex SHA-256", () => {
    const h = hashPasswordResetToken("test-raw");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for different inputs", () => {
    expect(hashPasswordResetToken("a")).not.toBe(hashPasswordResetToken("b"));
  });
});
