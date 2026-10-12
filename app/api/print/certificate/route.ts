import { requireApiSession } from "@/features/auth/guards";
import { getServerEnv } from "@/lib/env";
import { ApiError, errorResponse } from "@/lib/http/api-error";
export async function GET() { try { await requireApiSession(); const certificate=getServerEnv().QZ_CERTIFICATE; if(!certificate) throw new ApiError("CONFIGURATION_ERROR",503,"Сертификат QZ Tray ещё не настроен."); return new Response(certificate,{headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}}); } catch(error) { return error instanceof ApiError ? errorResponse(error) : errorResponse(new ApiError("INTERNAL_ERROR",500,"Не удалось получить сертификат.")); } }
