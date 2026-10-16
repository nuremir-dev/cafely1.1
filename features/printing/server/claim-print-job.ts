import "server-only";

import { z } from "zod";

import type { CreatedOrder, OrderItemSnapshot, PrintJob } from "@/features/orders/types";
import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type JobRow = { id: string; type: PrintJob["type"]; attempts: number; kitchen_ticket_id: string | null };
type OrderRow = { id: string; order_number: number; table_number: number | null; service_location: "hall" | "takeaway"; total_tyiyn: number; cashier_name: string; created_at: string };
type ItemRow = { menu_item_id: string; item_name: string; kitchen_comment: string | null; unit_price_tyiyn: number; quantity: number; line_total_tyiyn: number };
type KitchenTicketRow = { service_location: "hall" | "takeaway" };

export async function claimPrintJob(stationId: string): Promise<CreatedOrder | null> {
  if (!z.string().min(8).max(100).safeParse(stationId).success) throw new ApiError("INVALID_REQUEST", 400, "Некорректная печатная станция.");
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("claim_cafeline_print_job", { p_station_id: stationId });
  if (error) throw error;
  const claimed = (data as Array<{ job_id: string }> | null)?.[0];
  if (!claimed) return null;
  const { data: jobData, error: jobError } = await supabase.from("print_jobs").select("id, type, attempts, kitchen_ticket_id, order_id").eq("id", claimed.job_id).single();
  if (jobError || !jobData) throw jobError ?? new Error("Задание печати не найдено.");
  const job = jobData as JobRow & { order_id: string };
  const [orderResult, itemsResult, ticketResult] = await Promise.all([
    supabase.from("orders").select("id, order_number, table_number, service_location, total_tyiyn, cashier_name, created_at").eq("id", job.order_id).single(),
    job.type === "kitchen" && job.kitchen_ticket_id
      ? supabase.from("kitchen_ticket_items").select("menu_item_id, item_name, kitchen_comment, unit_price_tyiyn, quantity, line_total_tyiyn").eq("ticket_id", job.kitchen_ticket_id).order("id")
      : supabase.from("order_items").select("menu_item_id, item_name, kitchen_comment, unit_price_tyiyn, quantity, line_total_tyiyn").eq("order_id", job.order_id).order("id"),
    job.type === "kitchen" && job.kitchen_ticket_id
      ? supabase.from("kitchen_tickets").select("service_location").eq("id", job.kitchen_ticket_id).single()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (orderResult.error || itemsResult.error || ticketResult.error || !orderResult.data) throw orderResult.error ?? itemsResult.error ?? ticketResult.error ?? new Error("Не удалось подготовить чек.");
  const order = orderResult.data as OrderRow;
  const items = (itemsResult.data ?? []) as ItemRow[];
  const ticket = ticketResult.data as KitchenTicketRow | null;
  return { id: order.id, orderNumber: order.order_number, tableNumber: order.table_number, serviceLocation: ticket?.service_location ?? order.service_location, totalTyiyn: order.total_tyiyn, cashierName: order.cashier_name, createdAt: order.created_at, items: items.map(toItem), printJobs: [{ id: job.id, type: job.type, status: "processing", attempts: job.attempts, lastError: null }], created: false };
}

function toItem(row: ItemRow): OrderItemSnapshot { return { menuItemId: row.menu_item_id, itemName: row.item_name, kitchenComment: row.kitchen_comment, unitPriceTyiyn: row.unit_price_tyiyn, quantity: row.quantity, lineTotalTyiyn: row.line_total_tyiyn }; }
