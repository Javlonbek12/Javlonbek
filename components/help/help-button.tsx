import { askHelpAction } from "@/app/(app)/help-actions";
import { isAiConfigured } from "@/modules/ai/client";

import { HelpLauncher } from "./help-launcher";

// The AI help button for the header (a server component: render it in app/(app)/layout.tsx and
// pass it to the header as a slot). Not shown when AI is not set up.
export function HelpButton({ className }: { className?: string }) {
  if (!isAiConfigured()) return null;
  return <HelpLauncher ask={askHelpAction} className={className} />;
}
