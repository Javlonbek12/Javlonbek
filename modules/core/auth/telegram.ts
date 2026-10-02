import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TelegramProfile = {
  telegramId: bigint;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
};

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

// Checks data from the Telegram Login Widget.
// https://core.telegram.org/widgets/login#checking-authorization
// `data` must contain only the fields Telegram sent (plus `hash`).
export function verifyTelegramLogin(
  data: Record<string, string>,
  botToken: string,
  now = new Date(),
): TelegramProfile | null {
  const { hash, ...fields } = data;
  if (!hash || !fields.id || !fields.first_name || !fields.auth_date) return null;

  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(checkString).digest("hex");
  if (
    expected.length !== hash.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(hash))
  ) {
    return null;
  }

  const ageSeconds = now.getTime() / 1000 - Number(fields.auth_date);
  if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -60) {
    return null;
  }
  if (!/^\d+$/.test(fields.id)) return null;

  return {
    telegramId: BigInt(fields.id),
    firstName: fields.first_name,
    lastName: fields.last_name || undefined,
    username: fields.username || undefined,
    photoUrl: fields.photo_url || undefined,
  };
}

// Test helper and dev tool: produces the hash Telegram would send.
export function signTelegramLoginData(data: Record<string, string>, botToken: string): string {
  const checkString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  return createHmac("sha256", secretKey).update(checkString).digest("hex");
}
