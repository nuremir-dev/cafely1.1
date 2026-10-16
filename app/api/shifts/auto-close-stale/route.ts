import { requireApiSession } from "@/features/auth/guards";
import { autoCloseStaleCashShift } from "@/features/shifts/server/cash-shifts";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function POST() {
  try {
    await requireApiSession();
    return Response.json({ data: await autoCloseStaleCashShift() });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("Unable to auto-close stale cash shift", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось проверить незакрытую смену."));
  }
}
