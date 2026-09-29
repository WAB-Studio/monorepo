import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button, Flex, Page, SectionLabel, Text } from "@/components/ui";
import { listDaylessOneOffs } from "@/lib/queries/one-offs";

import { DaylessRow } from "./dayless-row";

/**
 * The one-offs with no day (RP-21, `SueltasSinDia.dc.html`): each can be done,
 * given a day or deleted. Empty, it says so and offers the way back only.
 */
export async function DaylessScreen() {
  const t = await getTranslations();
  const oneOffs = await listDaylessOneOffs();

  const words = t.raw("day.past.countWords") as string[];
  const count = oneOffs.length;
  const caption = t(count === 1 ? "oneOffs.waitingOne" : "oneOffs.waitingMany", {
    count: words[count] ?? String(count),
  });

  return (
    <Page>
      <Flex justify="between" align="center" gap="2">
        <Text as="p" variant="meta" tone="muted">
          {t("oneOffs.kicker")}
        </Text>
        <Button asChild tap={44} variant="ghost">
          <Link href="/">
            <Text variant="meta" tone="accent">
              {t("oneOffs.toToday")}
            </Text>
          </Link>
        </Button>
      </Flex>
      <Text as="p" variant="title">
        {t("oneOffs.title")}
      </Text>
      {count === 0 ? (
        <Text as="p">{t("oneOffs.empty")}</Text>
      ) : (
        <section>
          <SectionLabel>{caption}</SectionLabel>
          {oneOffs.map((oneOff) => (
            <DaylessRow
              key={oneOff.id}
              oneOffId={oneOff.id}
              name={oneOff.name}
              goalName={oneOff.goalName?.toLocaleLowerCase("es")}
            />
          ))}
        </section>
      )}
    </Page>
  );
}
