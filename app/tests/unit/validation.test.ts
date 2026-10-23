import { describe, expect, it } from "vitest";
import { tenantInput, fieldErrors } from "@/lib/validation";

const good = { legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", customDomain: "", brandColor: "#2F7FD8", country: "CA" };

describe("tenantInput", () => {
  it("accepts a valid company and normalises fields", () => {
    const r = tenantInput.parse({ ...good, subdomain: " NorthWind ", customDomain: "TimeOff.Northwind.ca" });
    expect(r.subdomain).toBe("northwind");
    expect(r.customDomain).toBe("timeoff.northwind.ca");
    expect(r.brandColor).toBe("#2f7fd8");
  });
  it("treats a blank custom domain as none", () => {
    expect(tenantInput.parse(good).customDomain).toBeNull();
  });
  it("requires a short label of 24 characters or fewer", () => {
    expect(fieldErrors(tenantInput.safeParse({ ...good, shortLabel: "   " }).error!).shortLabel).toMatch(/short label/);
    expect(tenantInput.safeParse({ ...good, shortLabel: "x".repeat(24) }).success).toBe(true);
    expect(fieldErrors(tenantInput.safeParse({ ...good, shortLabel: "x".repeat(25) }).error!).shortLabel).toMatch(/24/);
  });
  it("rejects bad and reserved sign-in addresses", () => {
    for (const s of ["-north", "north-", "no rth", "a".repeat(33), "north.wind"]) {
      expect(tenantInput.safeParse({ ...good, subdomain: s }).success, s).toBe(false);
    }
    expect(fieldErrors(tenantInput.safeParse({ ...good, subdomain: "admin" }).error!).subdomain).toMatch(/reserved/);
  });
  it("rejects custom domains with a scheme or path", () => {
    for (const d of ["https://timeoff.example.com", "timeoff.example.com/x", "localhost"]) {
      expect(tenantInput.safeParse({ ...good, customDomain: d }).success, d).toBe(false);
    }
  });
  it("rejects bad colours and countries", () => {
    expect(tenantInput.safeParse({ ...good, brandColor: "blue" }).success).toBe(false);
    expect(tenantInput.safeParse({ ...good, country: "UK" }).success).toBe(false);
  });
});
