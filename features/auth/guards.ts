import "server-only";

import { redirect } from "next/navigation";

import { ApiError } from "@/lib/http/api-error";

import { getSession } from "./session";
import type { Session } from "./types";

export async function requirePageSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireAdminPage(): Promise<Session> {
  const session = await requirePageSession();
  if (session.role !== "admin") redirect("/pos");
  return session;
}

/** Use this in every authenticated Route Handler; proxy.ts is only UX navigation. */
export async function requireApiSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new ApiError("UNAUTHORIZED", 401, "Требуется вход.");
  }

  return session;
}

export async function requireAdminApiSession(): Promise<Session> {
  const session = await requireApiSession();
  if (session.role !== "admin") {
    throw new ApiError("FORBIDDEN", 403, "Требуются права администратора.");
  }

  return session;
}
