export type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  priceTyiyn: number;
  fulfillmentType: FulfillmentType;
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
