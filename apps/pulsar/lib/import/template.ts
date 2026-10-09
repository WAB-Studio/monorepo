import { isTimeUnit, parseTime } from "@/lib/units/time";

import { importDraftSchema, type ImportDraft } from "./draft";

// The grammar is docs/pulsar/PLANTILLA.md's.
export const TEMPLATE_HEADER = "pulsar · plantilla 1";

export type TemplateResult =
  | { matched: false }
  | { matched: true; draft: ImportDraft }
  | { matched: true; error: { line: number; expected: string } };

type Goal = ImportDraft["goals"][number];
type Commitment = Goal["commitments"][number];
type Task = Goal["tasks"][number];

// The form of a line, shown as `expected`: syntax, not prose.
const FORMS = {
  goal: "import.errors.form.goal",
  horizon: "import.errors.form.horizon",
  measure: "import.errors.form.measure",
  rhythmPlace: "import.errors.form.rhythmPlace",
  rhythmUnit: "import.errors.form.rhythmUnit",
  rhythmAmount: "import.errors.form.rhythmAmount",
  section: "import.errors.form.section",
  phase: "import.errors.form.phase",
  month: "import.errors.form.month",
  commitment: "import.errors.form.commitment",
  task: "import.errors.form.task",
  child: "import.errors.form.child",
  note: "import.errors.form.note",
} as const;

const SECTIONS = { "## Fases": "phases", "## Meses": "months", "## Compromisos": "commitments", "## Tareas": "tasks" } as const;
type Section = (typeof SECTIONS)[keyof typeof SECTIONS];

const WEEKDAYS: Record<string, number> = {
  lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5,
  sábado: 6, sabado: 6, sábados: 6, sabados: 6, domingo: 7, domingos: 7,
};

type Cadence = Pick<Commitment, "cadenceKind" | "cadenceWeekdays" | "cadenceN">;

function parseCadence(text: string): Cadence | null {
  const t = text.trim().toLowerCase();
  if (t === "cada día" || t === "todos los días") {
    return { cadenceKind: "daily", cadenceWeekdays: null, cadenceN: null };
  }
  let m = /^cada (\d+) días?$/.exec(t);
  if (m) return { cadenceKind: "every_n_days", cadenceWeekdays: null, cadenceN: Number(m[1]) };
  m = /^(\d+) (?:vez|veces) por semana$/.exec(t);
  if (m) return { cadenceKind: "times_per_week", cadenceWeekdays: null, cadenceN: Number(m[1]) };
  m = /^(\d+) (?:vez|veces) al mes$/.exec(t);
  if (m) return { cadenceKind: "times_per_month", cadenceWeekdays: null, cadenceN: Number(m[1]) };
  const days = t.split(/\s*,\s*|\s+y\s+/).map((name) => WEEKDAYS[name]);
  if (days.length === 0 || days.some((d) => d === undefined)) return null;
  return { cadenceKind: "weekdays", cadenceWeekdays: [...new Set(days)].sort((a, b) => a - b), cadenceN: null };
}

// Minutes through `parseTime` for a time unit, else a whole number.
function parseAmount(text: string, timeUnit: boolean): number | null {
  const t = text.trim();
  if (timeUnit) return parseTime(t);
  return /^\d+$/.test(t) ? Number(t) : null;
}

type Spot = { line: number; expected: string };

