import { ImageOff } from "lucide-react";

import { t } from "@/lib/i18n";

// How the post will look in Telegram: the visual with the text under it, in a chat bubble.
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
    <div className="rounded-2xl bg-[oklch(0.86_0.05_150)] p-3 sm:p-4">
      <div className="mx-auto max-w-sm overflow-hidden rounded-2xl rounded-bl-md bg-white text-[oklch(0.2_0_0)] shadow-sm">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- private image from our API
          <img src={imageUrl} alt="" className="block max-h-[480px] w-full object-contain" />
        ) : (
          <div className="flex h-40 flex-col items-center justify-center gap-2 bg-neutral-100 text-xs text-neutral-500">
            <ImageOff className="size-5" />
            {t("content.preview.noImage")}
          </div>
        )}
        <div className="flex flex-col gap-1 px-3 py-2">
          <p className="text-[14px] leading-snug whitespace-pre-wrap">
            {text || <span className="text-neutral-400">{t("content.preview.noText")}</span>}
          </p>
          {time && <span className="self-end text-[11px] text-neutral-400">{time}</span>}
        </div>
      </div>
    </div>
  );
}
