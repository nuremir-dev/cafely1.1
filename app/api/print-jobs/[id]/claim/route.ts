import { requireApiSession } from "@/features/auth/guards";
import { claimSpecificPrintJob } from "@/features/printing/server/claim-specific-print-job";
import { ApiError, errorResponse } from "@/lib/http/api-error";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession();
    const { id } = await context.params;
    return Response.json({ data: await claimSpecificPrintJob(id, await request.json()) });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof SyntaxError) return errorResponse(new ApiError("INVALID_REQUEST", 400, "Переданы некорректные данные печати."));
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось закрепить задание печати."));
  }
}
