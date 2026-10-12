import "server-only";

import { z } from "zod";

const serverEnvSchema = z
  .object({
    CAFE_CASHIER_PIN: z.string().regex(/^\d{4}$/, "Должен содержать 4 цифры."),
    CAFE_ADMIN_PIN: z.string().regex(/^\d{4}$/, "Должен содержать 4 цифры."),
    CAFE_SESSION_SECRET: z.string().min(32, "Должен содержать минимум 32 символа."),
    SUPABASE_URL: z.string().url("Должен быть корректным URL."),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "Обязателен."),
    QZ_CERTIFICATE: z.preprocess(
      (value) => value === "" ? undefined : value,
      z.string().min(1).optional(),
    ),
    QZ_PRIVATE_KEY: z.preprocess(
      (value) => value === "" ? undefined : value,
      z.string().min(1).optional(),
    ),
  })
  .superRefine((value, context) => {
    if (value.CAFE_CASHIER_PIN === value.CAFE_ADMIN_PIN) {
      context.addIssue({
        code: "custom",
        path: ["CAFE_ADMIN_PIN"],
        message: "PIN администратора должен отличаться от PIN кассира.",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** The only entry point for server configuration. */
export function getServerEnv(
  input: Record<string, string | undefined> = process.env,
): ServerEnv {
  const parsed = serverEnvSchema.safeParse(input);

  if (parsed.success) {
    return parsed.data;
  }

  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new ConfigurationError(`Некорректная конфигурация окружения: ${details}`);
}
