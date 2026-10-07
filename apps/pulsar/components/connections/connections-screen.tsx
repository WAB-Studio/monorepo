"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { createAccessToken, revokeAccessToken } from "@/app/actions/tokens";
import {
  Button,
  CodeBlock,
  Field,
  Figure,
  Flex,
  Notice,
  Page,
  ScreenHeader,
  Section,
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

type CopyState = "idle" | "copied" | "failed";

const COPIED_MS = 2000;

// The page marks each figure and date of a line with `<fig>`; they print in mono, the rest in Archivo.
function figures(line: string): ReactNode[] {
  return line
    .split(/<fig>(.*?)<\/fig>/)
    .map((part, index) => (index % 2 === 1 ? <Figure key={index} variant="meta" value={part} /> : part));
}

function Copyable({ text, label }: { text: string; label: string }) {
  const t = useTranslations("connections");
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="3">
        <CodeBlock>{text}</CodeBlock>
        <Button variant="outline" tap={44} aria-label={label} onClick={() => void copy()}>
          {t("connector.copy")}
        </Button>
      </Flex>
      {state === "idle" ? null : (
        <Text as="p" variant="sentence" role="status" aria-live="polite" tone={state === "copied" ? "accent" : "muted"}>
          {state === "copied" ? (
            <Flex as="span" align="center" gap="1">
              <Check size={14} strokeWidth={2} aria-hidden />
              {t("connector.copied")}
            </Flex>
          ) : (
            t("connector.copyFailed")
          )}
        </Text>
      )}
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
    <Section label={section}>
      {rows.map((row) => (
        <div key={row.id}>
          <Separator />
          <Flex align="center" justify="between" gap="3" py="3" minHeight="56px">
            <Flex direction="column" gap="1">
              <Text variant="name" tone={row.revoked ? "muted" : undefined}>
                {row.name}
              </Text>
              <Text variant="sentence">{figures(row.meta)}</Text>
            </Flex>
            {row.revoked ? null : (
              <Button variant="outline" tap={44} disabled={busy} onClick={() => onAsk(row)}>
                {t("row.revoke")}
              </Button>
            )}
          </Flex>
        </div>
      ))}
    </Section>
  );
}

/**
 * `/conexiones` (RP-38): the list of keys and connections, the form that mints
 * one, and the one render that shows its value. The key is state, never props
 * and never storage: leaving or refreshing the page loses it for good (RNP-17).
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
        <ScreenHeader title={t("created.title")} back={place} />
        <Notice role="note">{t("created.once")}</Notice>
        <Section label={t("sections.keys")}>
          <Text variant="name">{created.name}</Text>
          <Copyable text={created.key} label={t("created.copyName")} />
        </Section>
        <Section label={t("created.terminal")}>
          <Copyable text={command} label={t("created.copyCommandName")} />
          <Text as="p" variant="sentence" tone="muted">
            {t("created.connected")}
          </Text>
        </Section>
        <Button variant="outline" tap={52} block onClick={() => setCreated(null)}>
          {t("created.done")}
        </Button>
      </Page>
    );
  }

  const form = (
    <Section label={keys.length > 0 || connected.length > 0 ? t("sections.another") : t("sections.first")}>
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
    </Section>
  );

  return (
    <Page>
      <ScreenHeader title={t("title")} back={place} />
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
      <Section label={t("sections.connector")}>
        <Text as="p" variant="sentence" tone="muted">
          {t("connector.note")}
        </Text>
        <Copyable text={`${siteUrl}/mcp`} label={t("connector.copyName")} />
      </Section>
    </Page>
  );
}