export function parseTemplate(text: string): TemplateResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trimEnd());
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first === -1 || lines[first] !== TEMPLATE_HEADER) return { matched: false };

  const fail = (line: number, expected: string): TemplateResult => ({
    matched: true,
    error: { line, expected },
  });

  const goals: Goal[] = [];
  // Where each part of the draft was written, so a schema issue finds its line.
  const spots = new Map<string, Spot>();
  let section: Section | null = null;
  let lastTask: Task | null = null;
  let lastTaskPath = "";
  // Where a `nota:` line may land: the task just read, or its latest sub-task.
  let noteOwner: { depth: 2 | 4; into: { note?: string | null } } | null = null;
  let needsHorizon: { line: number } | null = null;
  // Whether the line just read was `medida:`, the only place `ritmo:` may follow.
  let afterMeasure = false;

  for (let i = first + 1; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    if (line.trim() === "") continue;
    const followsMeasure = afterMeasure;
    afterMeasure = false;
    const g = goals.length - 1;
    const goal = goals[g] as Goal | undefined;
    const at = `goals.${g}`;

    if (line.startsWith("# ")) {
      if (needsHorizon) return fail(needsHorizon.line, FORMS.horizon);
      const name = line.slice(2).trim();
      goals.push({ name, horizon: "", measure: null, rhythm: null, phases: [], months: [], commitments: [], tasks: [] });
      spots.set(`goals.${g + 1}`, { line: n, expected: FORMS.goal });
      needsHorizon = { line: n };
      section = null;
      lastTask = null;
      noteOwner = null;
      continue;
    }
    if (!goal) return fail(n, FORMS.goal);

    if (line.startsWith("ritmo:")) {
      const minutes = goal.measure !== null && isTimeUnit(goal.measure.unit) ? /^ritmo: (.+)$/.exec(line) : null;
      const amount = followsMeasure && section === null && minutes ? parseTime(minutes[1]) : null;
      if (amount === null) {
        if (goal.measure === null || !isTimeUnit(goal.measure.unit)) return fail(n, FORMS.rhythmUnit);
        return fail(n, followsMeasure && section === null ? FORMS.rhythmAmount : FORMS.rhythmPlace);
      }
      goal.rhythm = amount;
      spots.set(`${at}.rhythm`, { line: n, expected: FORMS.rhythmPlace });
      continue;
    }

    const note = /^( {2}| {4})nota:(?: (.*))?$/.exec(line);
    if (note) {
      const depth = note[1].length as 2 | 4;
      if (section !== "tasks" || noteOwner === null || noteOwner.depth !== depth) return fail(n, FORMS.note);
      const into = noteOwner.into;
      into.note = into.note === undefined ? (note[2] ?? "") : `${into.note}\n${note[2] ?? ""}`;
      const key = `${depth === 2 ? lastTaskPath : `${lastTaskPath}.children.${lastTask!.children.length - 1}`}.note`;
      if (!spots.has(key)) spots.set(key, { line: n, expected: FORMS.note });
      continue;
    }

    if (section === null) {
      const horizon = /^horizonte: (\S+)$/.exec(line);
      if (horizon) {
        goal.horizon = horizon[1];
        spots.set(`${at}.horizon`, { line: n, expected: FORMS.horizon });
        needsHorizon = null;
        continue;
      }
      const measure = /^medida: (.+?) · (.+)$/.exec(line);
      if (measure) {
        goal.measure = { name: measure[1].trim(), unit: measure[2].trim() };
        spots.set(`${at}.measure`, { line: n, expected: FORMS.measure });
        afterMeasure = true;
        continue;
      }
    }

    if (line.startsWith("## ")) {
      const next = SECTIONS[line as keyof typeof SECTIONS];
      if (!next) return fail(n, FORMS.section);
      if (needsHorizon) return fail(needsHorizon.line, FORMS.horizon);
      section = next;
      lastTask = null;
      noteOwner = null;
      continue;
    }
    if (section === null) return fail(n, needsHorizon ? FORMS.horizon : FORMS.section);

    const timeUnit = goal.measure !== null && isTimeUnit(goal.measure.unit);

    // A sub-task sits exactly two spaces in, under its task and nowhere else.
    const child = /^ {2}- (.+)$/.exec(line);
    if (child) {
      if (section !== "tasks" || lastTask === null) return fail(n, FORMS.task);
      const parts = child[1].split(" · ");
      const amount = parts.length > 1 ? parseAmount(parts[0], timeUnit) : null;
      if (parts.length > 1 && amount === null) return fail(n, FORMS.child);
      const index = lastTask.children.length;
      lastTask.children.push({ name: parts.length > 1 ? parts.slice(1).join(" · ").trim() : parts[0].trim(), estimate: amount });
      spots.set(`${lastTaskPath}.children.${index}`, { line: n, expected: FORMS.child });
      noteOwner = { depth: 4, into: lastTask.children[index] };
      continue;
    }

    const item = /^- (.+)$/.exec(line);
    if (!item) return fail(n, section === "tasks" && /^\s+- /.test(line) ? FORMS.child : FORMS[singular(section)]);
    const parts = item[1].split(" · ").map((p) => p.trim());
    const spot = (key: string, expected: string) => spots.set(`${at}.${key}.${goal[section!].length - 1}`, { line: n, expected });

    if (section === "phases") {
      const m = /^(\d{4}-\d{2}-\d{2}) a (\d{4}-\d{2}-\d{2}) · (.+)$/.exec(item[1]);
      if (!m) return fail(n, FORMS.phase);
      goal.phases.push({ startsOn: m[1], endsOn: m[2], aim: m[3].trim() });
      spot("phases", FORMS.phase);
    } else if (section === "months") {
      const amount = parts.length === 2 ? parseAmount(parts[1], timeUnit) : null;
      if (amount === null) return fail(n, FORMS.month);
      goal.months.push({ month: parts[0], amount });
      spot("months", FORMS.month);
    } else if (section === "commitments") {
      const cadence = parts.length === 3 ? parseCadence(parts[1]) : null;
      if (cadence === null) return fail(n, FORMS.commitment);
      const tap = parts[2].toLowerCase() === "toque";
      const target = tap ? null : goal.measure ? parseAmount(parts[2], timeUnit) : null;
      if (!tap && target === null) return fail(n, FORMS.commitment);
      goal.commitments.push({
        name: parts[0],
        ...cadence,
        satisfaction: tap ? "tap" : "quantity",
        targetQuantity: target,
        unit: tap ? null : goal.measure!.unit,
      });
      spot("commitments", FORMS.commitment);
    } else {
      if (parts.length < 2) return fail(n, FORMS.task);
      const amount = parts.length > 2 ? parseAmount(parts[1], timeUnit) : null;
      if (parts.length > 2 && amount === null) return fail(n, FORMS.task);
      const task: Task = {
        month: parts[0],
        name: parts.length > 2 ? parts.slice(2).join(" · ") : parts[1],
        estimate: amount,
        children: [],
      };
      goal.tasks.push(task);
      lastTask = task;
      noteOwner = { depth: 2, into: task };
      lastTaskPath = `${at}.tasks.${goal.tasks.length - 1}`;
      spot("tasks", FORMS.task);
    }
  }

  if (needsHorizon) return fail(needsHorizon.line, FORMS.horizon);
  if (goals.length === 0) return fail(first + 2, FORMS.goal);

  const parsed = importDraftSchema.safeParse({ goals });
  if (parsed.success) return { matched: true, draft: parsed.data };

  // The nearest enclosing item names the line: a path is walked up until a
  // part of the draft written on some line matches.
  const path = parsed.error.issues[0].path.map(String);
  for (let k = path.length; k >= 0; k--) {
    const spot = spots.get(path.slice(0, k).join("."));
    if (spot) return fail(spot.line, spot.expected);
  }
  const last = spots.get(`goals.${goals.length - 1}`)!;
  return fail(last.line, last.expected);
}

function singular(section: Section): "phase" | "month" | "commitment" | "task" {
  return section === "phases" ? "phase" : section === "months" ? "month" : section === "commitments" ? "commitment" : "task";
}
