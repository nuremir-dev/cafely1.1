import { z } from "zod";

import { authenticatePin } from "@/features/auth/pin";
import { LoginAttemptStore } from "@/features/auth/login-attempts";
import {
  LOGIN_ATTEMPT_WINDOW_MS,
  LOGIN_MAX_ATTEMPTS,
  SESSION_COOKIE_NAME,
} from "@/features/auth/constants";
import { createSessionToken, sessionCookieOptions } from "@/features/auth/session";
import { ApiError, errorResponse } from "@/lib/http/api-error";
import { ConfigurationError } from "@/lib/env";

const loginSchema = z.object({ pin: z.string().regex(/^\d{4}$/) });
const attempts = new LoginAttemptStore(LOGIN_MAX_ATTEMPTS, LOGIN_ATTEMPT_WINDOW_MS);

function getClientIdentifier(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  const identifier = getClientIdentifier(request);
  const retryAfter = attempts.getRetryAfterSeconds(identifier);

  if (retryAfter) {
    return errorResponse(
      new ApiError("RATE_LIMITED", 429, `Повторите попытку через ${retryAfter} сек.`),
    );
  }

  try {
    const input = loginSchema.safeParse(await request.json());
    if (!input.success) {
      throw new ApiError("INVALID_REQUEST", 400, "PIN должен состоять из 4 цифр.");
    }

    const role = authenticatePin(input.data.pin);
    if (!role) {
      attempts.recordFailure(identifier);
      throw new ApiError("INVALID_PIN", 401, "Неверный PIN-код.");
    }

    attempts.clear(identifier);
    const token = await createSessionToken({
      role,
      cashierName: role === "admin" ? "Администратор" : "Кассир 1",
    });
    const response = Response.json({ data: { role } });
    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${sessionCookieOptions.maxAge}; HttpOnly; SameSite=Lax${sessionCookieOptions.secure ? "; Secure" : ""}`,
    );
    return response;
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof ConfigurationError) {
      return errorResponse(
        new ApiError("CONFIGURATION_ERROR", 500, "Сервер не настроен для входа."),
      );
    }
    return errorResponse(new ApiError("INTERNAL_ERROR", 500, "Не удалось выполнить вход."));
  }
}
