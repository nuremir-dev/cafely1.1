import type { CartItem, CartMenuItem } from "./types";

export function addItem(items: CartItem[], item: CartMenuItem): CartItem[] {
  const existingItem = items.find((cartItem) => cartItem.menuItemId === item.id);
  if (!existingItem) {
    return [...items, { menuItemId: item.id, name: item.name, priceTyiyn: item.priceTyiyn, quantity: 1 }];
  }

  return items.map((cartItem) =>
    cartItem.menuItemId === item.id
      ? { ...cartItem, quantity: cartItem.quantity + 1 }
      : cartItem,
  );
}

export function increaseItem(items: CartItem[], menuItemId: string): CartItem[] {
  return items.map((item) =>
    item.menuItemId === menuItemId ? { ...item, quantity: item.quantity + 1 } : item,
  );
}

export function decreaseItem(items: CartItem[], menuItemId: string): CartItem[] {
  return items.map((item) =>
    item.menuItemId === menuItemId ? { ...item, quantity: Math.max(1, item.quantity - 1) } : item,
  );
}

export function removeItem(items: CartItem[], menuItemId: string): CartItem[] {
  return items.filter((item) => item.menuItemId !== menuItemId);
}

export function clearCart(): CartItem[] {
  return [];
}

export function getCartTotalTyiyn(items: CartItem[]): number {
  return items.reduce((total, item) => total + item.priceTyiyn * item.quantity, 0);
}

export function formatSom(tyiyn: number): string {
  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: tyiyn % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(tyiyn / 100)} сом`;
}
