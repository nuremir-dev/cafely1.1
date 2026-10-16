import { describe, expect, it } from "vitest";

import type { CreatedOrder } from "@/features/orders/types";

import { customerReceipt, customerReceiptHeightMm, kitchenReceipt, kitchenReceiptHeightMm } from "./templates";

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

  it("prints one order-level service mode, the table, and a kitchen comment", () => {
    const ticket = kitchenReceipt({
      ...order(1),
      serviceLocation: "hall",
      items: [{
        menuItemId: "lagman",
        itemName: "Лагман · Большой · На вынос",
        unitPriceTyiyn: 25_000,
        quantity: 2,
        lineTotalTyiyn: 50_000,
        serviceLocation: "takeaway",
        kitchenComment: "Без специй",
      }],
    });

    expect(ticket).toContain("СТОЛ 3");
    expect(ticket).toContain("ЗАКАЗ №7");
    expect(ticket).toContain("15.10.2026 · 16:00");
    expect(ticket).toContain("Лагман · Большой");
    expect(ticket).not.toContain("Лагман · Большой · На вынос");
    expect(ticket).toContain('class="kitchen-quantity">2</strong>');
    expect(ticket).not.toContain("2 ×");
    expect(ticket).toContain("ЗАЛ");
    expect(ticket).not.toContain("НА ВЫНОС");
    expect(ticket).toContain(" — Без специй");
  });

  it("shows takeaway once at the top without a table", () => {
    const ticket = kitchenReceipt({ ...order(1), tableNumber: null, serviceLocation: "takeaway" });
    expect(ticket).toContain('class="kitchen-location">НА ВЫНОС');
    expect(ticket).not.toContain("СТОЛ");
  });
});

describe("customerReceiptHeightMm", () => {
  it("grows the paper length for long customer receipts", () => {
    expect(customerReceiptHeightMm(order(8))).toBeGreaterThan(customerReceiptHeightMm(order(2)));
  });

  it("uses the same item title rule as the kitchen receipt and enlarges the footer", () => {
    const receipt = customerReceipt({
      ...order(1),
      items: [{
        menuItemId: "lagman",
        itemName: "Лагман · Большой · На вынос",
        unitPriceTyiyn: 25_000,
        quantity: 1,
        lineTotalTyiyn: 25_000,
      }],
    });

    expect(receipt).toContain("Лагман · Большой");
    expect(receipt).not.toContain("Лагман · Большой · На вынос");
    expect(receipt).toContain("customer-thank-you");
    expect(receipt).toContain("customer-feedback");
    expect(receipt).toContain("font-size:14px");
    expect(receipt).toContain("font-size:12px");
  });
});
