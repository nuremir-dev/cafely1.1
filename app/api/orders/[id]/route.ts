import { requireApiSession } from "@/features/auth/guards";
import { getOrderDetails } from "@/features/history/server/order-history";
import { cancelCompletedOrder } from "@/features/history/server/manage-history";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession();
    const { id } = await context.params;
    const order = await getOrderDetails(id);
    return Response.json({ data: order });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("Unable to load order details", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось загрузить заказ."));
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession();
    const { id } = await context.params;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("action" in body) || body.action !== "cancel")
      throw new ApiError("INVALID_REQUEST", 400, "Передано некорректное действие заказа.");
    await cancelCompletedOrder(id);
    return Response.json({ data: { id } });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof SyntaxError) return errorResponse(new ApiError("INVALID_REQUEST", 400, "Переданы некорректные данные заказа."));
    console.error("Unable to cancel order", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось отменить заказ."));
  }
}
