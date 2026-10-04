// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { parseEnv } from "@/lib/env";

import { createSpeechToText, MockStt, OpenAiCompatibleStt, SttError } from "./index";

const audio = { data: new Uint8Array([1, 2, 3]), fileName: "voice.ogg", mimeType: "audio/ogg" };

describe("OpenAiCompatibleStt", () => {
  it("posts the audio as multipart form and returns the text", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init!.body as FormData;
      expect(form.get("model")).toBe("whisper-1");
      expect((form.get("file") as File).name).toBe("voice.ogg");
      expect(init!.headers).toEqual({ Authorization: "Bearer key" });
      return Response.json({ text: " Азизу подготовить отчёт " });
    });
    const stt = new OpenAiCompatibleStt(
      "https://stt.example/v1/audio/transcriptions",
      "whisper-1",
      "key",
      fetchMock as typeof fetch,
    );
    expect(await stt.transcribe(audio)).toBe("Азизу подготовить отчёт");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://stt.example/v1/audio/transcriptions",
      expect.anything(),
    );
  });

  it("throws a clear error on HTTP failure", async () => {
    const stt = new OpenAiCompatibleStt(
      "https://x",
      "m",
      undefined,
      (async () => new Response("", { status: 500 })) as typeof fetch,
    );
    await expect(stt.transcribe(audio)).rejects.toBeInstanceOf(SttError);
  });
});

describe("createSpeechToText", () => {
  const base = { DATABASE_URL: "postgresql://x" };

  it("uses the mock by default", () => {
    expect(createSpeechToText(parseEnv(base))).toBeInstanceOf(MockStt);
  });

  it("builds the whisper endpoint from WHISPER_URL", () => {
    const stt = createSpeechToText(
      parseEnv({ ...base, STT_PROVIDER: "whisper", WHISPER_URL: "http://whisper:8000/" }),
    );
    expect(stt).toBeInstanceOf(OpenAiCompatibleStt);
  });

  it("requires the URL for the chosen provider", () => {
    expect(() => createSpeechToText(parseEnv({ ...base, STT_PROVIDER: "openai" }))).toThrow(
      SttError,
    );
  });
});
