import { requireApiSession } from "@/features/auth/guards";
import { closeCashShift, getShiftDashboard, openCashShift } from "@/features/shifts/server/cash-shifts";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function GET(request: Request) {
  try {
    await requireApiSession();
    return Response.json({ data: await getShiftDashboard(new URL(request.url).searchParams.get("date")) });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("Unable to load cash shifts", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось загрузить смены."));
  }
}

export async function POST(request: Request) {
  try {
    await requireApiSession();
    return Response.json({ data: await openCashShift(await request.json()) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof SyntaxError) return errorResponse(new ApiError("INVALID_REQUEST", 400, "Переданы некорректные данные смены."));
    console.error("Unable to open cash shift", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось открыть смену."));
  }
}

export async function PATCH(request: Request) {
  try {
    await requireApiSession();
    return Response.json({ data: await closeCashShift(await request.json()) });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof SyntaxError) return errorResponse(new ApiError("INVALID_REQUEST", 400, "Переданы некорректные данные смены."));
    console.error("Unable to close cash shift", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось закрыть смену."));
  }
}
