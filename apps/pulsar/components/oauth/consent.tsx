"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { approveAuthorization, denyAuthorization } from "@/app/actions/oauth";
import { Button, Notice, Page, Text } from "@/components/ui";
import type { AuthorizationRequest } from "@/lib/validation/oauth";

import { ConsentList } from "./consent-list";

const MAY = ["read", "done", "write", "reorganize"] as const;
const NEVER = ["delete", "undo"] as const;

export function Consent({
  client,
  email,
  request,
}: {
  client: string;
  email: string;
  request: AuthorizationRequest;
}) {
  const t = useTranslations("oauth");
  const root = useTranslations();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(act: typeof approveAuthorization): Promise<void> {
    setWorking(true);
    setError(null);
    const result = await act(request);
    if (!result.ok) {
      setError(result.error);
      setWorking(false);
      return;
    }
    // Leaves the app: the client's own address, never a route of this one.
    window.location.assign(result.redirectTo);
  }

  return (
    <Page>
      <Text as="p" variant="meta" tone="muted">
        {t("eyebrow")}
      </Text>
      <Text asChild variant="title">
        <h1>{t("title", { client })}</h1>
      </Text>
      <ConsentList label={t("mayLabel")} items={MAY.map((key) => t(`may.${key}`))} mark="+" />
      <ConsentList label={t("neverLabel")} items={NEVER.map((key) => t(`never.${key}`))} mark="–" tone="muted" />
      {error ? <Notice role="alert">{root(error)}</Notice> : null}
      <Button tap={52} block disabled={working} onClick={() => void answer(approveAuthorization)}>
        {working ? t("working") : t("allow")}
      </Button>
      <Button variant="outline" tap={52} block disabled={working} onClick={() => void answer(denyAuthorization)}>
        {t("deny")}
      </Button>
      <Text as="p" variant="meta" tone="quiet">
        {t("footer", { email })}
      </Text>
    </Page>
  );
}
