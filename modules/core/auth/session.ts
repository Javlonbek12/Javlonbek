import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "assistant_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

type SessionPayload = { userId: string; expiresAt: number };

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

// Token format: base64url(JSON payload) + "." + HMAC signature.
export function createSessionToken(userId: string, secret: string, now = Date.now()): string {
  const payload: SessionPayload = { userId, expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000 };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

function readPayload(token: string, secret: string, now: number): SessionPayload | null {
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  const expected = sign(data, secret);
  if (
    expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as SessionPayload;
    if (typeof payload.userId !== "string" || payload.expiresAt <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSessionToken(token: string, secret: string, now = Date.now()): string | null {
  return readPayload(token, secret, now)?.userId ?? null;
}

// A session used after half of its life gets a fresh token, so someone who opens the app now and
// then stays signed in instead of being thrown out every 30 days. Returns the new token, or null
// when the token is still young (or not valid).
export function renewedSessionToken(token: string, secret: string, now = Date.now()) {
  const payload = readPayload(token, secret, now);
  if (!payload || payload.expiresAt - now > (SESSION_MAX_AGE_SECONDS * 1000) / 2) return null;
  return createSessionToken(payload.userId, secret, now);
}

export function sessionCookieOptions(appUrl: string) {
  return {
    httpOnly: true,
    secure: appUrl.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
