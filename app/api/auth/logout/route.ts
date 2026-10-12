import { SESSION_COOKIE_NAME } from "@/features/auth/constants";

export async function POST() {
  const response = Response.json({ data: { loggedOut: true } });
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  );
  return response;
}
