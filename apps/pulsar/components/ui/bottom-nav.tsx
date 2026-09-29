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

// The three routes every screen stands over — `Hoy`, `Semana`, `Meta` — fixed
// here rather than configured by a screen: `app/(app)/layout.tsx` is the one place
// that mounts this, so there is only ever one nav in the tree (RNP-07's own
// floor: three equal links, each at least 48px). Labels arrive as already-
// translated strings, never a function, since a Server Component cannot hand
// this Client one anything but a serializable prop.
//
// From 1024px the same links are the desktop rail (RNP-11): the four optional
// props below fill the parts only the rail draws, and none of them renders
// below that width.
export function BottomNav({
  todayLabel,
  weekLabel,
  goalLabel,
  appName,
  goalsLabel,
  date,
  theme,
}: {
  todayLabel: string;
  weekLabel: string;
  goalLabel: string;
  appName?: string;
  // The rail names the third destination in the plural; the tab keeps `goalLabel`.
  goalsLabel?: string;
  date?: string;
  theme?: { toLightLabel: string; toDarkLabel: string };
}) {
  const pathname = usePathname();
  const unmarked = useSyncExternalStore(subscribe, readUnmarked, serverUnmarked);
  // The name's first word is the mark, the rest its mono line under it.
  const [firstWord, ...rest] = (appName ?? "").split(" ");
  const restWords = rest.join(" ");

  const items = [
    { href: "/", label: todayLabel, active: pathname === "/" || pathname.startsWith("/sueltas") },
    // A past day (`/dia/<fecha>`) is reached from the week, and stands under it.
    {
      href: "/semana",
      label: weekLabel,
      active: pathname.startsWith("/semana") || pathname.startsWith("/dia/"),
    },
    { href: "/metas", label: goalLabel, active: pathname.startsWith("/metas") },
  ];

  return (
    <nav className={styles.nav}>
      {appName ? (
        <div className={styles.brand}>
          <span className={styles.appName}>{firstWord}</span>
          {restWords ? <span className={styles.appSub}>{restWords}</span> : null}
        </div>
      ) : null}
      {items.map((item) => {
        const active = item.active && !unmarked;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={active ? `${styles.link} ${styles.active}` : styles.link}
          >
            {goalsLabel && item.href === "/metas" ? (
              <>
                <span className={styles.tab}>{item.label}</span>
                <span className={styles.railLabel}>{goalsLabel}</span>
              </>
            ) : (
              item.label
            )}
          </Link>
        );
      })}
      {date || theme ? (
        <div className={styles.foot}>
          {date ? <span className={styles.date}>{date}</span> : null}
          {theme ? <ThemeToggle {...theme} /> : null}
        </div>
      ) : null}
    </nav>
  );
}
