import { describe, expect, it } from "vitest";

import type { CreatedOrder } from "@/features/orders/types";

import { customerReceiptHeightMm, kitchenReceipt, kitchenReceiptHeightMm } from "./templates";

const order = (items: number): CreatedOrder => ({
  id: "order",
  orderNumber: 7,
  tableNumber: 3,
  totalTyiyn: items * 10_000,
  cashierName: "Кассир",
  createdAt: "2026-10-15T10:00:00.000Z",
  items: Array.from({ length: items }, (_, index) => ({
    menuItemId: `item-${index}`,
    itemName: "Блюдо с длинным названием для кухонного чека",
    unitPriceTyiyn: 10_000,
    quantity: 1,
    lineTotalTyiyn: 10_000,
  })),
  printJobs: [],
  created: false,
});

describe("kitchenReceiptHeightMm", () => {
  it("grows the paper length for long kitchen tickets", () => {
    expect(kitchenReceiptHeightMm(order(8))).toBeGreaterThan(kitchenReceiptHeightMm(order(2)));
  });

  it("marks an item cancellation clearly for the kitchen", () => {
    expect(kitchenReceipt(order(1), { cancellation: true })).toContain("ОТМЕНА");
  });

  it("prints table, order details, quantity, and service location for the kitchen", () => {
    const ticket = kitchenReceipt({
      ...order(1),
      items: [{
        menuItemId: "lagman",
        itemName: "Лагман · Большой",
        unitPriceTyiyn: 25_000,
        quantity: 2,
        lineTotalTyiyn: 50_000,
        serviceLocation: "takeaway",
      }],
    });

    expect(ticket).toContain("СТОЛ 3");
    expect(ticket).toContain("ЗАКАЗ №7");
    expect(ticket).toContain("15.10.2026 · 16:00");
    expect(ticket).toContain("Лагман · Большой");
    expect(ticket).toContain("2 ×");
    expect(ticket).toContain("НА ВЫНОС");
  });

  it("uses the order number as the headline when no table is assigned", () => {
    expect(kitchenReceipt({ ...order(1), tableNumber: null })).toContain('class="kitchen-location">ЗАКАЗ №7');
  });
});

describe("customerReceiptHeightMm", () => {
  it("grows the paper length for long customer receipts", () => {
    expect(customerReceiptHeightMm(order(8))).toBeGreaterThan(customerReceiptHeightMm(order(2)));
  });
});
