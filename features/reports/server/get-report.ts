import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
const date = z.iso.date();
export type Report = { revenueTyiyn:number; orderCount:number; itemCount:number; topItems:Array<{name:string;sold:number;revenueTyiyn:number}>; items:Array<{name:string;sold:number;revenueTyiyn:number}>; dailyRevenue:Array<{date:string;revenueTyiyn:number}> };
export async function getReport(params: URLSearchParams): Promise<Report> { const start=params.get("start"), end=params.get("end"); if(!start||!end||!date.safeParse(start).success||!date.safeParse(end).success||start>end) throw new ApiError("INVALID_REQUEST",400,"Укажите корректный диапазон дат."); const {data,error}=await createSupabaseAdminClient().rpc("cafeline_report",{p_start_date:start,p_end_date:end}); if(error) throw error; return data as Report; }
