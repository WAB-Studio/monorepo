import type { ReactNode } from "react";

// `i18n/request.ts` fixes the whole app on one locale — "es", no segment,
// nothing negotiated — so this is the same locale the interface already
// reads in, not a second place the app could ever disagree with itself
// about which one a number groups in.
const LOCALE = "es";

// A goal's measure is a bare sum (RP-14, `lib/queries/goal.ts`'s own
// `measureTotal`): past a few hundred it read `1000039`, all one run of
// digits with nothing to break it into groups. A plain number is the only
// shape this ever needs to dress; anything else a caller hands in — a
// string already worded, a fragment with a mark inside it — is a figure's
// business already settled by whoever built it, so it draws as is.
//
// A file of its own, never `figure.tsx` itself: that file imports its own
// `.module.css`, which only a bundler resolves — `figure.test.ts` runs under
// plain `node:test`, so the one function worth proving in isolation has to
// live somewhere a CSS import cannot follow it in.
export function formatFigureValue(value: ReactNode): ReactNode {
  return typeof value === "number" ? new Intl.NumberFormat(LOCALE).format(value) : value;
}
