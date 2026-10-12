import { createSign } from "node:crypto";
import { z } from "zod";
import { requireApiSession } from "@/features/auth/guards";
import { getServerEnv } from "@/lib/env";
import { ApiError, errorResponse } from "@/lib/http/api-error";
export async function POST(request: Request) { try { await requireApiSession(); const input=z.object({ request:z.string().min(1).max(100_000) }).parse(await request.json()); const env=getServerEnv(); if(!env.QZ_PRIVATE_KEY) throw new ApiError("CONFIGURATION_ERROR",503,"Подписание QZ Tray ещё не настроено."); const signer=createSign("RSA-SHA512"); signer.update(input.request); signer.end(); return Response.json({ data: { signature: signer.sign(env.QZ_PRIVATE_KEY).toString("base64") } }); } catch(error) { if(error instanceof ApiError) return errorResponse(error); return errorResponse(new ApiError("INVALID_REQUEST",400,"Некорректный запрос подписи.")); } }
