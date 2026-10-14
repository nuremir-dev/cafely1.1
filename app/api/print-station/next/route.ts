import { requireApiSession } from "@/features/auth/guards";
import { claimPrintJob } from "@/features/printing/server/claim-print-job";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function POST(request: Request) {
  try {
    await requireApiSession();
    const body: unknown = await request.json();
    const stationId = body && typeof body === "object" && "stationId" in body && typeof body.stationId === "string" ? body.stationId : "";
    return Response.json({ data: await claimPrintJob(stationId) });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("Unable to claim print job", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось получить задание печати."));
  }
}
