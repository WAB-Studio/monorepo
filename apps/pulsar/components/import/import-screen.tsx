"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { readSource, saveDraft } from "@/lib/import/draft-store";
import type { ImportDraft } from "@/lib/import/draft";
import { Button, CodeBlock, FilePick, Flex, Notice, Page, SectionLabel, Text, TextArea } from "@/components/ui";
import { messageKey, type MessageKey } from "@/i18n/translator";

const MAX_BYTES = 4 * 1024 * 1024;

// The keys `/importar/leer` answers; anything else reads as the model failing,
// so a key a build does not know never reaches `t`.
const KNOWN_ERRORS = new Set([
  "import.errors.signedOut",
  "import.errors.tooBig",
  "import.errors.unreadableType",
  "import.errors.noKey",
  "import.errors.cap",
  "import.errors.empty",
  "import.errors.modelFailed",
  "import.errors.modelInvalid",
]);

type Failure =
  | { kind: "templateLine"; line: number; expected: string; text: string }
  | { kind: "key"; key: MessageKey; values?: Record<string, string> };

const subscribeNothing = () => () => {};

// What each failure draws: where its box sits and what it offers next.
function placement(failure: Failure) {
  if (failure.kind === "templateLine") return { place: "below", template: true } as const;
  switch (failure.key) {
    case "import.errors.noKey":
    case "import.errors.cap":
      return { place: "top", template: true } as const;
    case "import.errors.empty":
    case "import.errors.modelFailed":
    case "import.errors.modelInvalid":
      return { place: "below", template: true } as const;
    default:
      return { place: "upload", template: false } as const;
  }
}

/**
 * `/metas/importar` (RP-37, RNP-13): a pasted text or one file goes to
 * `/importar/leer`, and its draft is carried to the review. Every failure keeps
 * the text. The privacy line sits above «Leer el plan» in every state.
 */
export function ImportScreen() {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  // Storage is the client's: the server snapshot is the empty box, and the
  // stored text shows once hydrated. What the person types wins from then on.
  const stored = useSyncExternalStore(subscribeNothing, () => readSource() ?? "", () => "");
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? stored;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [showTemplate, setShowTemplate] = useState(true);
  const [copied, setCopied] = useState(false);

  const placed = failure ? placement(failure) : null;
  // The key and the cap shut the model; the template still reads.
  const modelShut =
    failure?.kind === "key" && (failure.key === "import.errors.noKey" || failure.key === "import.errors.cap");
  const retry = failure?.kind === "key" && failure.key.startsWith("import.errors.model");

  function fail(next: Failure) {
    setFailure(next);
    setShowTemplate(false);
  }

  // `source` is the text a template line is quoted from; `saved` is what the box holds again next time.
  async function send(form: FormData, source: string, saved: string | null) {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch("/importar/leer", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        line?: number;
        expected?: string;
        via?: "template" | "model";
        draft?: ImportDraft;
      } | null;

      if (response.ok && body?.draft && body.via) {
        saveDraft({ via: body.via, draft: body.draft, source: saved });
        router.push("/metas/importar/revisar");
        return;
      }
      if (body?.error === "import.errors.templateLine" && body.line && body.expected) {
        fail({
          kind: "templateLine",
          line: body.line,
          expected: body.expected,
          text: source.split("\n")[body.line - 1] ?? "",
        });
      } else if (body?.error && KNOWN_ERRORS.has(body.error)) {
        fail({ kind: "key", key: messageKey(body.error) });
      } else {
        fail({ kind: "key", key: "import.errors.modelFailed" });
      }
    } catch {
      fail({ kind: "key", key: "import.errors.modelFailed" });
    } finally {
      setBusy(false);
    }
  }

  function readText() {
    if (busy) return;
    const form = new FormData();
    form.set("text", text);
    void send(form, text, text);
  }

  async function readFile(file: File) {
    if (busy) return;
    if (file.size > MAX_BYTES) {
      fail({
        kind: "key",
        key: "import.errors.tooBigNamed",
        values: {
          file: file.name,
          size: t("import.size", { value: format.number(file.size / (1024 * 1024), { maximumFractionDigits: 1 }) }),
        },
      });
      return;
    }
    const form = new FormData();
    form.set("file", file);
    // Only a text file can fail on a template line; its text is the line's source.
    const binary = file.type === "application/pdf" || file.type.startsWith("image/") || /\.pdf$/i.test(file.name);
    await send(form, binary ? "" : await file.text().catch(() => ""), null);
  }

  function copyTemplate() {
    void navigator.clipboard
      .writeText(t("import.template.example"))
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }

  const notice = failure ? (
    <Notice>
      {failure.kind === "templateLine"
        ? t("import.errors.templateLine", {
            line: failure.line,
            text: failure.text,
            expected: failure.expected,
          })
        : t(failure.key, failure.values)}
    </Notice>
  ) : null;

  return (
    <Page>
      <div>
        <Text as="p" variant="meta" tone="muted">
          {t("import.eyebrow")}
        </Text>
        <Text as="p" variant="title">
          {t("import.title")}
        </Text>
      </div>

      {placed?.place === "top" ? notice : null}

      <TextArea
        label={t("import.textLabel")}
        placeholder={t("import.placeholder")}
        rows={failure ? 8 : 10}
        value={text}
        disabled={busy}
        invalid={failure?.kind === "templateLine"}
        onChange={(event) => setTyped(event.target.value)}
      />

      <FilePick
        label={t("import.upload")}
        hint={t("import.uploadHint")}
        disabled={busy || modelShut}
        onPick={(file) => void readFile(file)}
      />

      {placed?.place === "upload" ? notice : null}

      <Text as="p" variant="meta" tone="muted">
        {t("import.privacy")}
      </Text>

      {placed?.place === "below" ? notice : null}

      <Button block onClick={readText} disabled={busy} aria-busy={busy || undefined}>
        {busy ? t("import.reading") : retry ? t("import.retry") : t("import.read")}
      </Button>
      {busy ? (
        <Text as="p" variant="meta" tone="muted">
          {t("import.slow")}
        </Text>
      ) : null}

      {placed?.template && !showTemplate ? (
        <Button variant="ghost" tone="accent" onClick={() => setShowTemplate(true)}>
          {t("import.template.show")}
        </Button>
      ) : null}

      {showTemplate ? (
        <Flex asChild direction="column" gap="2" align="start">
          <section aria-label={t("import.template.label")}>
            <SectionLabel>{t("import.template.label")}</SectionLabel>
            <Text as="p" variant="meta" tone="muted">
              {t("import.template.note")}
            </Text>
            <CodeBlock>{t("import.template.example")}</CodeBlock>
            <Button variant="ghost" tone="accent" onClick={copyTemplate}>
              {copied ? t("import.template.copied") : t("import.template.copy")}
            </Button>
          </section>
        </Flex>
      ) : null}
    </Page>
  );
}
