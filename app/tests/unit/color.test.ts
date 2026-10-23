import { describe, expect, it } from "vitest";
import { brandInk, contrastRatio, meetsAA } from "@/lib/color";

describe("colour contrast", () => {
  it("computes known ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
  it("picks readable button text", () => {
    expect(brandInk("#2b6cb0")).toBe("#ffffff");
    expect(brandInk("#ffe066")).toBe("#0d1b2e");
  });
  it("flags colours below AA for white text", () => {
    expect(meetsAA("#2b6cb0")).toBe(true);
    expect(meetsAA("#7bb8f0")).toBe(false);
  });
});
