"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { createAccessToken, revokeAccessToken } from "@/app/actions/tokens";
import {
  Button,
  CodeBlock,
  Field,
  Flex,
  Notice,
  Page,
  ScreenHeader,
  SectionLabel,
  Separator,
  Text,
} from "@/components/ui";
import { type MessageKey } from "@/i18n/translator";

import { RevokeSheet } from "./revoke-sheet";

export type ConnectionRow = {
  id: string;
  kind: "personal" | "oauth";
  name: string;
  revoked: boolean;
  meta: string;
};

type Created = { name: string; key: string };

function Copyable({ text, label }: { text: string; label: string }) {
  const t = useTranslations("connections");

  return (
    <Flex align="center" gap="3">
      <CodeBlock>{text}</CodeBlock>
      <Button
        variant="outline"
        tap={44}
        aria-label={label}
        onClick={() => void navigator.clipboard.writeText(text).catch(() => {})}
      >
        {t("connector.copy")}
      </Button>
    </Flex>
  );
}

function Keys({ rows, section, onAsk, busy }: {
  rows: ConnectionRow[];
  section: string;
  onAsk: (row: ConnectionRow) => void;
  busy: boolean;
}) {
  const t = useTranslations("connections");

  return (
    <section>
      <SectionLabel>{section}</SectionLabel>
      {rows.map((row) => (
        <div key={row.id}>
          <Separator />
          <Flex align="center" justify="between" gap="3">
            <Flex direction="column" gap="1">
              <Text variant="name" tone={row.revoked ? "muted" : undefined}>
                {row.name}
              </Text>
              <Text variant="meta" tone="muted">
                {row.meta}
              </Text>
            </Flex>
            {row.revoked ? null : (
              <Button variant="outline" tap={44} disabled={busy} onClick={() => onAsk(row)}>
                {t("row.revoke")}
              </Button>
            )}
          </Flex>
        </div>
      ))}
    </section>
  );
}

/**
 * `/conexiones` (RP-38): the list of keys and connections, the form that mints
 * one, and the one render that shows its value. The key is state, never props
 * and never storage: leaving or refreshing the page loses it for good (RNP-11).
 */
export function ConnectionsScreen({ rows, siteUrl }: { rows: ConnectionRow[]; siteUrl: string }) {
  const t = useTranslations("connections");
  const root = useTranslations();
  const router = useRouter();
  const [created, setCreated] = useState<Created | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [asked, setAsked] = useState<ConnectionRow | null>(null);
  const [pending, startTransition] = useTransition();

  const keys = rows.filter((row) => row.kind === "personal");
  const connected = rows.filter((row) => row.kind === "oauth");
  const place = { href: "/metas", place: useTranslations("common.nav")("goals") };
  const eyebrow = (
    <Text as="p" variant="meta" tone="muted">
      {t("eyebrow")}
    </Text>
  );

  function create() {
    startTransition(async () => {
      const result = await createAccessToken({ name });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setName("");
      setCreated({ name: name.trim(), key: result.key });
    });
  }

  function revoke(id: string) {
    startTransition(async () => {
      // Zero rows reads as «already revoked»: either way the list is refreshed.
      await revokeAccessToken({ tokenId: id });
      setAsked(null);
      router.refresh();
    });
  }

  if (created) {
    const command = t("created.claudeCode", { url: siteUrl, key: created.key });
    return (
      <Page>
        <ScreenHeader title={t("created.title")} back={place} eyebrow={eyebrow} />
        <Notice role="note">{t("created.once")}</Notice>
        <section>
          <SectionLabel>{created.name}</SectionLabel>
          <Copyable text={created.key} label={t("created.copyName")} />
        </section>
        <section>
          <SectionLabel>{t("created.terminal")}</SectionLabel>
          <Copyable text={command} label={t("created.copyCommandName")} />
          <Text as="p" variant="meta" tone="muted">
            {t("created.connected")}
          </Text>
        </section>
        <Button variant="outline" tap={52} block onClick={() => setCreated(null)}>
          {t("created.done")}
        </Button>
      </Page>
    );
  }

  const form = (
    <section>
      <SectionLabel>{keys.length > 0 || connected.length > 0 ? t("sections.another") : t("sections.first")}</SectionLabel>
      <Field
        label={t("nameLabel")}
        placeholder={t("namePlaceholder")}
        hint={error ? root(error) : t("nameHint")}
        invalid={error !== null}
        value={name}
        disabled={pending}
        onChange={(event) => setName(event.target.value)}
      />
      <Button tap={52} block disabled={pending} aria-busy={pending || undefined} onClick={create}>
        {pending ? t("creating") : t("create")}
      </Button>
    </section>
  );

  return (
    <Page>
      <ScreenHeader title={t("title")} back={place} eyebrow={eyebrow} />
      <Text as="p">{t("intro")}</Text>
      {keys.length > 0 ? <Keys rows={keys} section={t("sections.keys")} onAsk={setAsked} busy={pending} /> : null}
      {connected.length > 0 ? (
        <Keys rows={connected} section={t("sections.oauth")} onAsk={setAsked} busy={pending} />
      ) : null}
      {form}
      <RevokeSheet
        open={asked !== null}
        onOpenChange={(open) => {
          if (!open) setAsked(null);
        }}
        name={asked?.name ?? ""}
        kind={asked?.kind ?? "personal"}
        onConfirm={() => asked && revoke(asked.id)}
        busy={pending}
      />
      <section>
        <SectionLabel>{t("sections.connector")}</SectionLabel>
        <Text as="p" variant="meta" tone="muted">
          {t("connector.note")}
        </Text>
        <Copyable text={`${siteUrl}/mcp`} label={t("connector.copyName")} />
      </section>
    </Page>
  );
}
