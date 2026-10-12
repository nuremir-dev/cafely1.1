import { requireApiSession } from "@/features/auth/guards";
import { getOrderHistory } from "@/features/history/server/order-history";
import { createOrder } from "@/features/orders/server/create-order";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function POST(request: Request) {
  try {
    const input: unknown = await request.json();
    const session = await requireApiSession();
    const order = await createOrder(input, session);
    return Response.json({ data: order }, { status: order.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof SyntaxError) {
      return errorResponse(new ApiError("INVALID_REQUEST", 400, "Переданы некорректные данные заказа."));
    }

    console.error("Unable to create order", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось сохранить заказ."));
  }
}

export async function GET(request: Request) {
  try {
    await requireApiSession();
    const history = await getOrderHistory(new URL(request.url).searchParams);
    return Response.json({ data: history });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("Unable to load order history", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось загрузить историю продаж."));
  }
}
