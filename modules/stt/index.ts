import { getEnv, type Env } from "@/lib/env";

export type AudioInput = { data: Uint8Array; fileName: string; mimeType: string };

export interface SpeechToText {
  transcribe(audio: AudioInput): Promise<string>;
}

export class SttError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttError";
  }
}

// OpenAI-compatible /audio/transcriptions endpoint. Both the self-hosted faster-whisper
// server and OpenAI speak this protocol; only the URL, key and model name differ.
export class OpenAiCompatibleStt implements SpeechToText {
  constructor(
    private readonly endpoint: string,
    private readonly model: string,
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(audio: AudioInput): Promise<string> {
    const form = new FormData();
    form.set(
      "file",
      new Blob([new Uint8Array(audio.data)], { type: audio.mimeType }),
      audio.fileName,
    );
    form.set("model", this.model);
    form.set("response_format", "json");
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      body: form,
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new SttError(`Speech recognition failed: HTTP ${response.status}`);
    const body = (await response.json()) as { text?: unknown };
    if (typeof body.text !== "string") throw new SttError("Speech recognition returned no text");
    return body.text.trim();
  }
}

// For development and tests: returns a fixed text (STT_MOCK_TEXT or a default).
export class MockStt implements SpeechToText {
  constructor(private readonly text: string) {}

  async transcribe(): Promise<string> {
    return this.text;
  }
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export function createSpeechToText(env: Env = getEnv()): SpeechToText {
  if (env.STT_PROVIDER === "whisper") {
    if (!env.WHISPER_URL) throw new SttError("WHISPER_URL is not set");
    return new OpenAiCompatibleStt(
      `${trimSlash(env.WHISPER_URL)}/v1/audio/transcriptions`,
      env.STT_MODEL ?? "Systran/faster-whisper-small",
    );
  }
  if (env.STT_PROVIDER === "openai") {
    if (!env.STT_API_URL || !env.STT_API_KEY)
      throw new SttError("STT_API_URL / STT_API_KEY are not set");
    return new OpenAiCompatibleStt(
      `${trimSlash(env.STT_API_URL)}/audio/transcriptions`,
      env.STT_MODEL ?? "whisper-1",
      env.STT_API_KEY,
    );
  }
  return new MockStt(process.env.STT_MOCK_TEXT || "Подготовить отчёт по продажам до пятницы");
}
