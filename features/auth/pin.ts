import "server-only";

import { timingSafeEqual } from "node:crypto";

import { getServerEnv, type ServerEnv } from "@/lib/env";
import type { Role } from "./types";

function matchesPin(candidate: string, expected: string) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);

  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

export function resolveRoleForPin(
  pin: string,
  env: Pick<ServerEnv, "CAFE_CASHIER_PIN" | "CAFE_ADMIN_PIN">,
): Role | null {
  const isCashier = matchesPin(pin, env.CAFE_CASHIER_PIN);
  const isAdmin = matchesPin(pin, env.CAFE_ADMIN_PIN);

  if (isAdmin) return "admin";
  if (isCashier) return "cashier";
  return null;
}

export function authenticatePin(pin: string): Role | null {
  const env = getServerEnv();
  return resolveRoleForPin(pin, env);
}
