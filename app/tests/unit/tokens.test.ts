import { describe, expect, it } from "vitest";
import { hashToken, looksLikeToken, newToken } from "@/lib/tokens";
import { RateLimiter } from "@/lib/rate-limit";

describe("tokens", () => {
  it("are 256-bit, URL-safe and unique", () => {
    const a = newToken(), b = newToken();
    expect(looksLikeToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toHaveLength(32);
  });
  it("rejects anything that is not a token shape", () => {
    for (const t of [undefined, "", "abc", "x".repeat(44), "a".repeat(42) + "=", 42]) expect(looksLikeToken(t)).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit per window, then resets", () => {
    const rl = new RateLimiter(2, 1000);
    expect([rl.take("k", 0), rl.take("k", 1), rl.take("k", 2)]).toEqual([true, true, false]);
    expect(rl.take("other", 2)).toBe(true);
    expect(rl.take("k", 1001)).toBe(true);
  });
});
