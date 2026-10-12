import { requireAdminApiSession } from "@/features/auth/guards";
import { createMenuItem } from "@/features/admin-menu/server/manage-menu";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function POST(request: Request) {
  try {
    await requireAdminApiSession();
    const item = await createMenuItem(await request.json());
    return Response.json({ data: item }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof SyntaxError) {
      return errorResponse(new ApiError("INVALID_REQUEST", 400, "Некорректный JSON."));
    }
    console.error("Unable to create menu item", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось сохранить блюдо."));
  }
}
