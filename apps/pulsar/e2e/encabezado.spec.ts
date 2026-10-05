import { test, expect } from "./fixtures";
import { monthOf, nextMonth } from "@/lib/plan/months";
import { todayInZone } from "@/lib/zone";

// `ScreenHeader` (module 204, RNP-16, RNP-07): the four plan forms that had no
// way out carry the page's one `h1` and a 48px way back that names its place.

const thisMonth = monthOf(todayInZone());
const horizon = nextMonth(nextMonth(thisMonth));
const seg = (month: string) => month.slice(0, 7);

const SIZES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

for (const size of SIZES) {
  test(`each plan form has one h1 and a way back that lands on its place in one tap, at ${size.width} (RNP-16, RNP-07)`, async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const stamp = Date.now();
    const name = `Meta encabezado ${stamp}`;
    const [goal] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, measure_name, measure_unit)
      values (${person.id}, ${name}, ${horizon}::date, 'minutos', 'minutos')
      returning id
    `;
    const month = seg(thisMonth);
    const forms = [
      { path: "/metas/nueva", title: "¿Qué quieres sostener?", place: "Metas", lands: "/metas" },
      { path: `/metas/${goal.id}/compromisos/nuevo`, title: "Compromiso nuevo", place: name, lands: `/metas/${goal.id}` },
      { path: `/metas/${goal.id}/fases/nueva`, title: "Fase nueva", place: name, lands: `/metas/${goal.id}` },
      {
        path: `/metas/${goal.id}/meses/${month}/tarea/nueva`,
        title: null,
        place: null,
        lands: `/metas/${goal.id}/meses/${month}`,
      },
    ];

    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.setViewportSize(size);
      for (const form of forms) {
        await page.goto(form.path);
        const back = page.getByRole("link", { name: /^Volver a / });
        await expect(back).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        if (form.title) await expect(page.getByRole("heading", { level: 1 })).toHaveText(form.title);
        else await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("");
        if (form.place) await expect(back).toHaveAccessibleName(`Volver a ${form.place}`);

        const box = (await back.boundingBox())!;
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(48);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);

        await back.click();
        await expect(page).toHaveURL(new RegExp(`${form.lands}$`));
      }
    } finally {
      await context.close();
    }
  });
}
