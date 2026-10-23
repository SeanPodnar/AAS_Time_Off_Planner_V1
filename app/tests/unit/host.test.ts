import { describe, expect, it } from "vitest";
import { parseHost } from "@/lib/host";

describe("parseHost", () => {
  const root = "aas-timeoff.ca";
  it("maps the bare root domain to the platform", () => {
    expect(parseHost("aas-timeoff.ca", root)).toEqual({ kind: "root" });
    expect(parseHost("AAS-TimeOff.ca:443", root)).toEqual({ kind: "root" });
    expect(parseHost(null, root)).toEqual({ kind: "root" });
  });
  it("maps one-level subdomains to a company", () => {
    expect(parseHost("northwind.aas-timeoff.ca", root)).toEqual({ kind: "subdomain", subdomain: "northwind" });
    expect(parseHost("northwind.localhost:3000", "localhost")).toEqual({ kind: "subdomain", subdomain: "northwind" });
  });
  it("treats deeper subdomains and other hosts as custom domains (which then fail closed if unknown)", () => {
    expect(parseHost("a.b.aas-timeoff.ca", root)).toEqual({ kind: "custom", domain: "a.b.aas-timeoff.ca" });
    expect(parseHost("timeoff.northwind.ca", root)).toEqual({ kind: "custom", domain: "timeoff.northwind.ca" });
  });
  it("does not treat look-alike domains as subdomains", () => {
    expect(parseHost("evilaas-timeoff.ca", root)).toEqual({ kind: "custom", domain: "evilaas-timeoff.ca" });
  });
});
