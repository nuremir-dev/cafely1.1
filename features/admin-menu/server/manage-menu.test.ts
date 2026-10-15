import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

import {
  createCategory,
  createMenuItem,
  getAdminMenuData,
  updateCategory,
  updateMenuItem,
} from "./manage-menu";

type Result = { data: unknown; error: unknown };
const categoryId = "99db4df3-3346-4b12-b4e4-b5b70d455f5e";
const itemId = "faaac3a7-7e78-4e18-b870-bf5e5a001d45";
const categoryInput = { name: "Напитки", sortOrder: 2, isActive: true, fulfillmentType: "beverage" as const };
const itemInput = { name: "Чай", categoryId, priceTyiyn: 4_000, sortOrder: 3, isActive: true, variants: [{ name: "Стандарт", priceTyiyn: 4_000, sortOrder: 0, isActive: true }] };

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

function mutationQuery(result: Result) {
  const query = {
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
  };
  query.insert.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe("menu administration service", () => {
  beforeEach(() => mocks.createSupabaseAdminClient.mockReset());

  it("loads every category and item, including logically disabled records", async () => {
    const categoryQuery = listQuery({
      data: [{ id: categoryId, name: "Напитки", sort_order: 2, is_active: false, fulfillment_type: "beverage" }],
      error: null,
    });
    const itemQuery = listQuery({
      data: [{ id: itemId, category_id: categoryId, name: "Чай", price_tyiyn: 4_000, sort_order: 3, is_active: false }],
      error: null,
    });
    const variantsQuery = listQuery({ data: [], error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValueOnce(categoryQuery).mockReturnValueOnce(itemQuery).mockReturnValueOnce(variantsQuery),
    });

    await expect(getAdminMenuData()).resolves.toEqual({
      categories: [{ id: categoryId, name: "Напитки", sortOrder: 2, isActive: false, fulfillmentType: "beverage" }],
      items: [{ id: itemId, categoryId, name: "Чай", priceTyiyn: 4_000, sortOrder: 3, isActive: false, isQuick: false, requiresServiceLocation: false, variants: [] }],
    });
  });

  it("creates a category after validating its fields", async () => {
    const query = mutationQuery({
      data: { id: categoryId, name: "Напитки", sort_order: 2, is_active: true, fulfillment_type: "beverage" },
      error: null,
    });
    mocks.createSupabaseAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(query) });

    await expect(createCategory(categoryInput)).resolves.toEqual({
      id: categoryId, name: "Напитки", sortOrder: 2, isActive: true, fulfillmentType: "beverage",
    });
    expect(query.insert).toHaveBeenCalledWith({ name: "Напитки", sort_order: 2, is_active: true, fulfillment_type: "beverage" });
  });

  it("updates a category instead of physically deleting it", async () => {
    const query = mutationQuery({
      data: { id: categoryId, name: "Напитки", sort_order: 2, is_active: false, fulfillment_type: "beverage" },
      error: null,
    });
    mocks.createSupabaseAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(query) });

    await expect(updateCategory(categoryId, { ...categoryInput, isActive: false })).resolves.toMatchObject({ isActive: false });
    expect(query.update).toHaveBeenCalledWith({ name: "Напитки", sort_order: 2, is_active: false, fulfillment_type: "beverage" });
    expect(query.eq).toHaveBeenCalledWith("id", categoryId);
  });

  it("creates and updates menu items with integer tyiyn prices", async () => {
    const createdQuery = mutationQuery({
      data: { id: itemId, category_id: categoryId, name: "Чай", price_tyiyn: 4_000, sort_order: 3, is_active: true },
      error: null,
    });
    const updatedQuery = mutationQuery({
      data: { id: itemId, category_id: categoryId, name: "Чай", price_tyiyn: 4_500, sort_order: 3, is_active: false, requires_service_location: true },
      error: null,
    });
    const variantsQuery = listQuery({ data: [], error: null });
    const client = {
      from: vi.fn()
        .mockReturnValueOnce(createdQuery)
        .mockReturnValueOnce(updatedQuery)
        .mockReturnValueOnce(updatedQuery)
        .mockReturnValueOnce(variantsQuery),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    };
    mocks.createSupabaseAdminClient.mockReturnValue(client);

    await expect(createMenuItem(itemInput)).resolves.toMatchObject({ priceTyiyn: 4_000, isActive: true });
    await expect(updateMenuItem(itemId, { ...itemInput, priceTyiyn: 4_500, isActive: false, requiresServiceLocation: true })).resolves.toMatchObject({ priceTyiyn: 4_500, isActive: false, requiresServiceLocation: true });
    expect(createdQuery.insert).toHaveBeenCalledWith({ category_id: categoryId, name: "Чай", price_tyiyn: 4_000, sort_order: 3, is_active: true, is_quick: false, requires_service_location: false });
    expect(updatedQuery.update).toHaveBeenCalledWith({ category_id: categoryId, name: "Чай", price_tyiyn: 4_500, sort_order: 3, is_active: false, is_quick: false, requires_service_location: true });
  });

  it("rejects malformed values before database access", async () => {
    await expect(createMenuItem({ ...itemInput, priceTyiyn: 4.5 })).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
    await expect(updateCategory("invalid", categoryInput)).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("converts database constraint failures into actionable errors", async () => {
    const query = mutationQuery({ data: null, error: { code: "23503" } });
    mocks.createSupabaseAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(query) });

    await expect(createMenuItem(itemInput)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 400,
      message: "Указанная категория не существует.",
    });
  });
});
