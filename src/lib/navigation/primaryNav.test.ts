import { describe, expect, it } from "vitest";
import { buildPrimaryNav, isNavPathResolvable, PRIMARY_CATEGORIES } from "./primaryNav";

const nav = buildPrimaryNav({ riderAndroid: "https://example.com/ride-android", riderIos: "https://example.com/ride-ios", driverAndroid: "https://example.com/drive-android", driverIos: "https://example.com/drive-ios" });

describe("public navigation", () => {
  it("merges business and charter, separates delivery from logistics and removes marketplace tab", () => {
    expect(nav.map(({ label }) => label)).toEqual([...PRIMARY_CATEGORIES]);
    expect(PRIMARY_CATEGORIES).toContain("Business & Charter");
    expect(PRIMARY_CATEGORIES).toContain("Delivery");
    expect(PRIMARY_CATEGORIES).toContain("Logistics");
    expect(PRIMARY_CATEGORIES).not.toContain("Marketplace");
    expect(nav.find(({ label }) => label === "Business & Charter")?.groups?.flatMap(({ items }) => items).map(({ to }) => to)).toContain("/charter/search");
  });

  it("preserves categorized discovery and resolvable service destinations", () => {
    for (const family of ["ride", "charter", "rental", "logistics"]) {
      expect(nav.some(({ groups }) => groups?.some(({ items }) => items.some(({ to }) => to === `/marketplace?family=${family}`)))).toBe(true);
    }
    for (const { groups } of nav) for (const { items } of groups ?? []) for (const item of items) {
      if (!item.external) expect(isNavPathResolvable(item.to), item.to).toBe(true);
    }
  });
});