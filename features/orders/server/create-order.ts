import "server-only";

import { z } from "zod";

import type { Session } from "@/features/auth/types";
import type { CreatedOrder, OrderItemSnapshot, PrintJob } from "@/features/orders/types";
import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const createOrderSchema = z.object({
  idempotencyKey: z.uuid(),
  items: z
    .array(z.object({ menuItemId: z.uuid(), quantity: z.int().positive().max(1_000) }))
    .min(1)
    .max(100),
});

type RpcOrderRow = {
  order_id: string;
  order_number: number;
  total_tyiyn: number;
  created: boolean;
};

type OrderRow = {
  id: string;
  order_number: number;
  total_tyiyn: number;
  cashier_name: string;
  created_at: string;
};

type OrderItemRow = {
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

export async function createOrder(
  input: unknown,
  session: Session,
): Promise<CreatedOrder> {
  const parsedInput = createOrderSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ApiError("INVALID_REQUEST", 400, "Переданы некорректные данные заказа.");
  }

  const supabase = createSupabaseAdminClient();
  const { data: createdRows, error: createError } = await supabase.rpc("create_cafeline_order", {
    p_idempotency_key: parsedInput.data.idempotencyKey,
    p_cashier_name: session.cashierName,
    p_items: parsedInput.data.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity,
    })),
  });

  if (createError) {
    if (createError.code === "22023" || createError.code === "22003") {
      throw new ApiError("INVALID_REQUEST", 400, "Одно или несколько блюд больше недоступны.");
    }
    throw createError;
  }

  const createdRow = (createdRows as RpcOrderRow[] | null)?.[0];
  if (!createdRow) {
    throw new ApiError("INTERNAL_ERROR", 500, "Сервер не вернул созданный заказ.");
  }

  const [orderResult, itemsResult, jobsResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, total_tyiyn, cashier_name, created_at")
      .eq("id", createdRow.order_id)
      .single(),
    supabase
      .from("order_items")
      .select("menu_item_id, item_name, unit_price_tyiyn, quantity, line_total_tyiyn")
      .eq("order_id", createdRow.order_id)
      .order("id", { ascending: true }),
    supabase
      .from("print_jobs")
      .select("id, type, status, attempts, last_error")
      .eq("order_id", createdRow.order_id)
      .order("type", { ascending: true }),
  ]);

  if (orderResult.error || itemsResult.error || jobsResult.error || !orderResult.data) {
    throw new ApiError("INTERNAL_ERROR", 500, "Заказ сохранён, но не удалось получить его данные.");
  }

  const order = orderResult.data as OrderRow;
  return {
    id: order.id,
    orderNumber: order.order_number,
    totalTyiyn: order.total_tyiyn,
    cashierName: order.cashier_name,
    createdAt: order.created_at,
    items: ((itemsResult.data ?? []) as OrderItemRow[]).map(toOrderItemSnapshot),
    printJobs: ((jobsResult.data ?? []) as PrintJobRow[]).map(toPrintJob),
    created: createdRow.created,
  };
}

function toOrderItemSnapshot(row: OrderItemRow): OrderItemSnapshot {
  return {
    menuItemId: row.menu_item_id,
    itemName: row.item_name,
    unitPriceTyiyn: row.unit_price_tyiyn,
    quantity: row.quantity,
    lineTotalTyiyn: row.line_total_tyiyn,
  };
}

function toPrintJob(row: PrintJobRow): PrintJob {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}
