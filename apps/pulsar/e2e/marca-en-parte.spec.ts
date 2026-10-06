import type { Page } from "@playwright/test";

import { test, expect } from "./fixtures";

// RP-16, the stylesheet's half: the `.partial` rules of `mark.module.css` and
// `week-table.module.css` paint the accent ring and lower half. No screen
// renders a partial yet, so this does not prove the primitives map the state
// to that class; the specs of the modules that consume it do.
type Painted = { image: string; ring: string; accent: string; backgroundColor: string };

// Hashed module classes carry the source name, so the stylesheet says which
// class a state gets.
async function paint(page: Page, module: string, stateClass: string, base: string[]): Promise<Painted> {
  return page.evaluate(
    ({ module, stateClass, base }) => {
      const find = (name: string) => {
        for (const sheet of Array.from(document.styleSheets)) {
          for (const rule of Array.from(sheet.cssRules)) {
            const m = (rule as CSSStyleRule).selectorText?.match(new RegExp(`\\.(${module}[\\w-]*__${name})(?![\\w-])`));
            if (m) return m[1];
          }
        }
        return null;
      };
      const classes = [...base, stateClass].map(find);
      if (classes.some((c) => c === null)) throw new Error(`no class for ${[...base, stateClass]}`);
      const el = document.createElement("span");
      el.className = classes.join(" ");
      el.style.cssText = "display:inline-block;width:24px;height:24px;border-radius:50%";
      document.body.append(el);
      const cs = getComputedStyle(el);
      const out = {
        image: cs.backgroundImage,
        ring: cs.boxShadow,
        backgroundColor: cs.backgroundColor,
        accent: getComputedStyle(document.documentElement).getPropertyValue("--pulsar-accent").trim(),
      };
      el.remove();
      return out;
    },
    { module, stateClass, base },
  );
}

const rgb = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

for (const scheme of ["light", "dark"] as const) {
  test(`the .partial CSS rules of mark and week dot paint the accent ring and lower half on ${scheme} (RP-16)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/semana");
    await expect(page.getByRole("table")).toBeVisible();

    const accent = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--pulsar-accent)";
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });

    const dot = {
      partial: await paint(page, "week-table", "partial", ["dot"]),
      empty: await paint(page, "week-table", "empty", ["dot"]),
      declared: await paint(page, "week-table", "declared", ["dot"]),
      evidence: await paint(page, "week-table", "evidence", ["dot"]),
    };
    // The lower half is the accent, the upper transparent; the ring is the accent.
    expect(dot.partial.image).toContain("linear-gradient");
    expect(dot.partial.image).toContain(accent);
    expect(dot.partial.image).toContain("to top");
    expect(dot.partial.ring).toContain(accent);
    // Pixels differ from the other states.
    for (const other of [dot.empty, dot.declared, dot.evidence]) {
      expect(`${dot.partial.image}|${dot.partial.ring}|${dot.partial.backgroundColor}`).not.toBe(
        `${other.image}|${other.ring}|${other.backgroundColor}`,
      );
    }
    // Every other state keeps its own style.
    expect(dot.empty.image).toBe("none");
    expect(dot.declared.image).toBe("none");
    expect(dot.declared.backgroundColor).toBe(accent);
    expect(dot.evidence.ring).toContain(accent);

    await page.goto("/");
    await expect(page.getByRole("main").first()).toBeVisible();
    const mark = {
      partial: await paint(page, "mark", "partial", ["mark", "ring"]),
      empty: await paint(page, "mark", "empty", ["mark", "ring"]),
      declared: await paint(page, "mark", "declared", ["mark"]),
      evidence: await paint(page, "mark", "evidence", ["mark", "ring"]),
    };
    expect(mark.partial.image).toContain("to top");
    expect(mark.partial.image).toContain(accent);
    expect(mark.partial.ring).toContain(accent);
    for (const other of [mark.empty, mark.declared, mark.evidence]) {
      expect(`${mark.partial.image}|${mark.partial.ring}|${mark.partial.backgroundColor}`).not.toBe(
        `${other.image}|${other.ring}|${other.backgroundColor}`,
      );
    }
    expect(mark.empty.image).toBe("none");
    expect(mark.declared.image).toBe("none");
    expect(mark.declared.backgroundColor).toBe(accent);
    expect(mark.evidence.ring).toContain(accent);
    expect(rgb(scheme === "light" ? "#1C6E5A" : "#4FBEA0")).toBe(accent);
  });
}
