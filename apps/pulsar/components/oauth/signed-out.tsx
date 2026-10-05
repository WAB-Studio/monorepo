"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { sendSignInLink, type SendSignInLinkResult } from "@/app/actions/account";
import { Button, Field, Page, Text } from "@/components/ui";

type SendError = Extract<SendSignInLinkResult, { ok: false }>["error"];

type FormState = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; error: SendError };

// `next` is this very screen's path and query: the link brings the person back
// to say yes or no.
export function SignedOut({ client, next }: { client: string; next: string }) {
  const t = useTranslations("oauth");
  const account = useTranslations("account");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });

  async function send(): Promise<void> {
    setState({ kind: "sending" });
    const result = await sendSignInLink(email, next);
    setState(result.ok ? { kind: "sent" } : { kind: "failed", error: result.error });
  }

  return (
    <Page>
      <Text as="p" variant="meta" tone="muted">
        {t("eyebrow")}
      </Text>
      <Text asChild variant="title">
        <h1>{t("signedOut.title")}</h1>
      </Text>
      <Text as="p">{t("signedOut.body", { client })}</Text>
      {state.kind === "sent" ? (
        <Text as="p">{account("sent")}</Text>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <input type="hidden" name="next" value={next} />
          <Field
            label={t("signedOut.emailLabel")}
            placeholder={t("signedOut.emailPlaceholder")}
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            invalid={state.kind === "failed"}
            hint={state.kind === "failed" ? account(`errors.${state.error}`) : undefined}
          />
          <Button type="submit" tap={52} block disabled={state.kind === "sending"}>
            {state.kind === "sending" ? account("sending") : t("signedOut.send")}
          </Button>
        </form>
      )}
      <Text as="p" variant="meta" tone="muted">
        {t("signedOut.promise")}
      </Text>
    </Page>
  );
}
