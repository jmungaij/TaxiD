import { describe, expect, it } from "vitest";
import { canOpenStaffPath, requiredScopeForPath } from "./routeScopes";
import { scopesForRoles } from "./access";

describe("staff route governance", () => {
  it("restricts the staff admin portal to people-sensitive roles", () => {
    expect(requiredScopeForPath("/staff/admin")).toBe("people_sensitive");
    expect(canOpenStaffPath("/staff/admin", scopesForRoles(["operations_manager"]))).toBe(false);
    expect(canOpenStaffPath("/staff/admin", scopesForRoles(["admin"]))).toBe(true);
    expect(canOpenStaffPath("/staff/admin", scopesForRoles(["super_admin"]))).toBe(true);
  });

  it("keeps ordinary personal workspace routes available to resolved staff", () => {
    expect(requiredScopeForPath("/staff/workspace")).toBe("self");
    expect(canOpenStaffPath("/staff/workspace", scopesForRoles(["operations_manager"]))).toBe(true);
  });
});