export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_PIN"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFIGURATION_ERROR"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(error: ApiError) {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}
