import "server-only";

import { z } from "zod";

import type { CashShift, ShiftDashboard } from "@/features/shifts/types";
import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const nameSchema = z.string().trim().min(1).max(100);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const shiftIdSchema = z.uuid();

type ShiftRow = {
  id: string;
  business_date: string;
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  close_mode: "manual" | "overnight_auto";
  status: "open" | "closed";
  sales_total_tyiyn: number;
  sold_item_count: number;
};

type AutoCloseStaleShiftRow = ShiftRow & { outcome: "closed" };

export type AutoCloseStaleShiftResult = {
  outcome: "none" | "closed";
  shift: CashShift | null;
};

export async function getShiftDashboard(selectedDate?: string | null): Promise<ShiftDashboard> {
  if (selectedDate && !dateSchema.safeParse(selectedDate).success)
    throw new ApiError("INVALID_REQUEST", 400, "Некорректная дата смены.");
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("cash_shifts")
    .select("id, business_date, opened_by, opened_at, closed_by, closed_at, close_mode, status, sales_total_tyiyn, sold_item_count")
    .order("business_date", { ascending: false })
    .order("opened_at", { ascending: false });
  if (selectedDate) query = query.eq("business_date", selectedDate);
  const [historyResult, currentResult] = await Promise.all([
    query,
    supabase
      .from("cash_shifts")
      .select("id, business_date, opened_by, opened_at, closed_by, closed_at, close_mode, status, sales_total_tyiyn, sold_item_count")
      .eq("status", "open")
      .maybeSingle(),
  ]);
  if (historyResult.error || currentResult.error) throw historyResult.error ?? currentResult.error;
  const shifts = ((historyResult.data ?? []) as ShiftRow[]).map(toCashShift);
  return { currentShift: currentResult.data ? toCashShift(currentResult.data as ShiftRow) : null, shifts };
}

export async function getCurrentCashShift(): Promise<CashShift | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from("cash_shifts")
    .select("id, business_date, opened_by, opened_at, closed_by, closed_at, close_mode, status, sales_total_tyiyn, sold_item_count")
    .eq("status", "open")
    .maybeSingle();
  if (error) throw error;
  return data ? toCashShift(data as ShiftRow) : null;
}

export async function autoCloseStaleCashShift(): Promise<AutoCloseStaleShiftResult> {
  const { data, error } = await createSupabaseAdminClient().rpc("auto_close_stale_cafeline_cash_shift");
  if (error) throw error;
  const row = (data as AutoCloseStaleShiftRow[] | null)?.[0];
  return row ? { outcome: row.outcome, shift: toCashShift(row) } : { outcome: "none", shift: null };
}

export async function openCashShift(input: unknown): Promise<CashShift> {
  const parsed = z.object({ openedBy: nameSchema }).safeParse(input);
  if (!parsed.success) throw new ApiError("INVALID_REQUEST", 400, "Введите имя кассира.");
  const { data, error } = await createSupabaseAdminClient().rpc("open_cafeline_cash_shift", {
    p_opened_by: parsed.data.openedBy,
  });
  if (error) throw mapShiftError(error);
  const row = (data as ShiftRow[] | null)?.[0];
  if (!row) throw new ApiError("INTERNAL_ERROR", 500, "Сервер не создал смену.");
  return toCashShift(row);
}

export async function closeCashShift(input: unknown): Promise<CashShift> {
  const parsed = z.object({ shiftId: shiftIdSchema, closedBy: nameSchema }).safeParse(input);
  if (!parsed.success) throw new ApiError("INVALID_REQUEST", 400, "Некорректные данные закрытия смены.");
  const { data, error } = await createSupabaseAdminClient().rpc("close_cafeline_cash_shift", {
    p_shift_id: parsed.data.shiftId,
    p_closed_by: parsed.data.closedBy,
  });
  if (error) throw mapShiftError(error);
  const row = (data as ShiftRow[] | null)?.[0];
  if (!row) throw new ApiError("INTERNAL_ERROR", 500, "Сервер не закрыл смену.");
  return toCashShift(row);
}

function toCashShift(row: ShiftRow): CashShift {
  return {
    id: row.id,
    businessDate: row.business_date,
    openedBy: row.opened_by,
    openedAt: row.opened_at,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    closeMode: row.close_mode ?? "manual",
    status: row.status,
    salesTotalTyiyn: row.sales_total_tyiyn,
    soldItemCount: row.sold_item_count,
  };
}

function mapShiftError(error: { code?: string }): ApiError | { code?: string } {
  if (error.code === "22023") return new ApiError("INVALID_REQUEST", 409, "Нельзя закрыть смену, пока есть незавершённые заказы.");
  if (error.code === "P0002") return new ApiError("INVALID_REQUEST", 404, "Смена не найдена.");
  return error;
}
