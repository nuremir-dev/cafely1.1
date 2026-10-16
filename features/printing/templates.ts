import type { CreatedOrder } from "@/features/orders/types";

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
const kitchenItemName = (value: string) => value.replace(/\s*·\s*(?:Зал|На вынос)\s*$/iu, "");
const som = (tyiyn: number) => `${(tyiyn / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} сом`;
const time = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const kitchenDate = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", dateStyle: "short" }).format(new Date(value));
const kitchenTime = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", timeStyle: "short" }).format(new Date(value));
const shell = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:80mm auto;margin:0}html,body{width:80mm;min-width:80mm;height:auto;margin:0;padding:0}body{box-sizing:border-box;padding:0 4mm;font-family:Arial,sans-serif;font-size:11px;overflow-wrap:anywhere}h1{text-align:center;font-size:16px}hr{border:0;border-top:1px dashed #000}table{width:100%;border-collapse:collapse;table-layout:fixed}td{vertical-align:top;padding:1px 0}td:first-child{width:72%;padding-right:2mm}td:last-child{width:28%;text-align:right;white-space:nowrap}.big{font-size:18px;font-weight:bold}.center{text-align:center}.kitchen-title{margin:0;text-align:center;font-size:18px;font-weight:900;letter-spacing:.5px}.kitchen-cancellation{border:2px solid #000;padding:2mm 0;letter-spacing:1px}.kitchen-location{margin:2mm 0 1mm;text-align:center;font-size:22px;font-weight:900}.kitchen-order{margin:0;text-align:center;font-size:13px;font-weight:700}.kitchen-datetime{margin:1mm 0 2mm;text-align:center;font-size:12px}.kitchen-item{padding:2.5mm 0;border-bottom:1px dashed #000}.kitchen-item-name{font-size:17px;font-weight:900;line-height:1.16;text-transform:uppercase}.kitchen-comment{margin-top:1mm;font-size:12px;line-height:1.25;font-style:italic}.kitchen-item-meta{display:flex;justify-content:space-between;gap:4mm;margin-top:1.5mm;font-size:14px;font-weight:800}.kitchen-quantity{font-size:20px;line-height:1}</style></head><body>${body}</body></html>`;

export function customerReceipt(order: CreatedOrder): string {
  const title = order.orderNumber > 0 ? `Заказ №${order.orderNumber}` : "Новый заказ";
  return shell(`<h1>MANGO</h1><p class="center">${title}<br>${time(order.createdAt)}</p><hr><table>${order.items.map((item) => `<tr><td>${escapeHtml(kitchenItemName(item.itemName))}<br><small>${item.quantity} × ${som(item.unitPriceTyiyn)}</small></td><td>${som(item.lineTotalTyiyn)}</td></tr>`).join("")}</table><hr><p class="big">ИТОГО: ${som(order.totalTyiyn)}</p><p class="center">Спасибо за заказ!</p><p class="center">Было вкусно? Оставьте комментарий<br>@mango.karakol ❤</p>`);
}

/**
 * Customer receipts include a table plus a multi-line footer.  QZ's HTML
 * renderer needs an explicit roll length for some thermal drivers; estimating
 * it from every wrapped item prevents both blank fixed feed and clipping.
 */
export function customerReceiptHeightMm(order: CreatedOrder): number {
  const itemsHeight = order.items.reduce((sum, item) => {
    const nameLines = Math.max(1, Math.ceil(item.itemName.length / 24));
    return sum + nameLines * 5 + 6;
  }, 0);
  return Math.max(74, 48 + itemsHeight);
}

export function kitchenReceipt(order: CreatedOrder, options?: { cancellation?: boolean }): string {
  const location = order.tableNumber ? `СТОЛ ${order.tableNumber}` : `ЗАКАЗ №${order.orderNumber}`;
  const title = options?.cancellation ? "ОТМЕНА" : "КУХНЯ";
  const serviceLocation = order.serviceLocation ?? order.items.find((item) => item.serviceLocation)?.serviceLocation ?? "hall";
  const place = serviceLocation === "takeaway" ? "НА ВЫНОС" : "ЗАЛ";
  return shell(`<p class="kitchen-title${options?.cancellation ? " kitchen-cancellation" : ""}">${title}</p><p class="kitchen-location">${place}</p>${serviceLocation === "hall" && order.tableNumber ? `<p class="kitchen-order">${location}</p>` : ""}<p class="kitchen-order">ЗАКАЗ №${order.orderNumber}</p><p class="kitchen-datetime">${kitchenDate(order.createdAt)} · ${kitchenTime(order.createdAt)}</p><hr>${order.items.map((item) => `<section class="kitchen-item"><div class="kitchen-item-name">${escapeHtml(kitchenItemName(item.itemName))}</div>${item.kitchenComment ? `<div class="kitchen-comment">${escapeHtml(item.kitchenComment)}</div>` : ""}<div class="kitchen-item-meta"><strong class="kitchen-quantity">${item.quantity} ×</strong></div></section>`).join("")}`);
}

/**
 * The Java HTML renderer behind QZ cannot reliably infer an endless roll's
 * height for every thermal driver.  A generous content-based length prevents
 * drivers from reversing, scaling, or clipping long kitchen tickets.
 */
export function kitchenReceiptHeightMm(order: CreatedOrder): number {
  const itemsHeight = order.items.reduce((sum, item) => {
    const lines = Math.max(1, Math.ceil(item.itemName.length / 22));
    return sum + lines * 6 + 11;
  }, 0);
  return Math.max(76, Math.min(600, 53 + itemsHeight));
}
