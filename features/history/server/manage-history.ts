import "server-only";

import { z } from "zod";

import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function cancelCompletedOrder(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success)
    throw new ApiError("INVALID_REQUEST", 400, "Некорректный идентификатор заказа.");
  const { error } = await createSupabaseAdminClient().rpc("cancel_cafeline_completed_order", {
    p_order_id: id,
  });
  if (error?.code === "P0002")
    throw new ApiError("INVALID_REQUEST", 404, "Завершённый заказ не найден.");
  if (error) throw error;
}

export async function clearOrderHistory(): Promise<number> {
  const { data, error } = await createSupabaseAdminClient().rpc("clear_cafeline_order_history");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}
