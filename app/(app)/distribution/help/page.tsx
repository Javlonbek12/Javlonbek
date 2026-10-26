import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { currentLocale, t } from "@/lib/i18n";
import { distributionGuide } from "@/modules/distribution/guide";

// The section's instruction: the reference data first, then a campaign step by step, then the rest.
export default function DistributionHelpPage() {
  const parts = distributionGuide(currentLocale());
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <nav className="flex flex-wrap gap-2 text-sm print:hidden">
        {parts.map((part) => (
          <a
            key={part.id}
            href={`#${part.id}`}
            className="hover:bg-accent/60 rounded-full border px-3 py-1"
          >
            {part.title}
          </a>
        ))}
      </nav>
      {parts.map((part) => (
        <section key={part.id} id={part.id} className="flex scroll-mt-24 flex-col gap-3">
          <h2 className="text-lg font-semibold">{part.title}</h2>
          {part.intro && <p className="text-muted-foreground max-w-3xl text-sm">{part.intro}</p>}
          <div className="grid gap-3 lg:grid-cols-2">
            {part.steps.map((step) => (
              <Card key={step.title} className="gap-2">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{step.title}</h3>
                  {step.href && (
                    <Link
                      href={step.href}
                      className="text-primary flex shrink-0 items-center gap-1 text-xs hover:underline"
                    >
                      {t("dist.help.open")}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </div>
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-snug">
                  {step.text.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
