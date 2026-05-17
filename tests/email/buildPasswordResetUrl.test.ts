import { describe, expect, it } from "vitest";

import { buildPasswordResetUrl } from "../../src/email/sendPasswordReset";

describe("buildPasswordResetUrl", () => {
  it("appends encoded token query to configured base", () => {
    const base = (process.env.PASSWORD_RESET_URL_BASE ?? "").replace(
      /\/+$/,
      ""
    );
    const url = buildPasswordResetUrl("abc/+= ");
    expect(url.startsWith(base)).toBe(true);
    expect(url).toContain("token=");
    expect(url).toContain(encodeURIComponent("abc/+= "));
  });
});
