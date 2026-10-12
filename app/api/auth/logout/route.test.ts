import { describe, expect, it } from "vitest";

import { SESSION_COOKIE_NAME } from "@/features/auth/constants";
import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { loggedOut: true } });
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
