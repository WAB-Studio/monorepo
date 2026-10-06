import { test, expect } from "./fixtures";
import { todayInZone } from "@/lib/zone";

// A row wraps by word (module 305, RNP-07): a name never breaks inside a word,
// a phrase in `trailing` keeps its longest word whole on one line, and no row
// overflows at 360px. Meta's commitment rows carry the case: «conversaciones».

const today = todayInZone();
const horizon = `${Number(today.slice(0, 4)) + 1}-${today.slice(5, 7)}-01`;

test("on Meta at 360 a commitment's «conversaciones» sits whole on one line and no row overflows", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${person.id}, ${`Meta ajuste ${stamp}`}, ${horizon}::date, now() - interval '3 days') returning id
  `;
  await db`
    insert into goals.commitments
      (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
    values (${person.id}, ${goal.id}, ${`Conversaciones de práctica con hablantes nativos ${stamp}`},
            'daily', 'quantity', 15, 'conversaciones', now() - interval '3 days')
  `;
  await db`
    insert into goals.commitments
      (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
    values (${person.id}, ${goal.id}, ${`Práctica extendida ${stamp}`},
            'daily', 'quantity', 4, 'microconversacionesdiarias', now() - interval '3 days')
  `;
  const context = await browser.newContext({
    storageState: person.sessionFile,
    baseURL: baseURL!,
    viewport: { width: 360, height: 740 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`/metas/${goal.id}`);
    for (const unit of ["conversaciones", "microconversacionesdiarias"]) {
      const phrase = page.getByText(new RegExp(`^\\d+ ${unit}$`)).first();
      await expect(phrase).toBeVisible();
      const word = await phrase.evaluate((el, unit) => {
        const node = el.firstChild as Text;
        const start = (node.textContent ?? "").indexOf(unit);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + unit.length);
        const box = el.parentElement!.parentElement!.getBoundingClientRect();
        const rect = range.getBoundingClientRect();
        console.log(JSON.stringify({ l: rect.left, r: rect.right, bl: box.left, br: box.right, w: window.innerWidth }));
        return { lines: range.getClientRects().length, inside: rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5 };
      }, unit);
      expect([word.lines, word.inside]).toEqual([1, true]);
    }

    const overflowing = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button, a"))
        .filter((el) => el.scrollWidth > el.clientWidth + 0.5)
        .map((el) => (el.textContent ?? "").trim().slice(0, 40)),
    );
    expect(overflowing).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  } finally {
    await context.close();
  }
});
