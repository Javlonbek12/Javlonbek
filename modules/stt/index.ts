import { getEnv, type Env } from "@/lib/env";

export type AudioInput = { data: Uint8Array; fileName: string; mimeType: string };

export type TranscribeOptions = {
  // Words the speaker is likely to use (team names, work terms): improves their spelling.
  prompt?: string;
};

export interface SpeechToText {
  transcribe(audio: AudioInput, options?: TranscribeOptions): Promise<string>;
}

// The team speaks Russian, Uzbek and sometimes English. Auto-detection on short Uzbek
// messages sometimes picks a wrong language (Persian, Turkish...) and writes in its script;
// such results are recognized again as Uzbek.
const EXPECTED_LANGUAGES = new Set(["ru", "uz", "en", "russian", "uzbek", "english"]);
const FALLBACK_LANGUAGE = "uz";

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

  async transcribe(audio: AudioInput, options: TranscribeOptions = {}): Promise<string> {
    const first = await this.request(audio, options.prompt);
    if (!first.language || EXPECTED_LANGUAGES.has(first.language.toLowerCase())) return first.text;
    return (await this.request(audio, options.prompt, FALLBACK_LANGUAGE)).text;
  }

  private async request(audio: AudioInput, prompt?: string, language?: string) {
    const form = new FormData();
    form.set(
      "file",
      new Blob([new Uint8Array(audio.data)], { type: audio.mimeType }),
      audio.fileName,
    );
    form.set("model", this.model);
    // verbose_json also returns the detected language.
    form.set("response_format", "verbose_json");
    if (prompt) form.set("prompt", prompt);
    if (language) form.set("language", language);
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      body: form,
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new SttError(`Speech recognition failed: HTTP ${response.status}`);
    const body = (await response.json()) as { text?: unknown; language?: unknown };
    if (typeof body.text !== "string") throw new SttError("Speech recognition returned no text");
    return {
      text: body.text.trim(),
      language: typeof body.language === "string" ? body.language : null,
    };
  }
}

// For development and tests: returns a fixed text (STT_MOCK_TEXT or a default).
export class MockStt implements SpeechToText {
  constructor(private readonly text: string) {}

  async transcribe(): Promise<string> {
    return this.text;
  }
}

// Default self-hosted model: much better with Uzbek than "small", still fast on CPU.
export const WHISPER_MODEL = "deepdml/faster-whisper-large-v3-turbo-ct2";

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export function createSpeechToText(env: Env = getEnv()): SpeechToText {
  if (env.STT_PROVIDER === "whisper") {
    if (!env.WHISPER_URL) throw new SttError("WHISPER_URL is not set");
    return new OpenAiCompatibleStt(
      `${trimSlash(env.WHISPER_URL)}/v1/audio/transcriptions`,
      env.STT_MODEL ?? WHISPER_MODEL,
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
