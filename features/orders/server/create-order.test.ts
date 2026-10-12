import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

import { createOrder } from "./create-order";

type Result = { data: unknown; error: unknown };

function listQuery(result: Result) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return query;
}

function singleQuery(result: Result) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

const input = {
  idempotencyKey: "3a0684e9-40f3-4c81-bf82-15f77090b3fe",
  items: [{ menuItemId: "40b9f593-2a7f-49a4-b5ed-19d7f9d0d3be", quantity: 2 }],
};
const session = { role: "cashier" as const, cashierName: "Кассир 1" };

describe("createOrder", () => {
  beforeEach(() => mocks.createSupabaseAdminClient.mockReset());

  it("creates through the atomic RPC and returns the historical order snapshot", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ order_id: "order-1", order_number: 42, total_tyiyn: 50_000, created: true }],
      error: null,
    });
    mocks.createSupabaseAdminClient.mockReturnValue({
      rpc,
      from: vi.fn()
        .mockReturnValueOnce(singleQuery({
          data: { id: "order-1", order_number: 42, total_tyiyn: 50_000, cashier_name: "Кассир 1", created_at: "2026-10-12T10:00:00.000Z" },
          error: null,
        }))
        .mockReturnValueOnce(listQuery({
          data: [{ menu_item_id: input.items[0]?.menuItemId, item_name: "Лагман", unit_price_tyiyn: 25_000, quantity: 2, line_total_tyiyn: 50_000 }],
          error: null,
        }))
        .mockReturnValueOnce(listQuery({
          data: [
            { id: "customer-job", type: "customer", status: "pending", attempts: 0, last_error: null },
            { id: "kitchen-job", type: "kitchen", status: "pending", attempts: 0, last_error: null },
          ],
          error: null,
        })),
    });

    await expect(createOrder(input, session)).resolves.toEqual({
      id: "order-1",
      orderNumber: 42,
      totalTyiyn: 50_000,
      cashierName: "Кассир 1",
      createdAt: "2026-10-12T10:00:00.000Z",
      items: [{ menuItemId: input.items[0]?.menuItemId, itemName: "Лагман", unitPriceTyiyn: 25_000, quantity: 2, lineTotalTyiyn: 50_000 }],
      printJobs: [
        { id: "customer-job", type: "customer", status: "pending", attempts: 0, lastError: null },
        { id: "kitchen-job", type: "kitchen", status: "pending", attempts: 0, lastError: null },
      ],
      created: true,
    });
    expect(rpc).toHaveBeenCalledWith("create_cafeline_order", {
      p_idempotency_key: input.idempotencyKey,
      p_cashier_name: "Кассир 1",
      p_items: [{ menu_item_id: input.items[0]?.menuItemId, quantity: 2 }],
    });
  });

  it("returns an existing order snapshot when SQL marks the key as already used", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ order_id: "order-1", order_number: 42, total_tyiyn: 50_000, created: false }],
      error: null,
    });
    mocks.createSupabaseAdminClient.mockReturnValue({
      rpc,
      from: vi.fn()
        .mockReturnValueOnce(singleQuery({
          data: { id: "order-1", order_number: 42, total_tyiyn: 50_000, cashier_name: "Кассир 1", created_at: "2026-10-12T10:00:00.000Z" },
          error: null,
        }))
        .mockReturnValueOnce(listQuery({ data: [], error: null }))
        .mockReturnValueOnce(listQuery({ data: [], error: null })),
    });

    await expect(createOrder(input, session)).resolves.toMatchObject({
      id: "order-1",
      orderNumber: 42,
      created: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed client data before accessing Supabase", async () => {
    await expect(createOrder({ idempotencyKey: "not-a-uuid", items: [] }, session)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 400,
    });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("turns an unavailable menu item into a safe client error", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "22023" } }),
    });

    await expect(createOrder(input, session)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 400,
    });
  });
});
