"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { addCommitment } from "@/app/actions/plan";
import { addCommitmentSchema, type AddCommitmentInput } from "@/lib/validation/plan";
import { Button, Chip, Field, Flex, Page, ScreenHeader, SectionLabel, Text } from "@/components/ui";

export type CommitmentFormProps = {
  goalId: string;
  goalName: string;
  // Whether the goal already names a measure (§0.3, 3): only matters while
  // `satisfaction === "quantity"`, to say the unit typed here is the one
  // that sets it.
  hasMeasure: boolean;
  // The evidence catalogue (RP-07, RNP-10), read off `goals.evidence_sources`
  // by the page: a second source is a seeded row, never a case this form
  // hardcodes.
  sources: { key: string; labelKey: string; unit: string }[];
};

// RP-12's five cadences (`lib/day/types.ts`'s `Cadence`), in the order of
// `CompromisoNuevoMes.dc.html`.
const CADENCE_KINDS = ["daily", "weekdays", "times_per_week", "every_n_days", "times_per_month"] as const;
type CadenceKind = (typeof CADENCE_KINDS)[number];

const SATISFACTION_KINDS = ["tap", "quantity", "evidence"] as const;
type SatisfactionKind = (typeof SATISFACTION_KINDS)[number];

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * `CompromisoNuevo.dc.html` (RP-12): what it is, how often, what gives it for
 * done. Drives `addCommitment` (module 11) over its own Zod schema
 * (`lib/validation/plan.ts`), parsed here first so a bound the server would
 * refuse never leaves the device — the same shape `NewGoalForm` already
 * takes. No new server code.
 */
export function CommitmentForm({ goalId, goalName, hasMeasure, sources }: CommitmentFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [cadenceKind, setCadenceKind] = useState<CadenceKind>("daily");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [cadenceN, setCadenceN] = useState("");
  const [satisfaction, setSatisfaction] = useState<SatisfactionKind>("tap");
  const [targetQuantity, setTargetQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? "");
  const [threshold, setThreshold] = useState("1");

  const weekdayShort = t.raw("day.cadence.weekdayShort") as string[];

  function toggleWeekday(day: number) {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort(),
    );
  }

  function buildInput(): AddCommitmentInput | null {
    const cadence =
      cadenceKind === "daily"
        ? ({ cadenceKind: "daily" } as const)
        : cadenceKind === "weekdays"
          ? ({ cadenceKind: "weekdays", cadenceWeekdays: weekdays } as const)
          : cadenceKind === "times_per_week"
            ? ({ cadenceKind: "times_per_week", cadenceN: Number(cadenceN) } as const)
            : cadenceKind === "every_n_days"
              ? ({ cadenceKind: "every_n_days", cadenceN: Number(cadenceN) } as const)
              : ({ cadenceKind: "times_per_month", cadenceN: Number(cadenceN) } as const);

    const done =
      satisfaction === "tap"
        ? ({ satisfaction: "tap" } as const)
        : satisfaction === "quantity"
          ? ({ satisfaction: "quantity", targetQuantity: Number(targetQuantity), unit } as const)
          : ({ satisfaction: "evidence", sourceKey, threshold: Number(threshold) } as const);

    const parsed = addCommitmentSchema.safeParse({ goalId, name, ...cadence, ...done });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return null;
    }
    return parsed.data;
  }

  function handleSubmit() {
    if (pending) return;
    setError(null);

    const input = buildInput();
    if (!input) return;

    startTransition(() => {
      void addCommitment(input).then((result) => {
        if (result.ok) {
          router.push(`/metas/${goalId}`);
          router.refresh();
        } else {
          setError(result.error);
        }
      });
    });
  }

  const trimmedUnit = unit.trim();

  return (
    <Page>
      <ScreenHeader title={t("plan.commitmentForm.title")} back={{ href: `/metas/${goalId}`, place: goalName }} />

      <Field
        label={t("plan.commitmentForm.whatLabel")}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />

      <section>
        <Flex direction="column" gap="3">
          <SectionLabel>{t("plan.commitmentForm.whenLabel")}</SectionLabel>
          <Flex gap="2" wrap="wrap">
            {CADENCE_KINDS.map((kind) => (
              <Chip key={kind} selected={cadenceKind === kind} onClick={() => setCadenceKind(kind)}>
                {t(`plan.commitmentForm.cadence.${kind}`)}
              </Chip>
            ))}
          </Flex>

          {cadenceKind === "weekdays" ? (
            <Flex gap="1">
              {WEEKDAYS.map((day) => (
                <Chip
                  key={day}
                  shape="day"
                  mono
                  selected={weekdays.includes(day)}
                  onClick={() => toggleWeekday(day)}
                >
                  {weekdayShort[day - 1]}
                </Chip>
              ))}
            </Flex>
          ) : null}

          {cadenceKind === "times_per_week" ? (
            <Field
              label={t("plan.commitmentForm.timesPerWeekLabel")}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={cadenceN}
              onChange={(event) => setCadenceN(event.target.value)}
            />
          ) : null}

          {cadenceKind === "every_n_days" ? (
            <Field
              label={t("plan.commitmentForm.everyNDaysLabel")}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={cadenceN}
              onChange={(event) => setCadenceN(event.target.value)}
            />
          ) : null}

          {cadenceKind === "times_per_month" ? (
            <Field
              label={t("plan.commitmentForm.timesPerMonthLabel")}
              hint={t("plan.commitmentForm.timesPerMonthHint")}
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              step={1}
              value={cadenceN}
              onChange={(event) => setCadenceN(event.target.value)}
            />
          ) : null}
        </Flex>
      </section>

      <section>
        <Flex direction="column" gap="3">
          <SectionLabel>{t("plan.commitmentForm.doneByLabel")}</SectionLabel>
          <Flex gap="2" wrap="wrap">
            {SATISFACTION_KINDS.filter((kind) => kind !== "evidence" || sources.length > 0).map((kind) => (
              <Chip key={kind} selected={satisfaction === kind} onClick={() => setSatisfaction(kind)}>
                {t(`plan.commitmentForm.satisfaction.${kind}`)}
              </Chip>
            ))}
          </Flex>

          {satisfaction === "quantity" ? (
            <>
              <Flex gap="2">
                <Field
                  label={t("plan.commitmentForm.quantityLabel")}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={targetQuantity}
                  onChange={(event) => setTargetQuantity(event.target.value)}
                  style={{ maxWidth: 88 }}
                />
                <Field
                  label={t("plan.commitmentForm.unitLabel")}
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  style={{ flex: 1 }}
                />
              </Flex>
              {!hasMeasure && trimmedUnit.length > 0 ? (
                <Text as="p" variant="meta" tone="muted">
                  {t("plan.commitmentForm.noMeasureYet", { unit: trimmedUnit })}
                </Text>
              ) : null}
            </>
          ) : null}

          {satisfaction === "evidence" ? (
            <>
              <Flex gap="2" wrap="wrap">
                {sources.map((source) => (
                  <Chip key={source.key} selected={sourceKey === source.key} onClick={() => setSourceKey(source.key)}>
                    {t(source.labelKey)}
                  </Chip>
                ))}
              </Flex>
              <Field
                label={t("plan.commitmentForm.thresholdLabel")}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
              />
            </>
          ) : null}
        </Flex>
      </section>

      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}

      <Button block onClick={handleSubmit} disabled={pending}>
        {t("plan.commitmentForm.submit")}
      </Button>
    </Page>
  );
}
