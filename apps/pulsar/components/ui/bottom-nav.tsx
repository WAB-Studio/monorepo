"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "./theme-toggle";
import styles from "./bottom-nav.module.css";

// How many `NoTabMarked` are mounted. A store, not context: the marker is
// rendered by a not-found page beside the nav, not inside it.
let unmarkers = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const readUnmarked = () => unmarkers > 0;
const serverUnmarked = () => false;
const setUnmarkers = (change: number) => {
  unmarkers += change;
  listeners.forEach((listener) => listener());
};

// Rendered by a not-found: no tab reads as current. The `data` attribute is
// what `bottom-nav.module.css` reads from the first paint; the store is what
// drops `aria-current` once the page hydrates.
export function NoTabMarked() {
  useEffect(() => {
    setUnmarkers(1);
    return () => setUnmarkers(-1);
  }, []);

  return <span hidden data-no-tab-marked />;
}

// How wide the screen is, as the CSS reads it: from 1024px the nav is the
// rail and a goal's own pages mark that goal's item, below it they mark `Metas`.
const WIDE = "(min-width: 1024px)";
const subscribeWide = (listener: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const readWide = () => window.matchMedia(WIDE).matches;
const serverWide = () => false;

// The four routes every screen stands over — `Hoy`, `Semana`, `Mes`, `Metas` —
// fixed here rather than configured by a screen: `app/(app)/layout.tsx` is the
// one place that mounts this, so there is only ever one nav in the tree
// (RNP-07's own floor: four equal links, each at least 48px). Labels arrive as
// already-translated strings, never a function, since a Server Component cannot
// hand this Client one anything but a serializable prop.
//
// From 1024px the same links are the desktop rail (RNP-11): the props below
// `labels` fill the parts only the rail draws, and none of them renders below
// that width. The visual mark of a goal's page is CSS from the first paint;
// `aria-current` follows the width once the page hydrates.
export function BottomNav({
  labels,
  appName,
  date,
  theme,
  goals = [],
  goalsSectionLabel,
}: {
  labels: { today: string; week: string; month: string; goals: string };
  appName?: string;
  date?: string;
  theme?: { toLightLabel: string; toDarkLabel: string };
  goals?: { id: string; name: string }[];
  goalsSectionLabel?: string;
}) {
  const pathname = usePathname();
  const unmarked = useSyncExternalStore(subscribe, readUnmarked, serverUnmarked);
  const wide = useSyncExternalStore(subscribeWide, readWide, serverWide);
  // The name's first word is the mark, the rest its mono line under it.
  const [firstWord, ...rest] = (appName ?? "").split(" ");
  const restWords = rest.join(" ");

  const openGoal = goals.find(
    (goal) => pathname === `/metas/${goal.id}` || pathname.startsWith(`/metas/${goal.id}/`),
  );
  // `/conexiones` hangs from Metas: no tab of its own, so it marks that one.
  const onGoals = pathname.startsWith("/metas") || pathname.startsWith("/conexiones");

  const items = [
    { href: "/", label: labels.today, active: pathname === "/" || pathname.startsWith("/sueltas") },
    // A past day (`/dia/<fecha>`) is reached from the week, and stands under it.
    {
      href: "/semana",
      label: labels.week,
      active: pathname.startsWith("/semana") || pathname.startsWith("/dia/"),
    },
    { href: "/mes", label: labels.month, active: pathname === "/mes" },
    { href: "/metas", label: labels.goals, active: onGoals },
  ];

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        {appName ? (
          <div className={styles.brand}>
            <span className={styles.appName}>{firstWord}</span>
            {restWords ? <span className={styles.appSub}>{restWords}</span> : null}
          </div>
        ) : null}
        {items.map((item) => {
          // From 1024 a goal of the list owns its pages' mark; `Metas` keeps
          // the visual mark below that width only.
          const owned = item.href === "/metas" && openGoal !== undefined;
          const marked = item.active && !unmarked;
          const current = marked && !(owned && wide);
          const className = !marked
            ? styles.link
            : owned
              ? `${styles.link} ${styles.activeNarrow}`
              : `${styles.link} ${styles.active}`;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={className}
            >
              {item.label}
            </Link>
          );
        })}
        {goals.length > 0 && goalsSectionLabel ? (
          <>
            <div className={styles.sectionLabel}>{goalsSectionLabel}</div>
            <div
              role="region"
              aria-label={goalsSectionLabel}
              tabIndex={0}
              className={styles.goals}
            >
              {goals.map((goal) => {
                const current = openGoal?.id === goal.id && !unmarked;
                return (
                  <Link
                    key={goal.id}
                    href={`/metas/${goal.id}`}
                    title={goal.name}
                    aria-current={current && wide ? "page" : undefined}
                    className={current ? `${styles.goal} ${styles.goalActive}` : styles.goal}
                  >
                    <span className={styles.goalName}>{goal.name}</span>
                  </Link>
                );
              })}
            </div>
          </>
        ) : null}
        {date || theme ? (
          <div className={styles.foot}>
            {date ? <span className={styles.date}>{date}</span> : null}
            {theme ? <ThemeToggle {...theme} /> : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
