import "server-only";

import { z } from "zod";

import type { AdminCategory, AdminMenuData, AdminMenuItem } from "@/features/admin-menu/types";
import type { FulfillmentType } from "@/features/menu/types";
import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  sortOrder: z.int().min(0).max(1_000_000),
  isActive: z.boolean(),
  fulfillmentType: z.enum(["kitchen", "counter", "beverage"]),
});

const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(150),
  categoryId: z.uuid(),
  priceTyiyn: z.int().min(0).max(2_147_483_647),
  sortOrder: z.int().min(0).max(1_000_000),
  isActive: z.boolean(),
});

type CategoryRow = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  fulfillment_type: FulfillmentType;
};

type MenuItemRow = {
  id: string;
  category_id: string;
  name: string;
  price_tyiyn: number;
  sort_order: number;
  is_active: boolean;
};

export async function getAdminMenuData(): Promise<AdminMenuData> {
  const supabase = createSupabaseAdminClient();
  const [categoriesResult, itemsResult] = await Promise.all([
    supabase.from("categories").select("id, name, sort_order, is_active, fulfillment_type").order("sort_order").order("name"),
    supabase
      .from("menu_items")
      .select("id, category_id, name, price_tyiyn, sort_order, is_active")
      .order("sort_order")
      .order("name"),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (itemsResult.error) throw itemsResult.error;

  return {
    categories: ((categoriesResult.data ?? []) as CategoryRow[]).map(toCategory),
    items: ((itemsResult.data ?? []) as MenuItemRow[]).map(toMenuItem),
  };
}

export async function createCategory(input: unknown): Promise<AdminCategory> {
  const value = parseCategory(input);
  const { data, error } = await createSupabaseAdminClient()
    .from("categories")
    .insert({ name: value.name, sort_order: value.sortOrder, is_active: value.isActive, fulfillment_type: value.fulfillmentType })
    .select("id, name, sort_order, is_active, fulfillment_type")
    .single();

  if (error) throw toDatabaseError(error, "Не удалось создать категорию.");
  return toCategory(data as CategoryRow);
}

export async function updateCategory(id: string, input: unknown): Promise<AdminCategory> {
  assertUuid(id);
  const value = parseCategory(input);
  const { data, error } = await createSupabaseAdminClient()
    .from("categories")
    .update({ name: value.name, sort_order: value.sortOrder, is_active: value.isActive, fulfillment_type: value.fulfillmentType })
    .eq("id", id)
    .select("id, name, sort_order, is_active, fulfillment_type")
    .single();

  if (error) throw toDatabaseError(error, "Не удалось обновить категорию.");
  return toCategory(data as CategoryRow);
}

export async function createMenuItem(input: unknown): Promise<AdminMenuItem> {
  const value = parseMenuItem(input);
  const { data, error } = await createSupabaseAdminClient()
    .from("menu_items")
    .insert({
      category_id: value.categoryId,
      name: value.name,
      price_tyiyn: value.priceTyiyn,
      sort_order: value.sortOrder,
      is_active: value.isActive,
    })
    .select("id, category_id, name, price_tyiyn, sort_order, is_active")
    .single();

  if (error) throw toDatabaseError(error, "Не удалось создать блюдо.");
  return toMenuItem(data as MenuItemRow);
}

export async function updateMenuItem(id: string, input: unknown): Promise<AdminMenuItem> {
  assertUuid(id);
  const value = parseMenuItem(input);
  const { data, error } = await createSupabaseAdminClient()
    .from("menu_items")
    .update({
      category_id: value.categoryId,
      name: value.name,
      price_tyiyn: value.priceTyiyn,
      sort_order: value.sortOrder,
      is_active: value.isActive,
    })
    .eq("id", id)
    .select("id, category_id, name, price_tyiyn, sort_order, is_active")
    .single();

  if (error) throw toDatabaseError(error, "Не удалось обновить блюдо.");
  return toMenuItem(data as MenuItemRow);
}

function parseCategory(input: unknown) {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) throw new ApiError("INVALID_REQUEST", 400, "Некорректные данные категории.");
  return parsed.data;
}

function parseMenuItem(input: unknown) {
  const parsed = menuItemSchema.safeParse(input);
  if (!parsed.success) throw new ApiError("INVALID_REQUEST", 400, "Некорректные данные блюда.");
  return parsed.data;
}

function assertUuid(id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError("INVALID_REQUEST", 400, "Некорректный идентификатор.");
  }
}

function toDatabaseError(error: { code?: string }, fallbackMessage: string): ApiError | { code?: string } {
  if (error.code === "23505") return new ApiError("INVALID_REQUEST", 409, "Такое название уже существует.");
  if (error.code === "23503") return new ApiError("INVALID_REQUEST", 400, "Указанная категория не существует.");
  if (error.code === "PGRST116") return new ApiError("INVALID_REQUEST", 404, "Запись не найдена.");
  console.error(fallbackMessage, error);
  return error;
}

function toCategory(row: CategoryRow): AdminCategory {
  return { id: row.id, name: row.name, sortOrder: row.sort_order, isActive: row.is_active, fulfillmentType: row.fulfillment_type };
}

function toMenuItem(row: MenuItemRow): AdminMenuItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    priceTyiyn: row.price_tyiyn,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}
