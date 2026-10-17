import type { CookieOptions } from "hono/utils/cookie";

/**
 * A Secure cookie is only retained by browsers over an encrypted
 * connection. We must NOT mark it Secure for plain HTTP access — otherwise
 * browsers silently drop it and the session can never persist. That bites
 * anyone reaching the app over the LAN (http://192.168.x.x:3000): the page
 * loads, but login never sticks.
 *
 * We treat the connection as encrypted only when it genuinely is: either the
 * upstream proxy terminates TLS and reports it via x-forwarded-proto, or the
 * request URL itself is https.
 */
function isEncrypted(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0].trim() === "https";
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function getSessionCookieOptions(request: Request): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: isEncrypted(request),
  };
}
