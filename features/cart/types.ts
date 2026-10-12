export type CartItem = {
  menuItemId: string;
  name: string;
  priceTyiyn: number;
  quantity: number;
};

export type CartMenuItem = Omit<CartItem, "menuItemId" | "quantity"> & { id: string };
