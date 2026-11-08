import { t } from "@/lib/i18n";

// What happened to a test notification: it is always in the app; Telegram is said as it is.
export const TEST_OUTCOMES = ["sent", "quiet", "noBot", "off", "failed"] as const;
export type TestOutcome = (typeof TEST_OUTCOMES)[number];

export function testResultText(value: unknown) {
  const outcome = TEST_OUTCOMES.find((o) => o === value);
  return outcome ? t(`notifications.test.${outcome}`) : t("team.testSent");
}
