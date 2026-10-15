import "server-only";

import { z } from "zod";

import type { Session } from "@/features/auth/types";
import type { CreatedOrder, OrderItemSnapshot } from "@/features/orders/types";
import type { FulfillmentType } from "@/features/menu/types";
import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const orderIdSchema = z.uuid();
const tableNumberSchema = z.int().min(1).max(12);
const menuItemIdSchema = z.uuid();
const menuItemVariantIdSchema = z.uuid().nullable();
const orderItemIdSchema = z.uuid();
const idempotencyKeySchema = z.uuid();
const knownCartItemSchema = z.object({ menuItemId: menuItemIdSchema, menuItemVariantId: menuItemVariantIdSchema, quantity: z.int().min(1).max(1000) });
const unknownCartItemSchema = z.object({ menuItemId: z.null(), menuItemVariantId: z.null(), quantity: z.literal(1), adHocAmountTyiyn: z.int().min(1).max(100_000_000) });
const localCartItemsSchema = z.array(z.union([knownCartItemSchema, unknownCartItemSchema])).min(1).max(200);
const kitchenCartItemsSchema = z.array(knownCartItemSchema).min(1).max(200);

export type ActiveOrderItem = OrderItemSnapshot & { id: string; menuItemVariantId: string | null; sentQuantity: number; addedAt: string; fulfillmentType: FulfillmentType };
export type ActiveOrder = {
  id: string;
  orderNumber: number;
  tableNumber: number | null;
  totalTyiyn: number;
  cashierName: string;
  createdAt: string;
  items: ActiveOrderItem[];
  hasKitchenTicket: boolean;
};
export type ActiveOrderSummary = Pick<ActiveOrder, "id" | "orderNumber" | "tableNumber" | "totalTyiyn" | "cashierName" | "createdAt">;

type OrderRow = { id: string; order_number: number; table_number: number | null; total_tyiyn: number; cashier_name: string; created_at: string };
type ItemRow = { id: string; menu_item_id: string | null; menu_item_variant_id: string | null; item_name: string; unit_price_tyiyn: number; quantity: number; sent_quantity: number; line_total_tyiyn: number; added_at: string; fulfillment_type: FulfillmentType };
type PrintJobRow = { id: string; type: "customer" | "kitchen"; status: "pending" | "submitted" | "failed"; attempts: number; last_error: string | null };

