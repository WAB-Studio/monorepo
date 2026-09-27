import type { ReactNode } from "react";
import { Archivo, DM_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Theme } from "@radix-ui/themes";

import { BottomNav } from "@/components/ui";
import { ThemeScript } from "@/components/theme-script";
import { getPerson } from "@/lib/session";
import "@radix-ui/themes/styles.css";
import "./theme.css";

// Sentences, headings, commitment names and controls (docs/pulsar/DESIGN.md "Type").
const sans = Archivo({
  variable: "--font-sans",
  subsets: ["latin"],
  fallback: ["system-ui", "sans-serif"],
  display: "swap",
});

// Every figure: hours, counts, minutes, dates and quantities.
const mono = DM_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  fallback: ["ui-monospace", "monospace"],
  display: "swap",
});

export default async function RootLayout({ children }: { children: ReactNode }) {
  // No round trip: the same verified-JWT read every page's own gate already
  // pays for. A signed-out person sees `/entrar` alone — the nav names three
  // routes that would only bounce them straight back to it.
  const person = await getPerson();
  const t = await getTranslations("common.nav");

  return (
    <html
      lang="es"
      className={`${sans.variable} ${mono.variable}`}
      // The inline script below writes the theme class here before hydration.
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        <NextIntlClientProvider>
          <Theme accentColor="teal" grayColor="slate" radius="large" scaling="100%">
            {children}
            {person ? (
              <BottomNav todayLabel={t("today")} weekLabel={t("week")} goalLabel={t("goal")} />
            ) : null}
          </Theme>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
