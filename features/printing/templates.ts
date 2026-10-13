import type { CreatedOrder } from "@/features/orders/types";

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
const som = (tyiyn: number) => `${(tyiyn / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} сом`;
const time = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const shell = (body: string) => `<!doctype html><html><meta charset="utf-8"><style>html{width:80mm;margin:0;padding:0}body{box-sizing:border-box;width:80mm;margin:0;padding:0 4mm;font-family:Arial,sans-serif;font-size:11px}h1{text-align:center;font-size:16px}hr{border:0;border-top:1px dashed #000}table{width:100%;border-collapse:collapse}td:last-child{text-align:right}.big{font-size:18px;font-weight:bold}.center{text-align:center}</style><body>${body}</body></html>`;

export function customerReceipt(order: CreatedOrder): string {
  return shell(`<h1>MANGO</h1><p class="center">Заказ №${order.orderNumber}<br>${time(order.createdAt)}</p><hr><table>${order.items.map((item) => `<tr><td>${escapeHtml(item.itemName)}<br><small>${item.quantity} × ${som(item.unitPriceTyiyn)}</small></td><td>${som(item.lineTotalTyiyn)}</td></tr>`).join("")}</table><hr><p class="big">ИТОГО: ${som(order.totalTyiyn)}</p><p class="center">Спасибо за заказ!</p>`);
}

export function kitchenReceipt(order: CreatedOrder): string {
  const location = order.tableNumber ? `СТОЛ ${order.tableNumber}` : "НОВЫЙ ЗАКАЗ";
  return shell(`<h1>КУХНЯ</h1><p class="center big">${location}</p><p class="center">ЗАКАЗ №${order.orderNumber}<br>${time(order.createdAt)}</p><hr>${order.items.map((item) => `<p class="big">${item.quantity} × ${escapeHtml(item.itemName).toUpperCase()}</p>`).join("")}<hr>`);
}
