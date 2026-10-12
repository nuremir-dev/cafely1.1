import { requireApiSession } from "@/features/auth/guards";
import { getReport } from "@/features/reports/server/get-report";
import { ApiError,errorResponse } from "@/lib/http/api-error";
export async function GET(request:Request) { try { await requireApiSession(); return Response.json({data:await getReport(new URL(request.url).searchParams)}); } catch(error) { if(error instanceof ApiError) return errorResponse(error); return errorResponse(new ApiError("INTERNAL_ERROR",500,"Не удалось построить отчёт.")); } }
