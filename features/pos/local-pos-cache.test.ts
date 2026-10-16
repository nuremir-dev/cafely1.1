import { describe, expect, it } from "vitest";

import {
  calculateCartTotal,
  findReusableEmptyOrder,
  type CachedPosOrder,
} from "./local-pos-cache";

function order(overrides: Partial<CachedPosOrder> = {}): CachedPosOrder {
  return {
    id: "order-1",
    orderNumber: 1,
    tableNumber: null,
    serviceLocation: "hall",
    totalTyiyn: 0,
    cashierName: "Кассир",
    createdAt: "2026-10-16T09:00:00.000Z",
    items: [],
    hasKitchenTicket: false,
    syncState: "synced",
    ...overrides,
  };
}

describe("findReusableEmptyOrder", () => {
  it("returns the oldest editable empty order", () => {
    const oldest = order({ id: "oldest", createdAt: "2026-10-16T08:00:00.000Z" });
    const newest = order({ id: "newest", createdAt: "2026-10-16T10:00:00.000Z" });

    expect(findReusableEmptyOrder([newest, oldest])).toBe(oldest);
  });

  it("does not reuse completed, printed, pending, or non-empty orders", () => {
    const editable = order({ id: "editable" });

    expect(
      findReusableEmptyOrder([
        order({ id: "completed", completedAt: "2026-10-16T09:30:00.000Z" }),
        order({ id: "printed", customerReceiptPrintedAt: "2026-10-16T09:30:00.000Z" }),
        order({ id: "pending", pendingCompletion: true }),
        order({
          id: "with-item",
          items: [{
            id: "line-1",
            menuItemId: "menu-item-1",
            menuItemVariantId: null,
            itemName: "Блюдо",
            unitPriceTyiyn: 10000,
            quantity: 1,
            sentQuantity: 0,
            lineTotalTyiyn: 10000,
            addedAt: "2026-10-16T09:00:00.000Z",
            preparesInKitchen: false,
          }],
        }),
        editable,
      ]),
    ).toBe(editable);
  });

  it("returns null when no editable empty order exists", () => {
    expect(findReusableEmptyOrder([order({ pendingCompletion: true })])).toBeNull();
  });
});

describe("calculateCartTotal", () => {
  it("derives the total from lines instead of a stale order-level value", () => {
    expect(calculateCartTotal([
      { lineTotalTyiyn: 12_000 },
      { lineTotalTyiyn: 8_500 },
    ])).toBe(20_500);
    expect(calculateCartTotal([])).toBe(0);
  });
});