export async function listActiveOrders(): Promise<ActiveOrderSummary[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("orders")
    .select("id, order_number, table_number, total_tyiyn, cashier_name, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as OrderRow[]).map(toSummary);
}

/**
 * A POS session needs the complete active-order snapshot, not a summary per
 * row followed by an additional request every time the cashier changes tabs.
 */
export async function listActiveOrderDetails(): Promise<ActiveOrder[]> {
  const supabase = createSupabaseAdminClient();
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, order_number, table_number, total_tyiyn, cashier_name, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (ordersError) throw ordersError;
  const orderRows = (orders ?? []) as OrderRow[];
  if (orderRows.length === 0) return [];
  const orderIds = orderRows.map((order) => order.id);
  const [itemsResult, ticketsResult] = await Promise.all([
    supabase.from("order_items").select("order_id, id, menu_item_id, menu_item_variant_id, item_name, unit_price_tyiyn, quantity, sent_quantity, line_total_tyiyn, added_at, fulfillment_type").in("order_id", orderIds).order("added_at", { ascending: false }),
    supabase.from("kitchen_tickets").select("order_id").in("order_id", orderIds),
  ]);
  if (itemsResult.error || ticketsResult.error)
    throw itemsResult.error ?? ticketsResult.error;
  const itemsByOrder = new Map<string, ActiveOrderItem[]>();
  for (const item of (itemsResult.data ?? []) as Array<ItemRow & { order_id: string }>) {
    const orderId = item.order_id;
    itemsByOrder.set(orderId, [...(itemsByOrder.get(orderId) ?? []), toActiveItem(item)]);
  }
  const ticketOrderIds = new Set((ticketsResult.data ?? []).map((ticket) => ticket.order_id));
  return orderRows.map((order) => ({
    ...toSummary(order),
    items: itemsByOrder.get(order.id) ?? [],
    hasKitchenTicket: ticketOrderIds.has(order.id),
  }));
}

export async function getActiveOrder(id: string): Promise<ActiveOrder> {
  if (!orderIdSchema.safeParse(id).success) throw invalidRequest();
  const supabase = createSupabaseAdminClient();
  const [orderResult, itemsResult, ticketResult] = await Promise.all([
    supabase.from("orders").select("id, order_number, table_number, total_tyiyn, cashier_name, created_at").eq("id", id).eq("status", "open").maybeSingle(),
    supabase.from("order_items").select("id, menu_item_id, menu_item_variant_id, item_name, unit_price_tyiyn, quantity, sent_quantity, line_total_tyiyn, added_at, fulfillment_type").eq("order_id", id).order("added_at", { ascending: false }),
    supabase.from("kitchen_tickets").select("id").eq("order_id", id).limit(1),
  ]);
  if (orderResult.error || itemsResult.error || ticketResult.error) throw orderResult.error ?? itemsResult.error ?? ticketResult.error;
  const order = orderResult.data as OrderRow | null;
  if (!order) throw new ApiError("INVALID_REQUEST", 404, "Активный заказ не найден.");
  return {
    ...toSummary(order),
    items: ((itemsResult.data ?? []) as ItemRow[]).map(toActiveItem),
    hasKitchenTicket: (ticketResult.data ?? []).length > 0,
  };
}

export async function openActiveOrder(input: unknown, session: Session): Promise<ActiveOrder> {
  const parsed = z.object({ idempotencyKey: idempotencyKeySchema, tableNumber: tableNumberSchema.nullish() }).safeParse(input);
  if (!parsed.success) throw invalidRequest();
  const { data, error } = await createSupabaseAdminClient().rpc("open_cafeline_table_order", {
    p_idempotency_key: parsed.data.idempotencyKey,
    p_cashier_name: session.cashierName,
    p_table_number: parsed.data.tableNumber ?? null,
  });
  if (error) throw mapRpcError(error, "Этот стол уже занят.");
  const row = (data as Array<{ order_id: string }> | null)?.[0];
  if (!row) throw new ApiError("INTERNAL_ERROR", 500, "Не удалось открыть заказ.");
  // A brand-new order cannot have lines yet. Avoid a second, unnecessary
  // order-items query so the cashier can start adding dishes immediately.
  const { data: order, error: orderError } = await createSupabaseAdminClient()
    .from("orders")
    .select("id, order_number, table_number, total_tyiyn, cashier_name, created_at")
    .eq("id", row.order_id)
    .eq("status", "open")
    .single();
  if (orderError || !order) throw orderError ?? new ApiError("INTERNAL_ERROR", 500, "Не удалось открыть заказ.");
  return { ...toSummary(order as OrderRow), items: [], hasKitchenTicket: false };
}

export async function moveActiveOrder(id: string, input: unknown): Promise<ActiveOrder> {
  if (!orderIdSchema.safeParse(id).success) throw invalidRequest();
  const parsed = z.object({ tableNumber: tableNumberSchema }).safeParse(input);
  if (!parsed.success) throw invalidRequest();
  const { error } = await createSupabaseAdminClient().rpc("move_cafeline_table_order", { p_order_id: id, p_table_number: parsed.data.tableNumber });
  if (error) throw mapRpcError(error, "Этот стол уже занят.");
  return getActiveOrder(id);
}

export async function changeActiveOrderItem(id: string, input: unknown): Promise<ActiveOrder> {
  if (!orderIdSchema.safeParse(id).success) throw invalidRequest();
  const parsed = z.object({ menuItemId: menuItemIdSchema, menuItemVariantId: menuItemVariantIdSchema.default(null), delta: z.int().min(-1000).max(1000).refine((value) => value !== 0) }).safeParse(input);
  if (!parsed.success) throw invalidRequest();
  const { error } = await createSupabaseAdminClient().rpc("change_cafeline_open_order_item", { p_order_id: id, p_menu_item_id: parsed.data.menuItemId, p_menu_item_variant_id: parsed.data.menuItemVariantId, p_delta: parsed.data.delta });
  if (error) throw mapRpcError(error, "Не удалось изменить блюдо в заказе.");
  return getActiveOrder(id);
}

export async function deleteEmptyActiveOrder(id: string): Promise<void> {
  if (!orderIdSchema.safeParse(id).success) throw invalidRequest();
  const supabase = createSupabaseAdminClient();
  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("id")
    .eq("order_id", id)
    .limit(1);
  if (itemsError) throw itemsError;
  if ((items ?? []).length > 0) {
    throw new ApiError("INVALID_REQUEST", 409, "Нельзя удалить заказ с блюдами.");
  }

  const { data, error } = await supabase
    .from("orders")
    .delete()
    .eq("id", id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("INVALID_REQUEST", 404, "Пустой активный заказ не найден.");
}

export async function cancelActiveOrderItem(id: string, input: unknown): Promise<void> {
  if (!orderIdSchema.safeParse(id).success) throw invalidRequest();
  const parsed = z.object({ orderItemId: orderItemIdSchema }).safeParse(input);
  if (!parsed.success) throw invalidRequest();
  const { error } = await createSupabaseAdminClient().rpc("cancel_cafeline_open_order_item", {
    p_order_id: id,
    p_order_item_id: parsed.data.orderItemId,
  });
  if (error) throw mapRpcError(error, "Не удалось удалить блюдо из заказа.");
}

export async function sendActiveOrderToKitchen(id: string, input: unknown): Promise<CreatedOrder> {
  if (!orderIdSchema.safeParse(id).success) throw invalidRequest();
  const parsed = z.object({ idempotencyKey: idempotencyKeySchema }).safeParse(input);
  if (!parsed.success) throw invalidRequest();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("send_cafeline_order_to_kitchen", { p_order_id: id, p_idempotency_key: parsed.data.idempotencyKey });
  if (error) throw mapRpcError(error, "Не удалось отправить блюда на кухню.");
  const result = (data as Array<{ ticket_id: string; print_job_id: string }> | null)?.[0];
  if (!result) throw new ApiError("INTERNAL_ERROR", 500, "Сервер не создал кухонную заявку.");
  const [orderResult, itemsResult, jobResult] = await Promise.all([
    supabase.from("orders").select("id, order_number, table_number, total_tyiyn, cashier_name, created_at").eq("id", id).single(),
    supabase.from("kitchen_ticket_items").select("menu_item_id, item_name, unit_price_tyiyn, quantity, line_total_tyiyn").eq("ticket_id", result.ticket_id).order("id", { ascending: true }),
    supabase.from("print_jobs").select("id, type, status, attempts, last_error").eq("id", result.print_job_id).single(),
  ]);
  if (orderResult.error || itemsResult.error || jobResult.error || !orderResult.data || !jobResult.data) throw new ApiError("INTERNAL_ERROR", 500, "Кухонная заявка сохранена, но не удалось подготовить печать.");
  return toPrintable(orderResult.data as OrderRow, (itemsResult.data ?? []) as ItemRow[], [jobResult.data as PrintJobRow]);
}

export async function sendActiveOrderItemToKitchen(id: string, input: unknown): Promise<CreatedOrder> {
  if (!orderIdSchema.safeParse(id).success) throw invalidRequest();
  const parsed = z.object({ orderItemId: orderItemIdSchema, idempotencyKey: idempotencyKeySchema }).safeParse(input);
  if (!parsed.success) throw invalidRequest();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("send_cafeline_order_item_to_kitchen", { p_order_id: id, p_order_item_id: parsed.data.orderItemId, p_idempotency_key: parsed.data.idempotencyKey });
  if (error) throw mapRpcError(error, "Не удалось отправить блюдо на кухню.");
  const result = (data as Array<{ ticket_id: string; print_job_id: string }> | null)?.[0];
  if (!result) throw new ApiError("INTERNAL_ERROR", 500, "Сервер не создал кухонную заявку.");
  const [orderResult, itemsResult, jobResult] = await Promise.all([
    supabase.from("orders").select("id, order_number, table_number, total_tyiyn, cashier_name, created_at").eq("id", id).single(),
    supabase.from("kitchen_ticket_items").select("menu_item_id, item_name, unit_price_tyiyn, quantity, line_total_tyiyn").eq("ticket_id", result.ticket_id).order("id", { ascending: true }),
    supabase.from("print_jobs").select("id, type, status, attempts, last_error").eq("id", result.print_job_id).single(),
  ]);
  if (orderResult.error || itemsResult.error || jobResult.error || !orderResult.data || !jobResult.data) throw new ApiError("INTERNAL_ERROR", 500, "Блюдо сохранено, но не удалось подготовить печать.");
  return toPrintable(orderResult.data as OrderRow, (itemsResult.data ?? []) as ItemRow[], [jobResult.data as PrintJobRow]);
}

export async function completeActiveOrder(id: string): Promise<CreatedOrder> {
  if (!orderIdSchema.safeParse(id).success) throw invalidRequest();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("complete_cafeline_table_order", { p_order_id: id });
  if (error) throw mapRpcError(error, "Не удалось завершить заказ.");
  const result = (data as Array<{ print_job_id: string }> | null)?.[0];
  if (!result) throw new ApiError("INTERNAL_ERROR", 500, "Сервер не создал клиентский чек.");
  const [orderResult, itemsResult, jobResult] = await Promise.all([
    supabase.from("orders").select("id, order_number, table_number, total_tyiyn, cashier_name, created_at").eq("id", id).single(),
    supabase.from("order_items").select("menu_item_id, item_name, unit_price_tyiyn, quantity, line_total_tyiyn").eq("order_id", id).order("id", { ascending: true }),
    supabase.from("print_jobs").select("id, type, status, attempts, last_error").eq("id", result.print_job_id).single(),
  ]);
  if (orderResult.error || itemsResult.error || jobResult.error || !orderResult.data || !jobResult.data) throw new ApiError("INTERNAL_ERROR", 500, "Заказ завершён, но не удалось подготовить чек.");
  return toPrintable(orderResult.data as OrderRow, (itemsResult.data ?? []) as ItemRow[], [jobResult.data as PrintJobRow]);
}

export async function completeLocalCart(id: string, input: unknown): Promise<CreatedOrder> {
  if (!orderIdSchema.safeParse(id).success) throw invalidRequest();
  const parsed = z.object({ items: localCartItemsSchema, customerReceiptPrinted: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) throw invalidRequest();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("complete_cafeline_local_cart", {
    p_order_id: id,
    p_items: parsed.data.items.map((item) => ({ menu_item_id: item.menuItemId, menu_item_variant_id: item.menuItemVariantId, quantity: item.quantity, ad_hoc_amount_tyiyn: "adHocAmountTyiyn" in item ? item.adHocAmountTyiyn : null })),
  });
  if (error) throw mapRpcError(error, "Не удалось сохранить корзину.");
  const result = (data as Array<{ print_job_id: string }> | null)?.[0];
  if (!result) throw new ApiError("INTERNAL_ERROR", 500, "Сервер не создал клиентский чек.");
  if (parsed.data.customerReceiptPrinted) {
    const { error: printError } = await supabase.rpc("report_cafeline_print_job", {
      p_job_id: result.print_job_id,
      p_status: "submitted",
      p_last_error: null,
    });
    if (printError) throw new ApiError("INTERNAL_ERROR", 500, "Заказ сохранён, но не удалось подтвердить локальную печать.");
  }
  const [orderResult, itemsResult, jobResult] = await Promise.all([
    supabase.from("orders").select("id, order_number, table_number, total_tyiyn, cashier_name, created_at").eq("id", id).single(),
    supabase.from("order_items").select("menu_item_id, item_name, unit_price_tyiyn, quantity, line_total_tyiyn").eq("order_id", id).order("id", { ascending: true }),
    supabase.from("print_jobs").select("id, type, status, attempts, last_error").eq("id", result.print_job_id).single(),
  ]);
  if (orderResult.error || itemsResult.error || jobResult.error || !orderResult.data || !jobResult.data) throw new ApiError("INTERNAL_ERROR", 500, "Корзина сохранена, но не удалось подготовить чек.");
  return toPrintable(orderResult.data as OrderRow, (itemsResult.data ?? []) as ItemRow[], [jobResult.data as PrintJobRow]);
}

export async function printLocalCartToKitchen(id: string, input: unknown): Promise<CreatedOrder> {
  if (!orderIdSchema.safeParse(id).success) throw invalidRequest();
  const parsed = z.object({ items: kitchenCartItemsSchema, idempotencyKey: idempotencyKeySchema }).safeParse(input);
  if (!parsed.success) throw invalidRequest();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("print_cafeline_local_cart_to_kitchen", {
    p_order_id: id,
    p_items: parsed.data.items.map((item) => ({ menu_item_id: item.menuItemId, menu_item_variant_id: item.menuItemVariantId, quantity: item.quantity })),
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) throw mapRpcError(error, "Не удалось передать блюда на кухню.");
  const result = (data as Array<{ ticket_id: string; print_job_id: string }> | null)?.[0];
  if (!result) throw new ApiError("INTERNAL_ERROR", 500, "Сервер не создал кухонную заявку.");
  const [orderResult, itemsResult, jobResult] = await Promise.all([
    supabase.from("orders").select("id, order_number, table_number, total_tyiyn, cashier_name, created_at").eq("id", id).single(),
    supabase.from("kitchen_ticket_items").select("menu_item_id, item_name, unit_price_tyiyn, quantity, line_total_tyiyn").eq("ticket_id", result.ticket_id).order("id", { ascending: true }),
    supabase.from("print_jobs").select("id, type, status, attempts, last_error").eq("id", result.print_job_id).single(),
  ]);
  if (orderResult.error || itemsResult.error || jobResult.error || !orderResult.data || !jobResult.data) throw new ApiError("INTERNAL_ERROR", 500, "Кухонная заявка сохранена, но не удалось подготовить печать.");
  return toPrintable(orderResult.data as OrderRow, (itemsResult.data ?? []) as ItemRow[], [jobResult.data as PrintJobRow]);
}

function toSummary(row: OrderRow): ActiveOrderSummary {
  return { id: row.id, orderNumber: row.order_number, tableNumber: row.table_number, totalTyiyn: row.total_tyiyn, cashierName: row.cashier_name, createdAt: row.created_at };
}
function toActiveItem(row: ItemRow): ActiveOrderItem {
  return { id: row.id, menuItemId: row.menu_item_id, menuItemVariantId: row.menu_item_variant_id, itemName: row.item_name, unitPriceTyiyn: row.unit_price_tyiyn, quantity: row.quantity, sentQuantity: row.sent_quantity, lineTotalTyiyn: row.line_total_tyiyn, addedAt: row.added_at, fulfillmentType: row.fulfillment_type };
}
function toPrintable(order: OrderRow, items: ItemRow[], jobs: PrintJobRow[]): CreatedOrder {
  return { id: order.id, orderNumber: order.order_number, tableNumber: order.table_number, totalTyiyn: order.total_tyiyn, cashierName: order.cashier_name, createdAt: order.created_at, items: items.map((item) => ({ menuItemId: item.menu_item_id, itemName: item.item_name, unitPriceTyiyn: item.unit_price_tyiyn, quantity: item.quantity, lineTotalTyiyn: item.line_total_tyiyn })), printJobs: jobs.map((job) => ({ id: job.id, type: job.type, status: job.status, attempts: job.attempts, lastError: job.last_error })), created: true };
}
function invalidRequest() { return new ApiError("INVALID_REQUEST", 400, "Переданы некорректные данные заказа."); }
function mapRpcError(error: { code?: string }, fallback: string): ApiError | { code?: string } {
  if (error.code === "22023") return new ApiError("INVALID_REQUEST", 400, fallback);
  if (error.code === "P0002") return new ApiError("INVALID_REQUEST", 404, "Активный заказ не найден.");
  if (error.code === "23505") return new ApiError("INVALID_REQUEST", 409, "Этот стол уже занят.");
  return error;
}
