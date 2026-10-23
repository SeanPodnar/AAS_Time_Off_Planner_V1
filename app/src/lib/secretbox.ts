// AES-256-GCM for small secrets (two-factor keys). The key comes from MFA_ENCRYPTION_KEY
// (32 random bytes, base64) and is never stored in the database. The owner id is bound in as
// associated data, so a secret copied onto another person's row fails to decrypt.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) throw new Error("MFA_ENCRYPTION_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function seal(plain: string, boundTo: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(boundTo));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function open(box: Buffer, boundTo: string): string {
  const d = createDecipheriv("aes-256-gcm", key(), box.subarray(0, 12));
  d.setAAD(Buffer.from(boundTo));
  d.setAuthTag(box.subarray(12, 28));
  return Buffer.concat([d.update(box.subarray(28)), d.final()]).toString("utf8");
}
