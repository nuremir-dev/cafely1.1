import "server-only";

import { z } from "zod";

import type { HistoryOrder, HistoryPage, OrderDetails } from "@/features/history/types";
import type { OrderItemSnapshot, PrintJob } from "@/features/orders/types";
import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

type OrderRow = {
  id: string;
  order_number: number;
  total_tyiyn: number;
  cashier_name: string;
  created_at: string;
};
type OrderItemRow = {
  order_id: string;
  menu_item_id: string;
  item_name: string;
  unit_price_tyiyn: number;
  quantity: number;
  line_total_tyiyn: number;
};
type PrintJobRow = {
  id: string;
  type: "customer" | "kitchen";
  status: "pending" | "submitted" | "failed";
  attempts: number;
  last_error: string | null;
};

export async function getOrderHistory(searchParams: URLSearchParams): Promise<HistoryPage> {
  const limit = parseLimit(searchParams.get("limit"));
  const cursor = parseCursor(searchParams.get("cursor"));
  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("orders")
    .select("id, order_number, total_tyiyn, cashier_name, created_at")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as OrderRow[];
  const pageRows = rows.slice(0, limit);
  const orderIds = pageRows.map((row) => row.id);
  const { data: itemRows, error: itemsError } = orderIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("order_items").select("order_id, quantity").in("order_id", orderIds);
  if (itemsError) throw itemsError;

  const quantitiesByOrderId = new Map<string, number>();
  for (const item of (itemRows ?? []) as Array<{ order_id: string; quantity: number }>) {
    quantitiesByOrderId.set(item.order_id, (quantitiesByOrderId.get(item.order_id) ?? 0) + item.quantity);
  }

  return {
    orders: pageRows.map((row) => toHistoryOrder(row, quantitiesByOrderId.get(row.id) ?? 0)),
    nextCursor: rows.length > limit ? encodeCursor(pageRows.at(-1)!) : null,
  };
}

export async function getOrderDetails(id: string): Promise<OrderDetails> {
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError("INVALID_REQUEST", 400, "Некорректный идентификатор заказа.");
  }

  const supabase = createSupabaseAdminClient();
  const [orderResult, itemsResult, jobsResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, total_tyiyn, cashier_name, created_at")
      .eq("id", id)
      .eq("status", "completed")
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("order_id, menu_item_id, item_name, unit_price_tyiyn, quantity, line_total_tyiyn")
      .eq("order_id", id)
      .order("id", { ascending: true }),
    supabase
      .from("print_jobs")
      .select("id, type, status, attempts, last_error")
      .eq("order_id", id)
      .order("type", { ascending: true }),
  ]);

  if (orderResult.error || itemsResult.error || jobsResult.error) {
    throw orderResult.error ?? itemsResult.error ?? jobsResult.error;
  }
  if (!orderResult.data) {
    throw new ApiError("INVALID_REQUEST", 404, "Заказ не найден.");
  }

  const order = orderResult.data as OrderRow;
  return {
    id: order.id,
    orderNumber: order.order_number,
    totalTyiyn: order.total_tyiyn,
    cashierName: order.cashier_name,
    createdAt: order.created_at,
    items: ((itemsResult.data ?? []) as OrderItemRow[]).map(toOrderItem),
    printJobs: ((jobsResult.data ?? []) as PrintJobRow[]).map(toPrintJob),
  };
}

function parseLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) throw new ApiError("INVALID_REQUEST", 400, "Некорректный размер страницы.");
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ApiError("INVALID_REQUEST", 400, "Некорректный размер страницы.");
  }
  return limit;
}

function parseCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const cursor = cursorSchema.safeParse(parsed);
    if (cursor.success) return cursor.data;
  } catch {
    // Converted below to the same public validation error.
  }
  throw new ApiError("INVALID_REQUEST", 400, "Некорректный курсор страницы.");
}

function encodeCursor(row: OrderRow): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id })).toString("base64url");
}

function toHistoryOrder(row: OrderRow, itemCount: number): HistoryOrder {
  return { id: row.id, orderNumber: row.order_number, totalTyiyn: row.total_tyiyn, cashierName: row.cashier_name, createdAt: row.created_at, itemCount };
}

function toOrderItem(row: OrderItemRow): OrderItemSnapshot {
  return { menuItemId: row.menu_item_id, itemName: row.item_name, unitPriceTyiyn: row.unit_price_tyiyn, quantity: row.quantity, lineTotalTyiyn: row.line_total_tyiyn };
}

function toPrintJob(row: PrintJobRow): PrintJob {
  return { id: row.id, type: row.type, status: row.status, attempts: row.attempts, lastError: row.last_error };
}
