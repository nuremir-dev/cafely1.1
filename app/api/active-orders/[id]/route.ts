import { requireApiSession } from "@/features/auth/guards";
import { cancelActiveOrderItem, changeActiveOrderItem, completeActiveOrder, completeLocalCart, deleteEmptyActiveOrder, getActiveOrder, moveActiveOrder, printLocalCartCancellationToKitchen, printLocalCartToKitchen, sendActiveOrderItemToKitchen, sendActiveOrderToKitchen } from "@/features/orders/server/active-orders";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession();
    const { id } = await context.params;
    return Response.json({ data: await getActiveOrder(id) });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("Unable to load active order", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось загрузить активный заказ."));
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession();
    const { id } = await context.params;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("action" in body) || typeof body.action !== "string") throw new ApiError("INVALID_REQUEST", 400, "Переданы некорректные данные заказа.");
    if (body.action === "move-table") return Response.json({ data: await moveActiveOrder(id, body) });
    if (body.action === "change-item") return Response.json({ data: await changeActiveOrderItem(id, body) });
    if (body.action === "send-item-to-kitchen") return Response.json({ data: await sendActiveOrderItemToKitchen(id, body) });
    if (body.action === "send-to-kitchen") return Response.json({ data: await sendActiveOrderToKitchen(id, body) });
    if (body.action === "complete-local-cart") return Response.json({ data: await completeLocalCart(id, body) });
    if (body.action === "print-local-cart-to-kitchen") return Response.json({ data: await printLocalCartToKitchen(id, body) });
    if (body.action === "print-local-cart-cancellation-to-kitchen") return Response.json({ data: await printLocalCartCancellationToKitchen(id, body) });
    if (body.action === "complete") return Response.json({ data: await completeActiveOrder(id) });
    if (body.action === "delete-empty") {
      await deleteEmptyActiveOrder(id);
      return Response.json({ data: { id } });
    }
    if (body.action === "cancel-item") {
      await cancelActiveOrderItem(id, body);
      return Response.json({ data: { id } });
    }
    throw new ApiError("INVALID_REQUEST", 400, "Неизвестное действие заказа.");
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof SyntaxError) return errorResponse(new ApiError("INVALID_REQUEST", 400, "Переданы некорректные данные заказа."));
    console.error("Unable to update active order", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось изменить активный заказ."));
  }
}
