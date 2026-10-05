import { MarkList, SectionLabel, Text } from "@/components/ui";

export function ConsentList({
  label,
  items,
  mark,
  tone,
}: {
  label: string;
  items: string[];
  mark: string;
  tone?: "muted";
}) {
  return (
    <section>
      <SectionLabel>{label}</SectionLabel>
      <MarkList mark={mark} items={items.map((item) => ({ key: item, node: <Text tone={tone}>{item}</Text> }))} />
    </section>
  );
}
