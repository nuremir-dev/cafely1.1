import { describe, expect, it } from "vitest";

import {
  addItem,
  clearCart,
  decreaseItem,
  formatSom,
  getCartTotalTyiyn,
  increaseItem,
  removeItem,
} from "./cart";

const lagman = { id: "lagman", name: "Лагман", priceTyiyn: 25_000 };

describe("cart", () => {
  it("adds a menu item and adds quantity for a repeated click", () => {
    const once = addItem([], lagman);
    expect(once).toEqual([{ menuItemId: "lagman", name: "Лагман", priceTyiyn: 25_000, quantity: 1 }]);
    expect(addItem(once, lagman)[0]?.quantity).toBe(2);
  });

  it("changes quantity without ever going below one", () => {
    const cart = addItem([], lagman);
    expect(increaseItem(cart, "lagman")[0]?.quantity).toBe(2);
    expect(decreaseItem(cart, "lagman")[0]?.quantity).toBe(1);
    expect(decreaseItem(cart, "lagman")[0]?.quantity).toBe(1);
  });

  it("removes an item or clears the entire cart", () => {
    const cart = addItem(addItem([], lagman), { id: "tea", name: "Чай", priceTyiyn: 4_000 });
    expect(removeItem(cart, "lagman")).toEqual([{ menuItemId: "tea", name: "Чай", priceTyiyn: 4_000, quantity: 1 }]);
    expect(clearCart()).toEqual([]);
  });

  it("calculates and displays values exclusively from integer tyiyn", () => {
    const cart = addItem(addItem([], lagman), { id: "tea", name: "Чай", priceTyiyn: 4_050 });
    expect(getCartTotalTyiyn(cart)).toBe(29_050);
    expect(formatSom(54_000)).toBe("540 сом");
    expect(formatSom(4_050)).toBe("40,50 сом");
  });
});
