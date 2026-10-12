import "server-only";

import type { MenuCatalog } from "@/features/menu/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type CategoryRow = { id: string; name: string };
type MenuItemRow = {
  id: string;
  category_id: string;
  name: string;
  price_tyiyn: number;
};

export async function getActiveMenuCatalog(): Promise<MenuCatalog> {
  const supabase = createSupabaseAdminClient();
  const [categoriesResult, itemsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("menu_items")
      .select("id, category_id, name, price_tyiyn")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (itemsResult.error) throw itemsResult.error;

  const itemsByCategory = new Map<string, MenuItemRow[]>();
  for (const item of (itemsResult.data ?? []) as MenuItemRow[]) {
    const categoryItems = itemsByCategory.get(item.category_id) ?? [];
    categoryItems.push(item);
    itemsByCategory.set(item.category_id, categoryItems);
  }

  return {
    categories: ((categoriesResult.data ?? []) as CategoryRow[]).map((category) => ({
      id: category.id,
      name: category.name,
      items: (itemsByCategory.get(category.id) ?? []).map((item) => ({
        id: item.id,
        categoryId: item.category_id,
        name: item.name,
        priceTyiyn: item.price_tyiyn,
      })),
    })),
  };
}
