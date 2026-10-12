import { requireApiSession } from "@/features/auth/guards";
import { updatePrintJob } from "@/features/printing/server/update-print-job";
import { ApiError, errorResponse } from "@/lib/http/api-error";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { try { await requireApiSession(); const {id}=await context.params; await updatePrintJob(id, await request.json()); return new Response(null,{status:204}); } catch(error) { if(error instanceof ApiError) return errorResponse(error); return errorResponse(new ApiError("INTERNAL_ERROR",500,"Не удалось обновить печать.")); } }
