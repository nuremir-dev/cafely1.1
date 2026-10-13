import { requireAdminApiSession, requireApiSession } from "@/features/auth/guards";
import { getTableMap, saveTableMap } from "@/features/tables/server/table-map";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function GET() {
  try { await requireApiSession(); return Response.json({ data: await getTableMap() }); }
  catch (error) { return handleError(error); }
}

export async function PUT(request: Request) {
  try { await requireAdminApiSession(); return Response.json({ data: await saveTableMap(await request.json()) }); }
  catch (error) { return handleError(error); }
}

function handleError(error: unknown) {
  if (error instanceof ApiError) return errorResponse(error);
  if (error instanceof SyntaxError) return errorResponse(new ApiError("INVALID_REQUEST", 400, "Некорректный JSON."));
  console.error("Unable to save table map", error);
  return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось сохранить карту столов."));
}
