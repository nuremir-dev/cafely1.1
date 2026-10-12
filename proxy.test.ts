import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { SESSION_COOKIE_NAME } from "@/features/auth/constants";
import { proxy } from "./proxy";

describe("proxy", () => {
  it("redirects an unauthenticated request for a protected page to login", () => {
    const response = proxy(new NextRequest("http://localhost/pos"));

    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows a protected request that carries a session cookie", () => {
    const request = new NextRequest("http://localhost/pos", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token` },
    });

    const response = proxy(request);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not redirect a login request based only on an unverified cookie", () => {
    const request = new NextRequest("http://localhost/login", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=invalid` },
    });

    const response = proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });
});
