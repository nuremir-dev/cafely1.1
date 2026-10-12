export type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  priceTyiyn: number;
};

export type MenuCategory = {
  id: string;
  name: string;
  items: MenuItem[];
};

export type MenuCatalog = {
  categories: MenuCategory[];
};
