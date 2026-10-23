import { z } from "zod";

export const SHORT_LABEL_MAX = 24;
export const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin", "platform", "mail", "static", "assets", "status"]);

const hostname = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export const tenantInput = z.object({
  legalName: z.string().trim().min(1, "Enter the full legal name.").max(200, "Keep the legal name to 200 characters or fewer."),
  shortLabel: z
    .string()
    .trim()
    .min(1, "Enter a short label.")
    .max(SHORT_LABEL_MAX, `Keep the short label to ${SHORT_LABEL_MAX} characters or fewer.`),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/, "Use 1 to 32 lowercase letters, digits or hyphens, not starting or ending with a hyphen.")
    .refine((s) => !RESERVED_SUBDOMAINS.has(s), "That address is reserved. Choose another."),
  customDomain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((s) => (s === "" ? null : s))
    .refine((s) => s === null || hostname.test(s), "Enter a domain like timeoff.example.com, without https://.")
    .nullable()
    .default(null),
  brandColor: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^#[0-9a-f]{6}$/, "Use a colour like #2f7fd8."),
  country: z.enum(["CA", "US"], { message: "Choose Canada or United States." }),
});

export type TenantInput = z.infer<typeof tenantInput>;

/** Field errors keyed by input name, first message only. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
