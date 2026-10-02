import { z } from "zod";

// Server-side environment variables. Only variables needed by the current stage
// are required; the rest are optional until their stage is implemented.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.url().default("http://localhost:3000"),
  DEFAULT_TIMEZONE: z.string().default("Asia/Tashkent"),
  CLAUDE_MODEL: z.string().default("claude-haiku-4-5"),
  AI_DAILY_LIMIT: z.coerce.number().int().positive().default(200),
  STT_PROVIDER: z.enum(["whisper", "openai", "mock"]).default("mock"),
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
