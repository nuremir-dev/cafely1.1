import type { CreatedOrder } from "@/features/orders/types";

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
const som = (tyiyn: number) => `${(tyiyn / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} сом`;
const time = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const shell = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:80mm auto;margin:0}html,body{width:80mm;min-width:80mm;height:auto;margin:0;padding:0}body{box-sizing:border-box;padding:0 4mm;font-family:Arial,sans-serif;font-size:11px;overflow-wrap:anywhere}h1{text-align:center;font-size:16px}hr{border:0;border-top:1px dashed #000}table{width:100%;border-collapse:collapse;table-layout:fixed}td{vertical-align:top;padding:1px 0}td:first-child{width:72%;padding-right:2mm}td:last-child{width:28%;text-align:right;white-space:nowrap}.big{font-size:18px;font-weight:bold}.center{text-align:center}</style></head><body>${body}</body></html>`;

export function customerReceipt(order: CreatedOrder): string {
  const title = order.orderNumber > 0 ? `Заказ №${order.orderNumber}` : "Новый заказ";
  return shell(`<h1>MANGO</h1><p class="center">${title}<br>${time(order.createdAt)}</p><hr><table>${order.items.map((item) => `<tr><td>${escapeHtml(item.itemName)}<br><small>${item.quantity} × ${som(item.unitPriceTyiyn)}</small></td><td>${som(item.lineTotalTyiyn)}</td></tr>`).join("")}</table><hr><p class="big">ИТОГО: ${som(order.totalTyiyn)}</p><p class="center">Спасибо за заказ!</p>`);
}

export function kitchenReceipt(order: CreatedOrder): string {
  const location = order.tableNumber ? `СТОЛ ${order.tableNumber}` : "НОВЫЙ ЗАКАЗ";
  return shell(`<h1>КУХНЯ</h1><p class="center big">${location}</p><p class="center">ЗАКАЗ №${order.orderNumber}<br>${time(order.createdAt)}</p><hr>${order.items.map((item) => `<p class="big">${item.quantity} × ${escapeHtml(item.itemName).toUpperCase()}</p>`).join("")}<hr>`);
}

/**
 * The Java HTML renderer behind QZ cannot reliably infer an endless roll's
 * height for every thermal driver.  A generous content-based length prevents
 * drivers from reversing, scaling, or clipping long kitchen tickets.
 */
export function kitchenReceiptHeightMm(order: CreatedOrder): number {
  const itemsHeight = order.items.reduce((sum, item) => {
    const lines = Math.max(1, Math.ceil(item.itemName.length / 19));
    return sum + lines * 7 + 4;
  }, 0);
  return Math.max(62, Math.min(600, 42 + itemsHeight));
}
