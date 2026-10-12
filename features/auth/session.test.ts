import { afterEach, describe, expect, it } from "vitest";

import { createSessionToken, verifySessionToken } from "./session";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("session tokens", () => {
  it("round-trips a valid signed session", async () => {
    process.env = {
      ...process.env,
      CAFE_CASHIER_PIN: "1234",
      CAFE_ADMIN_PIN: "5678",
      CAFE_SESSION_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
      SUPABASE_URL: "https://cafeline-test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
    };

    const token = await createSessionToken({ role: "cashier", cashierName: "Кассир 1" });
    await expect(verifySessionToken(token)).resolves.toEqual({
      role: "cashier",
      cashierName: "Кассир 1",
    });
  });

  it("rejects a modified token", async () => {
    process.env = {
      ...process.env,
      CAFE_CASHIER_PIN: "1234",
      CAFE_ADMIN_PIN: "5678",
      CAFE_SESSION_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
      SUPABASE_URL: "https://cafeline-test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
    };

    const token = await createSessionToken({ role: "admin", cashierName: "Администратор" });
    await expect(verifySessionToken(`${token}invalid`)).resolves.toBeNull();
  });
});
