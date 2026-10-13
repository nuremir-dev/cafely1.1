import { requireApiSession } from "@/features/auth/guards";
import { listActiveOrders, openActiveOrder } from "@/features/orders/server/active-orders";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function GET() {
  try {
    await requireApiSession();
    return Response.json({ data: await listActiveOrders() });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("Unable to load active orders", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось загрузить активные заказы."));
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    return Response.json({ data: await openActiveOrder(await request.json(), session) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof SyntaxError) return errorResponse(new ApiError("INVALID_REQUEST", 400, "Переданы некорректные данные заказа."));
    console.error("Unable to open active order", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось открыть заказ."));
  }
}
