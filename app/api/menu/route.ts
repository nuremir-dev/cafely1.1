import { requireApiSession } from "@/features/auth/guards";
import { getActiveMenuCatalog } from "@/features/menu/server/get-active-menu-catalog";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function GET() {
  try {
    await requireApiSession();
    const catalog = await getActiveMenuCatalog();
    return Response.json(
      { data: catalog },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);

    console.error("Unable to load active menu", error);
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось загрузить меню."));
  }
}
