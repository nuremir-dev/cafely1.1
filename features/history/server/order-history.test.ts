import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

import { getOrderDetails, getOrderHistory } from "./order-history";

type Result = { data: unknown; error: unknown };
const firstId = "037dce47-d7f4-4f4f-8705-9f6d83be5526";
const secondId = "d4f4a724-1a54-421b-86fc-c1d1baf7ae59";
const createdAt = "2026-10-12T10:00:00.000Z";

function listQuery(result: Result) {
  const query = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn(), or: vi.fn(),
    then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.or.mockReturnValue(query);
  return query;
}

function singleQuery(result: Result) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe("order history service", () => {
  beforeEach(() => mocks.createSupabaseAdminClient.mockReset());

  it("returns newest orders first, sold-unit totals, and an opaque next cursor", async () => {
    const ordersQuery = listQuery({
      data: [
        { id: firstId, order_number: 12, total_tyiyn: 54_000, cashier_name: "Кассир 1", created_at: createdAt },
        { id: secondId, order_number: 11, total_tyiyn: 4_000, cashier_name: "Кассир 1", created_at: "2026-10-12T09:00:00.000Z" },
      ],
      error: null,
    });
    const itemsQuery = listQuery({ data: [{ order_id: firstId, quantity: 2 }, { order_id: firstId, quantity: 1 }], error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ from: vi.fn().mockReturnValueOnce(ordersQuery).mockReturnValueOnce(itemsQuery) });

    const result = await getOrderHistory(new URLSearchParams({ limit: "1" }));

    expect(result.orders).toEqual([{ id: firstId, orderNumber: 12, totalTyiyn: 54_000, cashierName: "Кассир 1", createdAt, itemCount: 3 }]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(ordersQuery.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(itemsQuery.in).toHaveBeenCalledWith("order_id", [firstId]);
  });

  it("validates cursor pagination and applies the seek condition", async () => {
    const ordersQuery = listQuery({ data: [], error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(ordersQuery) });
    const cursor = Buffer.from(JSON.stringify({ createdAt, id: firstId })).toString("base64url");

    await expect(getOrderHistory(new URLSearchParams({ cursor }))).resolves.toEqual({ orders: [], nextCursor: null });
    expect(ordersQuery.or).toHaveBeenCalledWith(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${firstId})`);
  });

  it("returns saved item names, prices, and print status for a selected order", async () => {
    const orderQuery = singleQuery({
      data: { id: firstId, order_number: 12, total_tyiyn: 54_000, cashier_name: "Кассир 1", created_at: createdAt },
      error: null,
    });
    const itemsQuery = listQuery({
      data: [{ order_id: firstId, menu_item_id: secondId, item_name: "Исторический лагман", unit_price_tyiyn: 25_000, quantity: 2, line_total_tyiyn: 50_000 }],
      error: null,
    });
    const jobsQuery = listQuery({
      data: [{ id: secondId, type: "kitchen", status: "failed", attempts: 2, last_error: "Принтер недоступен" }],
      error: null,
    });
    mocks.createSupabaseAdminClient.mockReturnValue({ from: vi.fn().mockReturnValueOnce(orderQuery).mockReturnValueOnce(itemsQuery).mockReturnValueOnce(jobsQuery) });

    await expect(getOrderDetails(firstId)).resolves.toEqual({
      id: firstId, orderNumber: 12, totalTyiyn: 54_000, cashierName: "Кассир 1", createdAt,
      items: [{ menuItemId: secondId, itemName: "Исторический лагман", unitPriceTyiyn: 25_000, quantity: 2, lineTotalTyiyn: 50_000 }],
      printJobs: [{ id: secondId, type: "kitchen", status: "failed", attempts: 2, lastError: "Принтер недоступен" }],
    });
  });

  it("rejects invalid cursors and order identifiers before database access", async () => {
    await expect(getOrderHistory(new URLSearchParams({ cursor: "bad" }))).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
    await expect(getOrderDetails("bad")).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
