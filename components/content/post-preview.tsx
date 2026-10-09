import { ImageOff } from "lucide-react";
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

// One message as Telegram draws it: the picture on top, the text under it, the time in the corner.
export function TelegramBubble({
  imageUrl,
  text,
  time,
  sender,
  className,
}: {
  imageUrl: string | null;
  text: string | null;
  time: string | null;
  // Shown above the message, like a sender name.
  sender?: { name: string; color: string };
  className?: string;
}) {
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
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- private image from our API
        <img
          src={imageUrl}
          alt=""
          className={cn("block max-h-[460px] w-full object-cover", sender && "mt-1.5")}
        />
      ) : (
        <div className="flex h-32 flex-col items-center justify-center gap-1.5 bg-neutral-100 text-xs text-neutral-500">
          <ImageOff className="size-5" />
          {t("content.preview.noImage")}
        </div>
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
  imageUrl,
  text,
  time,
}: {
  imageUrl: string | null;
  text: string | null;
  time: string | null;
}) {
  return (
    <TelegramChat>
      <TelegramBubble imageUrl={imageUrl} text={text} time={time} className="mx-auto" />
    </TelegramChat>
  );
}
