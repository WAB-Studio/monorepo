import Link from "next/link";
import type { ComponentProps } from "react";

import styles from "./text-link.module.css";

// docs/pulsar/DESIGN.md `SistemaPiezas`: the one link style, accent 15/500,
// underlined on hover and focus, a 48px target.
export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={className ? `${styles.link} ${className}` : styles.link} />;
}
