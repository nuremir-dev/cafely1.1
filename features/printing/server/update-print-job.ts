import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
const schema = z.object({ status: z.enum(["submitted", "failed"]), lastError: z.string().max(1000).nullable().optional() });
export async function updatePrintJob(id: string, input: unknown) { if (!z.uuid().safeParse(id).success) throw new ApiError("INVALID_REQUEST",400,"Некорректное задание печати."); const parsed=schema.safeParse(input); if(!parsed.success) throw new ApiError("INVALID_REQUEST",400,"Некорректный результат печати."); const value=parsed.data; const {error}=await createSupabaseAdminClient().rpc("report_cafeline_print_job", { p_job_id:id, p_status:value.status, p_last_error:value.status === "failed" ? value.lastError ?? "Ошибка печати" : null }); if(error) throw new ApiError("INTERNAL_ERROR",500,"Не удалось обновить задание печати."); }
