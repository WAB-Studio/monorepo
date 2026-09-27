"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./bottom-nav.module.css";

// The three routes every screen stands over — `Hoy`, `Semana`, `Meta` — fixed
// here rather than configured by a screen: `app/(app)/layout.tsx` is the one place
// that mounts this, so there is only ever one nav in the tree (RNP-07's own
// floor: three equal links, each at least 48px). Labels arrive as already-
// translated strings, never a function, since a Server Component cannot hand
// this Client one anything but a serializable prop.
export function BottomNav({
  todayLabel,
  weekLabel,
  goalLabel,
}: {
  todayLabel: string;
  weekLabel: string;
  goalLabel: string;
}) {
  const pathname = usePathname();

  const items = [
    { href: "/", label: todayLabel, active: pathname === "/" },
    { href: "/semana", label: weekLabel, active: pathname.startsWith("/semana") },
    { href: "/metas", label: goalLabel, active: pathname.startsWith("/metas") },
  ];

  return (
    <nav className={styles.nav}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={item.active ? `${styles.link} ${styles.active}` : styles.link}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
