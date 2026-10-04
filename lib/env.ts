import { z } from "zod";

// Empty strings in .env mean "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

// Server-side environment variables. Variables of later stages stay optional
// until their stage is implemented.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.url().default("http://localhost:3000"),
  SESSION_SECRET: optional(z.string().min(32, "SESSION_SECRET must be at least 32 characters")),
  TELEGRAM_BOT_TOKEN: optional(z.string()),
  TELEGRAM_BOT_USERNAME: optional(z.string()),
  TELEGRAM_WEBHOOK_SECRET: optional(z.string()),
  ALLOW_DEV_LOGIN: z
    .enum(["true", "false", ""])
    .default("false")
    .transform((value) => value === "true"),
  DEFAULT_TIMEZONE: z.string().default("Asia/Tashkent"),
  ANTHROPIC_API_KEY: optional(z.string()),
  CLAUDE_MODEL: optional(z.string()).transform((v) => v ?? "claude-haiku-4-5"),
  AI_DAILY_LIMIT: z.coerce.number().int().positive().default(200),
  STT_PROVIDER: z.enum(["whisper", "openai", "mock"]).default("mock"),
  WHISPER_URL: optional(z.url()),
  STT_API_URL: optional(z.url()),
  STT_API_KEY: optional(z.string()),
  // Model name sent to the speech-to-text server ("whisper-1" for OpenAI).
  STT_MODEL: optional(z.string()),
  UPLOAD_DIR: z.string().default("./uploads"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables: ${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export function requireSessionSecret(): string {
  const secret = getEnv().SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Add it to .env (see .env.example).");
  }
  return secret;
}

// Dev login is never available in production, whatever the env says.
export function isDevLoginEnabled(): boolean {
  const env = getEnv();
  return env.ALLOW_DEV_LOGIN && env.NODE_ENV !== "production";
}
