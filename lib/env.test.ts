import { describe, expect, it } from "vitest";

import { ConfigurationError, getServerEnv } from "./env";

const validEnv = {
  CAFE_CASHIER_PIN: "1234",
  CAFE_ADMIN_PIN: "5678",
  CAFE_SESSION_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
  SUPABASE_URL: "https://cafeline-test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
};

describe("getServerEnv", () => {
  it("returns validated configuration", () => {
    expect(getServerEnv(validEnv)).toEqual(validEnv);
  });

  it("rejects a PIN that is not four digits", () => {
    expect(() => getServerEnv({ ...validEnv, CAFE_CASHIER_PIN: "12a4" })).toThrow(
      ConfigurationError,
    );
  });

  it("rejects identical cashier and administrator PINs", () => {
    expect(() => getServerEnv({ ...validEnv, CAFE_ADMIN_PIN: "1234" })).toThrow(
      "PIN администратора должен отличаться",
    );
  });
});
