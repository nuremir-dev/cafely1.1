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
  isQuick: z.boolean().default(false),
  requiresServiceLocation: z.boolean().default(false),
  variants: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    priceTyiyn: z.int().min(0).max(2_147_483_647),
    sortOrder: z.int().min(0).max(1_000_000),
    isActive: z.boolean(),
  })).min(1),
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
  is_quick: boolean;
  requires_service_location: boolean;
};
type VariantRow = { id: string; menu_item_id: string; name: string; price_tyiyn: number; sort_order: number; is_active: boolean };

export async function getAdminMenuData(): Promise<AdminMenuData> {
  const supabase = createSupabaseAdminClient();
  const [categoriesResult, itemsResult, variantsResult] = await Promise.all([
    supabase.from("categories").select("id, name, sort_order, is_active, fulfillment_type").order("sort_order").order("name"),
    supabase
      .from("menu_items")
      .select("id, category_id, name, price_tyiyn, sort_order, is_active, is_quick, requires_service_location")
      .order("sort_order")
      .order("name"),
    createSupabaseAdminClient().from("menu_item_variants").select("id, menu_item_id, name, price_tyiyn, sort_order, is_active").order("sort_order").order("name"),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (variantsResult.error) throw variantsResult.error;

  const variantsByItem = new Map<string, VariantRow[]>();
  for (const variant of (variantsResult.data ?? []) as VariantRow[]) {
    const values = variantsByItem.get(variant.menu_item_id) ?? [];
    values.push(variant);
    variantsByItem.set(variant.menu_item_id, values);
  }

  return {
    categories: ((categoriesResult.data ?? []) as CategoryRow[]).map(toCategory),
    items: ((itemsResult.data ?? []) as MenuItemRow[]).map((item) => toMenuItem(item, variantsByItem.get(item.id) ?? [])),
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
      is_quick: value.isQuick,
      requires_service_location: value.requiresServiceLocation,
    })
    .select("id, category_id, name, price_tyiyn, sort_order, is_active, is_quick, requires_service_location")
    .single();

  if (error) throw toDatabaseError(error, "Не удалось создать блюдо.");
  await replaceVariants((data as MenuItemRow).id, value.variants);
  return { ...toMenuItem(data as MenuItemRow), variants: value.variants.map((variant, index) => ({ id: `new-${index}`, ...variant })) };
}

export async function updateMenuItem(id: string, input: unknown): Promise<AdminMenuItem> {
  assertUuid(id);
  const value = parseMenuItem(input);
  const { error } = await createSupabaseAdminClient()
    .from("menu_items")
    .update({
      category_id: value.categoryId,
      name: value.name,
      price_tyiyn: value.priceTyiyn,
      sort_order: value.sortOrder,
      is_active: value.isActive,
      is_quick: value.isQuick,
      requires_service_location: value.requiresServiceLocation,
    })
    .eq("id", id)
    .select("id, category_id, name, price_tyiyn, sort_order, is_active, is_quick, requires_service_location")
    .single();

  if (error) throw toDatabaseError(error, "Не удалось обновить блюдо.");
  await replaceVariants(id, value.variants);
  return getMenuItem(id);
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

async function replaceVariants(menuItemId: string, variants: Array<{ name: string; priceTyiyn: number; sortOrder: number; isActive: boolean }>) {
  const { error } = await createSupabaseAdminClient().rpc("replace_cafeline_menu_item_variants", {
    p_menu_item_id: menuItemId,
    p_variants: variants.map((variant) => ({ name: variant.name, price_tyiyn: variant.priceTyiyn, sort_order: variant.sortOrder, is_active: variant.isActive })),
  });
  if (error) throw toDatabaseError(error, "Не удалось сохранить характеристики блюда.");
}

async function getMenuItem(id: string): Promise<AdminMenuItem> {
  const supabase = createSupabaseAdminClient();
  const [itemResult, variantsResult] = await Promise.all([
    supabase.from("menu_items").select("id, category_id, name, price_tyiyn, sort_order, is_active, is_quick, requires_service_location").eq("id", id).single(),
    supabase.from("menu_item_variants").select("id, menu_item_id, name, price_tyiyn, sort_order, is_active").eq("menu_item_id", id).order("sort_order").order("name"),
  ]);
  if (itemResult.error || variantsResult.error || !itemResult.data) throw itemResult.error ?? variantsResult.error ?? new Error("Блюдо не найдено.");
  return toMenuItem(itemResult.data as MenuItemRow, (variantsResult.data ?? []) as VariantRow[]);
}

function toMenuItem(row: MenuItemRow, variants: VariantRow[] = []): AdminMenuItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    priceTyiyn: row.price_tyiyn,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isQuick: Boolean(row.is_quick),
    requiresServiceLocation: Boolean(row.requires_service_location),
    variants: variants.map((variant) => ({ id: variant.id, name: variant.name, priceTyiyn: variant.price_tyiyn, sortOrder: variant.sort_order, isActive: variant.is_active })),
  };
}
