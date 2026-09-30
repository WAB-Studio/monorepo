import Link from "next/link";

import { Button, Flex, Text } from "@/components/ui";

// «terminó el miércoles 23 · ver», under a goal's name (`SemanaMetaTerminada.dc.html`).
export function EndedLine({
  text,
  href,
  see,
  seeLabel,
}: {
  text: string;
  href: string;
  see: string;
  seeLabel: string;
}) {
  return (
    <Flex align="center" gap="1" wrap="wrap">
      <Text as="p" variant="meta" tone="muted">
        {text}
      </Text>
      <Button asChild tap={44} variant="ghost">
        <Link href={href} aria-label={seeLabel}>
          <Text variant="meta" tone="accent">
            {see}
          </Text>
        </Link>
      </Button>
    </Flex>
  );
}
