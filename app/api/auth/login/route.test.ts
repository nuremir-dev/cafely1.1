import { afterEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE_NAME } from "@/features/auth/constants";
import { verifySessionToken } from "@/features/auth/session";
import { POST } from "./route";

const originalEnv = { ...process.env };

function setTestEnvironment() {
  process.env = {
    ...originalEnv,
    CAFE_CASHIER_PIN: "1234",
    CAFE_ADMIN_PIN: "5678",
    CAFE_SESSION_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
    SUPABASE_URL: "https://cafeline-test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
  };
}

function loginRequest(pin: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "test-terminal" },
    body: JSON.stringify({ pin }),
  });
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("POST /api/auth/login", () => {
  it("rejects a malformed PIN without issuing a session", async () => {
    setTestEnvironment();
    const response = await POST(loginRequest("12a4"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_REQUEST", message: "PIN должен состоять из 4 цифр." },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an incorrect PIN", async () => {
    setTestEnvironment();
    const response = await POST(loginRequest("0000"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_PIN", message: "Неверный PIN-код." },
    });
  });

  it("creates an HttpOnly signed session for a valid PIN", async () => {
    setTestEnvironment();
    const response = await POST(loginRequest("1234"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { role: "cashier" } });

    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const token = cookie?.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))?.[1];
    await expect(verifySessionToken(token ?? "")).resolves.toEqual({
      role: "cashier",
      cashierName: "Кассир 1",
    });
  });
});
