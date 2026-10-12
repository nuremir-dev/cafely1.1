import { afterEach, describe, expect, it } from "vitest";

import { createSupabaseAdminClient } from "./admin";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("createSupabaseAdminClient", () => {
  it("uses only server environment variables", () => {
    process.env = {
      ...process.env,
      CAFE_CASHIER_PIN: "1234",
      CAFE_ADMIN_PIN: "5678",
      CAFE_SESSION_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
      SUPABASE_URL: "https://cafeline-test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
    };

    const client = createSupabaseAdminClient();
    expect(client).toBeDefined();
  });
});
