import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import { getServerEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS } from "./constants";
import type { Role, Session } from "./types";

const encoder = new TextEncoder();
const issuer = "cafeline";
const audience = "cafeline-web";

function sessionKey() {
  return encoder.encode(getServerEnv().CAFE_SESSION_SECRET);
}

export async function createSessionToken(session: Session) {
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(sessionKey());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { issuer, audience });
    const role = payload.role;
    const cashierName = payload.cashierName;

    if ((role !== "cashier" && role !== "admin") || typeof cashierName !== "string") {
      return null;
    }

    return { role: role as Role, cashierName };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySessionToken(token) : null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  maxAge: SESSION_DURATION_SECONDS,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
