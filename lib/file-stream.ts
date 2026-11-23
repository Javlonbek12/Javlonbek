import { createReadStream } from "node:fs";

// A file as a web stream for a Response. Unlike Readable.toWeb, it stops reading when the browser
// goes away mid-download (a closed tab, a video seek): Node's adapter kept pushing into the closed
// stream and crashed with «Invalid state: Controller is already closed». Reads only as fast as the
// browser takes the data.
export function fileStream(
  absolutePath: string,
  range?: { start: number; end: number },
): ReadableStream<Uint8Array> {
  const file = createReadStream(absolutePath, range);
  let closed = false;
  const stop = () => {
    closed = true;
    file.destroy();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      file.on("data", (chunk) => {
        if (closed) return;
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        try {
          controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        } catch {
          stop();
          return;
        }
        if ((controller.desiredSize ?? 1) <= 0) file.pause();
      });
      file.on("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The browser went away first.
        }
      });
      file.on("error", (error) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(error);
        } catch {
          // Already closed.
        }
      });
    },
    pull() {
      if (!closed) file.resume();
    },
    cancel() {
      stop();
    },
  });
}
