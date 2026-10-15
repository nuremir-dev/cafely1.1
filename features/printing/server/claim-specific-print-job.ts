import "server-only";

import { z } from "zod";

import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function claimSpecificPrintJob(id: string, input: unknown) {
  if (!z.uuid().safeParse(id).success) throw new ApiError("INVALID_REQUEST", 400, "Некорректное задание печати.");
  const parsed = z.object({ stationId: z.string().min(8).max(100) }).safeParse(input);
  if (!parsed.success) throw new ApiError("INVALID_REQUEST", 400, "Некорректная печатная станция.");
  const { data, error } = await createSupabaseAdminClient().rpc("claim_cafeline_print_job_by_id", {
    p_job_id: id,
    p_station_id: parsed.data.stationId,
  });
  if (error) throw new ApiError("INTERNAL_ERROR", 500, "Не удалось закрепить задание печати.");
  return Boolean(data);
}
