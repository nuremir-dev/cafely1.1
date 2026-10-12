import { describe, expect, it } from "vitest";

import { resolveRoleForPin } from "./pin";

const env = { CAFE_CASHIER_PIN: "1234", CAFE_ADMIN_PIN: "5678" };

describe("resolveRoleForPin", () => {
  it("maps the cashier PIN to the cashier role", () => {
    expect(resolveRoleForPin("1234", env)).toBe("cashier");
  });

  it("maps the administrator PIN to the admin role", () => {
    expect(resolveRoleForPin("5678", env)).toBe("admin");
  });

  it("does not authenticate an unknown or malformed PIN", () => {
    expect(resolveRoleForPin("0000", env)).toBeNull();
    expect(resolveRoleForPin("12345", env)).toBeNull();
  });
});
