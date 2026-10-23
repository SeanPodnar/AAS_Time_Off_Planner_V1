import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A new random secret for a sign-in link or session cookie (256 bits, URL-safe). */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored. A database leak cannot be replayed as a sign-in. */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function looksLikeToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
