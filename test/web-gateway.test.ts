import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
const origin = "https://test";
async function login() {
  return exports.default.fetch(origin + "/test/api/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "test-private-code" }),
  });
}
describe("private browser test gateway", () => {
  it("serves a secret-free page and rejects unauthenticated API access", async () => {
    const page = await exports.default.fetch(origin + "/test/");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("行旅");
    expect(html).not.toContain("test-private-code");
    expect(page.headers.get("Content-Security-Policy")).toContain(
      "script-src 'self'",
    );
    expect((await exports.default.fetch(origin + "/test/api/me")).status).toBe(
      401,
    );
  });
  it("uses a signed HttpOnly cookie, rejects tampering and isolates the API surface", async () => {
    const response = await login(),
      set = response.headers.get("Set-Cookie")!;
    expect(response.status).toBe(200);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Strict");
    expect(set).toContain("Secure");
    const cookie = set.split(";")[0];
    expect(
      (
        await exports.default.fetch(origin + "/test/api/me", {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await exports.default.fetch(origin + "/test/api/me", {
          headers: { Cookie: cookie + "tampered" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await exports.default.fetch(origin + "/test/api/agents", {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(404);
  });
  it("rejects cross-origin changes and wrong access codes", async () => {
    expect(
      (
        await exports.default.fetch(origin + "/test/api/login", {
          method: "POST",
          headers: { Origin: "https://elsewhere.example" },
          body: JSON.stringify({ code: "test-private-code" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await exports.default.fetch(origin + "/test/api/login", {
          method: "POST",
          headers: { Origin: origin },
          body: JSON.stringify({ code: "wrong" }),
        })
      ).status,
    ).toBe(401);
  });
});
