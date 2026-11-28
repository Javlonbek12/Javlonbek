import { Card, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";

// The sections of the memo, in reading order (their texts are sop.guide.sections.*).
export const GUIDE_SECTIONS = [
  "what",
  "files",
  "calendar",
  "closing",
  "frozen",
  "scrap",
  "moq",
  "factories",
  "newProducts",
  "norms",
  "caps",
  "roles",
  "final",
] as const;

// A section's text: paragraphs are split by an empty line; lines that start with «• » are a list.
function Body({ text }: { text: string }) {
  return (
    <>
      {text.split("\n\n").map((block, index) => {
        const lines = block.split("\n");
        return lines.every((line) => line.startsWith("• ")) ? (
          <ul key={index} className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
            {lines.map((line) => (
              <li key={line}>{line.slice(2)}</li>
            ))}
          </ul>
        ) : (
          <p key={index} className="text-sm">
            {block}
          </p>
        );
      })}
    </>
  );
}

// «Как вести S&OP»: the monthly process in plain words, with a list of its sections on top.
export function GuideView() {
  return (
    <div className="flex max-w-3xl flex-col gap-5 [&>*]:min-w-0">
      <p className="text-muted-foreground text-sm">{t("sop.guide.intro")}</p>
      <nav aria-label={t("sop.guide.title")}>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          {GUIDE_SECTIONS.map((key) => (
            <li key={key}>
              <a href={`#${key}`} className="text-primary underline-offset-2 hover:underline">
                {t(`sop.guide.sections.${key}.title`)}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {GUIDE_SECTIONS.map((key) => (
        <Card key={key} id={key} className="scroll-mt-20 gap-3">
          <CardTitle>{t(`sop.guide.sections.${key}.title`)}</CardTitle>
          <Body text={t(`sop.guide.sections.${key}.body`)} />
        </Card>
      ))}
    </div>
  );
}
