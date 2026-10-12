import { requireApiSession } from "@/features/auth/guards";
import { getOrderDetails } from "@/features/history/server/order-history";
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
