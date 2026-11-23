// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fileStream } from "./file-stream";

describe("fileStream", () => {
  let dir: string;
  let file: string;
  const bytes = Buffer.alloc(300_000, 7);
  bytes.write("start", 0);
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "stream-"));
    file = path.join(dir, "big.bin");
    await writeFile(file, bytes);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("gives the whole file, or the asked part of it", async () => {
    expect(Buffer.from(await new Response(fileStream(file)).arrayBuffer()).equals(bytes)).toBe(
      true,
    );
    const part = await new Response(fileStream(file, { start: 0, end: 4 })).text();
    expect(part).toBe("start");
  });

  it("stops quietly when the reader goes away mid-way", async () => {
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);
    process.on("uncaughtException", onError);
    try {
      const reader = fileStream(file).getReader();
      await reader.read();
      await reader.cancel();
      // Give the file reader time to push more data after the cancel.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("uncaughtException", onError);
    }
    expect(errors).toEqual([]);
  });
});
