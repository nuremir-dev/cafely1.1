import { requireAdminApiSession } from "@/features/auth/guards";
import { updateCategory } from "@/features/admin-menu/server/manage-menu";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminApiSession();
    const { id } = await context.params;
    const category = await updateCategory(id, await request.json());
    return Response.json({ data: category });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof SyntaxError) {
      return errorResponse(new ApiError("INVALID_REQUEST", 400, "Некорректный JSON."));
    }
    console.error("Unable to update category", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось сохранить категорию."));
  }
}
