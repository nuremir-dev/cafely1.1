import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  createOrder: vi.fn(),
}));

vi.mock("@/features/auth/guards", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/features/orders/server/create-order", () => ({ createOrder: mocks.createOrder }));

import { POST } from "./route";

const session = { role: "cashier" as const, cashierName: "Кассир 1" };
const order = {
  id: "order-1",
  orderNumber: 42,
  totalTyiyn: 50_000,
  cashierName: "Кассир 1",
  createdAt: "2026-10-12T10:00:00.000Z",
  items: [],
  printJobs: [],
  created: true,
};

describe("POST /api/orders", () => {
  beforeEach(() => {
    mocks.requireApiSession.mockReset();
    mocks.createOrder.mockReset();
    mocks.requireApiSession.mockResolvedValue(session);
  });

  it("returns 201 and the saved historical order", async () => {
    mocks.createOrder.mockResolvedValue(order);
    const request = new Request("http://localhost/api/orders", {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: "key", items: [] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: order });
    expect(mocks.createOrder).toHaveBeenCalledWith({ idempotencyKey: "key", items: [] }, session);
  });

  it("returns 200 when the same idempotency key already represents a saved order", async () => {
    mocks.createOrder.mockResolvedValue({ ...order, created: false });
    const request = new Request("http://localhost/api/orders", {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: "key", items: [] }),
    });

    expect((await POST(request)).status).toBe(200);
  });

  it("returns a safe 400 response for malformed JSON", async () => {
    const request = new Request("http://localhost/api/orders", { method: "POST", body: "{" });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_REQUEST", message: "Переданы некорректные данные заказа." },
    });
  });
});
