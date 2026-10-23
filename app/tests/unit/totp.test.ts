import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, codeAt, newSecret, otpauthUri, stepOf, verifyCode } from "@/lib/totp";
import { open, seal } from "@/lib/secretbox";

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890"; last 6 digits of the 8-digit values.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const vectors: [number, string][] = [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"]];

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors", () => {
    for (const [t, code] of vectors) expect(codeAt(RFC_SECRET, Math.floor(t / 30))).toBe(code);
  });
  it("round-trips base32", () => {
    const b = Buffer.from([0, 1, 2, 250, 251, 252, 253]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
    expect(newSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it("accepts one step of clock drift either side, and nothing further", () => {
    const now = new Date(1_800_000_000_000);
    const s = stepOf(now);
    expect(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, s), now, 0)).toBe(s);
    expect(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, s - 1), now, 0)).toBe(s - 1);
    expect(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, s + 1), now, 0)).toBe(s + 1);
    expect(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, s - 2), now, 0)).toBeNull();
  });
  it("rejects a code that was already used (same or earlier step)", () => {
    const now = new Date(1_800_000_000_000);
    const s = stepOf(now);
    expect(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, s), now, s)).toBeNull();
  });
  it("rejects malformed input", () => {
    for (const c of ["", "12345", "1234567", "abcdef"]) expect(verifyCode(RFC_SECRET, c, new Date(), 0)).toBeNull();
  });
  it("builds an authenticator app link with the company name as issuer", () => {
    expect(otpauthUri("ABC", "Northwind Time Off", "priya@nw.example")).toBe(
      "otpauth://totp/Northwind%20Time%20Off%3Apriya%40nw.example?secret=ABC&issuer=Northwind%20Time%20Off&algorithm=SHA1&digits=6&period=30");
  });
});

describe("secretbox", () => {
  it("encrypts, decrypts and refuses a secret moved to another owner", () => {
    process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
    const box = seal("SECRET", "person-1");
    expect(box.includes(Buffer.from("SECRET"))).toBe(false);
    expect(open(box, "person-1")).toBe("SECRET");
    expect(() => open(box, "person-2")).toThrow();
  });
});
