import { FileText, ImageOff } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Links in the text are clickable, as Telegram shows them.
function linkify(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="text-[#168acd] hover:underline"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export type PreviewFile = { id: string; kind: "PHOTO" | "VIDEO" | "FILE"; name?: string };

const fileUrl = (id: string) => `/api/content/files/${id}`;

// Photos and videos as a Telegram album: one wide, two side by side, more in a grid.
function Album({ media }: { media: PreviewFile[] }) {
  return (
    <div
      className={cn(
        "grid gap-0.5",
        media.length > 1 && "grid-cols-2",
        media.length > 4 && "grid-cols-3",
      )}
    >
      {media.map((m, i) => {
        const wide = media.length > 1 && media.length % 2 === 1 && i === 0 && media.length <= 4;
        const box = cn(
          "block w-full bg-neutral-200 object-cover",
          media.length === 1 ? "max-h-[460px]" : "aspect-square",
          wide && "col-span-2 aspect-[2/1]",
        );
        return m.kind === "VIDEO" ? (
          <video key={m.id} src={fileUrl(m.id)} className={box} controls preload="metadata" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- private image from our API
          <img key={m.id} src={fileUrl(m.id)} alt="" className={box} />
        );
      })}
    </div>
  );
}

// One message as Telegram draws it: the album on top, documents, the text, the time in the corner.
export function TelegramBubble({
  files,
  text,
  time,
  sender,
  className,
}: {
  files: PreviewFile[];
  text: string | null;
  time: string | null;
  // Shown above the message, like a sender name.
  sender?: { name: string; color: string };
  className?: string;
}) {
  const media = files.filter((f) => f.kind !== "FILE");
  const documents = files.filter((f) => f.kind === "FILE");
  return (
    <div
      className={cn(
        "relative max-w-[min(100%,24rem)] overflow-hidden rounded-[14px] rounded-bl-[4px] bg-white text-[15px] leading-[1.35] text-[#000] shadow-[0_1px_1px_rgba(0,0,0,0.12)]",
        className,
      )}
    >
      {sender && (
        <div className="px-3 pt-1.5 text-[13px] font-semibold" style={{ color: sender.color }}>
          {sender.name}
        </div>
      )}
      {media.length > 0 ? (
        <div className={cn(sender && "mt-1.5")}>
          <Album media={media} />
        </div>
      ) : documents.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-1.5 bg-neutral-100 text-xs text-neutral-500">
          <ImageOff className="size-5" />
          {t("content.preview.noImage")}
        </div>
      ) : null}
      {documents.length > 0 && (
        <ul className="flex flex-col gap-1.5 px-3 pt-2">
          {documents.map((d) => (
            <li key={d.id}>
              <a
                href={`${fileUrl(d.id)}?download=1`}
                className="flex items-center gap-2.5 text-[14px] hover:underline"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#3fa3e8] text-white">
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0 truncate">{d.name ?? "file"}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="px-3 pt-1.5 pb-2">
        <p className="break-words whitespace-pre-wrap">
          {text ? (
            linkify(text)
          ) : (
            <span className="text-neutral-400">{t("content.preview.noText")}</span>
          )}
          {/* Room for the time, as in Telegram. */}
          <span className="inline-block w-12" aria-hidden />
        </p>
        <span className="absolute right-2.5 bottom-1.5 text-[12px] text-[#8b9aa5]">
          {time ?? ""}
        </span>
      </div>
    </div>
  );
}

// The chat background around one or more bubbles.
export function TelegramChat({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-[#c9dcb4] bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.25)_0,transparent_40%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.2)_0,transparent_45%)] p-3 sm:p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

// The post page: one message in a chat.
export function PostPreview({
  files,
  text,
  time,
}: {
  files: PreviewFile[];
  text: string | null;
  time: string | null;
}) {
  return (
    <TelegramChat>
      <TelegramBubble files={files} text={text} time={time} className="mx-auto" />
    </TelegramChat>
  );
}
