export type AdminCategory = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type AdminMenuItem = {
  id: string;
  categoryId: string;
  name: string;
  priceTyiyn: number;
  sortOrder: number;
  isActive: boolean;
};

export type AdminMenuData = {
  categories: AdminCategory[];
  items: AdminMenuItem[];
};
