import type { FulfillmentType } from "@/features/menu/types";

export type AdminCategory = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  fulfillmentType: FulfillmentType;
};

export type AdminMenuItem = {
  id: string;
  categoryId: string;
  name: string;
  priceTyiyn: number;
  sortOrder: number;
  isActive: boolean;
  isQuick: boolean;
  variants: AdminMenuItemVariant[];
};

export type AdminMenuItemVariant = {
  id: string;
  name: string;
  priceTyiyn: number;
  sortOrder: number;
  isActive: boolean;
};

export type AdminMenuData = {
  categories: AdminCategory[];
  items: AdminMenuItem[];
};
