import { requireAdminApiSession } from "@/features/auth/guards";
import { createCategory } from "@/features/admin-menu/server/manage-menu";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function POST(request: Request) {
  try {
    await requireAdminApiSession();
    const category = await createCategory(await request.json());
    return Response.json({ data: category }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown) {
  if (error instanceof ApiError) return errorResponse(error);
  if (error instanceof SyntaxError) {
    return errorResponse(new ApiError("INVALID_REQUEST", 400, "Некорректный JSON."));
  }
  console.error("Unable to create category", error);
  return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось сохранить категорию."));
}
