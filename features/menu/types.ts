export type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  priceTyiyn: number;
  isQuick: boolean;
  requiresServiceLocation: boolean;
  fulfillmentType: FulfillmentType;
  variants: MenuItemVariant[];
};

export type MenuItemVariant = {
  id: string;
  name: string;
  priceTyiyn: number;
};

export type FulfillmentType = "kitchen" | "counter" | "beverage";

export type MenuCategory = {
  id: string;
  name: string;
  fulfillmentType: FulfillmentType;
  items: MenuItem[];
};

export type MenuCatalog = {
  categories: MenuCategory[];
};
