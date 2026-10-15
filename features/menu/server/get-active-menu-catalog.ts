import "server-only";

import type { FulfillmentType, MenuCatalog } from "@/features/menu/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type CategoryRow = { id: string; name: string; fulfillment_type: FulfillmentType };
type MenuItemRow = {
  id: string;
  category_id: string;
  name: string;
  price_tyiyn: number;
  is_quick: boolean;
  requires_service_location: boolean;
};
type VariantRow = { id: string; menu_item_id: string; name: string; price_tyiyn: number };

export async function getActiveMenuCatalog(): Promise<MenuCatalog> {
  const supabase = createSupabaseAdminClient();
  const [categoriesResult, itemsResult, variantsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, fulfillment_type")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("menu_items")
      .select("id, category_id, name, price_tyiyn, is_quick, requires_service_location")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    createSupabaseAdminClient()
      .from("menu_item_variants")
      .select("id, menu_item_id, name, price_tyiyn")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (variantsResult.error) throw variantsResult.error;

  const itemsByCategory = new Map<string, MenuItemRow[]>();
  for (const item of (itemsResult.data ?? []) as MenuItemRow[]) {
    const categoryItems = itemsByCategory.get(item.category_id) ?? [];
    categoryItems.push(item);
    itemsByCategory.set(item.category_id, categoryItems);
  }

  const variantsByItem = new Map<string, VariantRow[]>();
  for (const variant of (variantsResult.data ?? []) as VariantRow[]) {
    const itemVariants = variantsByItem.get(variant.menu_item_id) ?? [];
    itemVariants.push(variant);
    variantsByItem.set(variant.menu_item_id, itemVariants);
  }

  return {
    categories: ((categoriesResult.data ?? []) as CategoryRow[]).map((category) => ({
      id: category.id,
      name: category.name,
      fulfillmentType: category.fulfillment_type,
      items: (itemsByCategory.get(category.id) ?? []).map((item) => ({
        id: item.id,
        categoryId: item.category_id,
        name: item.name,
        priceTyiyn: item.price_tyiyn,
        isQuick: Boolean(item.is_quick),
        requiresServiceLocation: Boolean(item.requires_service_location),
        fulfillmentType: category.fulfillment_type,
        variants: (variantsByItem.get(item.id) ?? []).map((variant) => ({ id: variant.id, name: variant.name, priceTyiyn: variant.price_tyiyn })),
      })),
    })),
  };
}
