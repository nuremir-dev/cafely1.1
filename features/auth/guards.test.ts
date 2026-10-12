import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("./session", () => ({ getSession: mocks.getSession }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { requireAdminApiSession, requireAdminPage, requireApiSession, requirePageSession } from "./guards";

describe("session guards", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.redirect.mockReset();
  });

  it("returns a session to protected API code", async () => {
    const session = { role: "cashier" as const, cashierName: "Кассир 1" };
    mocks.getSession.mockResolvedValue(session);

    await expect(requireApiSession()).resolves.toEqual(session);
  });

  it("rejects a request with no server session", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(requireApiSession()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("redirects an anonymous page visitor to login", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(requirePageSession()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects a cashier away from the admin screen", async () => {
    mocks.getSession.mockResolvedValue({ role: "cashier", cashierName: "Кассир 1" });
    mocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/pos");
  });

  it("allows only an administrator through the admin API guard", async () => {
    mocks.getSession.mockResolvedValue({ role: "admin", cashierName: "Администратор" });
    await expect(requireAdminApiSession()).resolves.toMatchObject({ role: "admin" });

    mocks.getSession.mockResolvedValue({ role: "cashier", cashierName: "Кассир 1" });
    await expect(requireAdminApiSession()).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});
