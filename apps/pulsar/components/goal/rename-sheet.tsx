"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { renameGoal } from "@/app/actions/plan";
import { renameGoalSchema } from "@/lib/validation/plan";
import { Button, Field, Sheet, Text } from "@/components/ui";

export type RenameGoalActionProps = {
  goalId: string;
  name: string;
};

/**
 * `Renombrar` (RP-23): a quiet text action under the goal screen's own
 * title, opening the retire sheet's shape with one field — prefilled with
 * the goal's current name, the same rules `goal.new.nameLabel`'s own field
 * carries (trimmed, required, 120 characters, `renameGoalSchema` shares
 * `createGoalSchema`'s) — and «Guardarlo» / «Dejarlo como está». Facts,
 * weeks and commitments are never touched: `name` is the one column this
 * act ever writes.
 */
export function RenameGoalAction({ goalId, name }: RenameGoalActionProps) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openSheet() {
    setValue(name);
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    if (pending) return;

    const parsed = renameGoalSchema.safeParse({ goalId, name: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setPending(true);
    setError(null);

    const result = await renameGoal(parsed.data);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <Button variant="ghost" onClick={openSheet}>
        {t("goal.detail.rename")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} label={name} title={t("plan.renameSheet.title")}>
        <Field
          label={t("goal.new.nameLabel")}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
        />
        {error ? (
          <Text as="p" tone="muted" variant="meta">
            {t(error)}
          </Text>
        ) : null}
        <Button block onClick={handleSave} disabled={pending}>
          {t("plan.renameSheet.confirm")}
        </Button>
        <Button block variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          {t("plan.renameSheet.cancel")}
        </Button>
      </Sheet>
    </>
  );
}
