import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

import { getActiveMenuCatalog } from "./get-active-menu-catalog";

type Result = { data: unknown; error: unknown };

function queryReturning(result: Result) {
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

describe("getActiveMenuCatalog", () => {
  beforeEach(() => mocks.createSupabaseAdminClient.mockReset());

  it("groups active item snapshots by active category in database order", async () => {
    const categoriesQuery = queryReturning({
      data: [{ id: "main", name: "Основные", fulfillment_type: "kitchen" }, { id: "drinks", name: "Напитки", fulfillment_type: "beverage" }],
      error: null,
    });
    const itemsQuery = queryReturning({
      data: [
        { id: "lagman", category_id: "main", name: "Лагман", price_tyiyn: 25_000 },
        { id: "orphan", category_id: "hidden", name: "Скрыто", price_tyiyn: 1 },
      ],
      error: null,
    });
    const variantsQuery = queryReturning({
      data: [{ id: "large", menu_item_id: "lagman", name: "Большой", price_tyiyn: 31_000 }],
      error: null,
    });
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValueOnce(categoriesQuery).mockReturnValueOnce(itemsQuery).mockReturnValueOnce(variantsQuery),
    });

    await expect(getActiveMenuCatalog()).resolves.toEqual({
      categories: [
        {
          id: "main",
          name: "Основные",
          fulfillmentType: "kitchen",
          items: [{ id: "lagman", categoryId: "main", name: "Лагман", priceTyiyn: 25_000, isQuick: false, fulfillmentType: "kitchen", variants: [{ id: "large", name: "Большой", priceTyiyn: 31_000 }] }],
        },
        { id: "drinks", name: "Напитки", fulfillmentType: "beverage", items: [] },
      ],
    });
  });

  it("propagates a database error instead of returning a partial catalog", async () => {
    const categoriesQuery = queryReturning({ data: null, error: new Error("categories unavailable") });
    const itemsQuery = queryReturning({ data: [], error: null });
    const variantsQuery = queryReturning({ data: [], error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValueOnce(categoriesQuery).mockReturnValueOnce(itemsQuery).mockReturnValueOnce(variantsQuery),
    });

    await expect(getActiveMenuCatalog()).rejects.toThrow("categories unavailable");
  });
});
