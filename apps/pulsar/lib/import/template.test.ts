import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { draftRefusals, importDraftJsonSchema } from "./draft";
import { parseTemplate } from "./template";

const catalogue = JSON.parse(readFileSync(new URL("../../messages/es/import.json", import.meta.url), "utf8"));
const EXAMPLE: string = catalogue.template.example;

test("PLANTILLA.md's example is the catalogue's, byte for byte", () => {
  const doc = readFileSync(new URL("../../../../docs/pulsar/PLANTILLA.md", import.meta.url), "utf8");
  const fenced = /```\n([\s\S]*?)\n```/.exec(doc);
  assert.ok(fenced);
  assert.equal(fenced[1], EXAMPLE);
});

test("the example reads into the draft it describes, minutes and all", () => {
  const result = parseTemplate(EXAMPLE);
  assert.ok(result.matched && "draft" in result);
  assert.deepEqual(result.draft, {
    goals: [
      {
        name: "IA aplicada",
        horizon: "2027-10-01",
        measure: { name: "horas de estudio", unit: "minutos" },
        rhythm: 720,
        phases: [{ aim: "Evals y harness", startsOn: "2026-10-01", endsOn: "2026-12-31" }],
        months: [
          { month: "2026-10", amount: 720 },
          { month: "2026-11", amount: 1200 },
        ],
        commitments: [
          { name: "Tema técnico", cadenceKind: "weekdays", cadenceWeekdays: [2, 4], cadenceN: null, satisfaction: "quantity", targetQuantity: 120, unit: "minutos" },
          { name: "Inglés pasivo", cadenceKind: "daily", cadenceWeekdays: null, cadenceN: null, satisfaction: "tap", targetQuantity: null, unit: null },
        ],
        tasks: [
          { name: "Leer AI Engineering cap. 1–4", month: "2026-10", estimate: 240, children: [] },
          {
            name: "Tutor",
            month: "2026-10",
            estimate: null,
            note: "Preguntar por la tarifa por hora.\nPedir una clase de prueba antes de pagar.",
            children: [
              { name: "Elegir tutor", estimate: 60, note: "Comparar tres perfiles." },
              { name: "Sesiones 1–4", estimate: 360 },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(draftRefusals(result.draft, "2026-10-01"), []);
});

test("a text whose first non-empty line is not the header is not matched", () => {
  assert.deepEqual(parseTemplate(""), { matched: false });
  assert.deepEqual(parseTemplate("# IA\nhorizonte: 2027-10-01"), { matched: false });
  assert.deepEqual(parseTemplate("pulsar · plantilla 2\n"), { matched: false });
  assert.deepEqual(parseTemplate("hola\npulsar · plantilla 1"), { matched: false });
});

test("blank lines before the header, CRLF and trailing spaces still match", () => {
  const result = parseTemplate("\n\r\npulsar · plantilla 1  \r\n# A\r\nhorizonte: 2027-10-01  \r\n");
  assert.ok(result.matched && "draft" in result);
});

function errorOf(text: string) {
  const result = parseTemplate(text);
  assert.ok(result.matched && "error" in result, JSON.stringify(result));
  return result.error;
}

const HEAD = "pulsar · plantilla 1\n\n# A\nhorizonte: 2027-10-01\nmedida: horas · minutos\n";

test("every cadence the commitment form words is read", () => {
  const cadences: Record<string, object> = {
    "cada día": { cadenceKind: "daily", cadenceWeekdays: null, cadenceN: null },
    "lunes y jueves": { cadenceKind: "weekdays", cadenceWeekdays: [1, 4], cadenceN: null },
    "lunes, martes y jueves": { cadenceKind: "weekdays", cadenceWeekdays: [1, 2, 4], cadenceN: null },
    "3 veces por semana": { cadenceKind: "times_per_week", cadenceWeekdays: null, cadenceN: 3 },
    "cada 2 días": { cadenceKind: "every_n_days", cadenceWeekdays: null, cadenceN: 2 },
    "2 veces al mes": { cadenceKind: "times_per_month", cadenceWeekdays: null, cadenceN: 2 },
  };
  for (const [words, expected] of Object.entries(cadences)) {
    const result = parseTemplate(`${HEAD}## Compromisos\n- x · ${words} · toque\n`);
    assert.ok(result.matched && "draft" in result, words);
    assert.deepEqual({ ...result.draft.goals[0].commitments[0] }, { name: "x", satisfaction: "tap", targetQuantity: null, unit: null, ...expected }, words);
  }
});

test("an unreadable cadence stops at its line, saying the form", () => {
  assert.deepEqual(errorOf(`${HEAD}## Compromisos\n- x · cuando pueda · toque\n`), { line: 7, expected: "- nombre · cadencia · toque o monto" });
});

test("a cadence the form refuses stops at its line", () => {
  assert.equal(errorOf(`${HEAD}## Compromisos\n- x · 8 veces por semana · toque\n`).line, 7);
});

test("amounts of a time unit go through parseTime; any other unit takes whole numbers", () => {
  const time = parseTemplate(`${HEAD}## Meses\n- 2026-10 · 1,5 h\n- 2026-11 · 12 h 30 min\n- 2026-12 · 90 min\n`);
  assert.ok(time.matched && "draft" in time);
  assert.deepEqual(time.draft.goals[0].months.map((m) => m.amount), [90, 750, 90]);
  assert.equal(errorOf(`${HEAD}## Meses\n- 2026-10 · 12\n`).line, 7);

  const pages = "pulsar · plantilla 1\n# A\nhorizonte: 2027-10-01\nmedida: páginas · páginas\n## Meses\n- 2026-10 · 40\n";
  const parsed = parseTemplate(pages);
  assert.ok(parsed.matched && "draft" in parsed);
  assert.equal(parsed.draft.goals[0].months[0].amount, 40);
  assert.equal(errorOf(pages.replace("40", "2 h")).line, 6);
});

test("a sub-task is two spaces in under its task, and only that", () => {
  const tasks = (child: string) => `${HEAD}## Tareas\n- 2026-10 · Tutor\n${child}\n`;
  const ok = parseTemplate(tasks("  - 1 h · Elegir"));
  assert.ok(ok.matched && "draft" in ok);
  assert.deepEqual(ok.draft.goals[0].tasks[0].children, [{ name: "Elegir", estimate: 60 }]);
  for (const bad of [" - 1 h · Elegir", "   - 1 h · Elegir", "    - 1 h · Elegir", "\t- 1 h · Elegir"]) {
    assert.equal(errorOf(tasks(bad)).line, 8, JSON.stringify(bad));
  }
});

test("a sub-task with no task above it, or in another section, is refused", () => {
  assert.equal(errorOf(`${HEAD}## Tareas\n  - Elegir\n`).line, 7);
  assert.equal(errorOf(`${HEAD}## Meses\n  - 1 h\n`).line, 7);
  assert.equal(errorOf(`${HEAD}## Tareas\n- 2026-10 · A\n## Meses\n  - Elegir\n`).line, 9);
});

test("a goal with no horizon, and a line outside a goal, name their line", () => {
  assert.deepEqual(errorOf("pulsar · plantilla 1\n# A\nmedida: a · b\n"), { line: 2, expected: "horizonte: AAAA-MM-DD" });
  assert.deepEqual(errorOf("pulsar · plantilla 1\n\nhola\n"), { line: 3, expected: "# nombre" });
  assert.deepEqual(errorOf("pulsar · plantilla 1\n"), { line: 2, expected: "# nombre" });
});

test("an unknown section stops at its line", () => {
  assert.equal(errorOf(`${HEAD}## Notas\n`).line, 6);
});

test("a schema refusal lands on the line that wrote it", () => {
  assert.deepEqual(errorOf("pulsar · plantilla 1\n# A\nhorizonte: 2027-02-31\n"), { line: 3, expected: "horizonte: AAAA-MM-DD" });
  assert.equal(errorOf(`${HEAD}## Meses\n- 2026-10 · 1 h\n- 2026-13 · 1 h\n`).line, 8);
  assert.equal(errorOf(`${HEAD}## Fases\n- 2026-12-31 a 2026-10-01 · x\n`).line, 7);
});

test("two goals read as two", () => {
  const result = parseTemplate("pulsar · plantilla 1\n# A\nhorizonte: 2027-10-01\n# B\nhorizonte: 2027-11-01\n");
  assert.ok(result.matched && "draft" in result);
  assert.deepEqual(result.draft.goals.map((g) => g.name), ["A", "B"]);
});

test("a quantity commitment on a goal with no measure is refused at its line", () => {
  const text = "pulsar · plantilla 1\n# A\nhorizonte: 2027-10-01\n## Compromisos\n- x · cada día · 2 h\n";
  assert.equal(errorOf(text).line, 5);
});

function draftOf(text: string) {
  const result = parseTemplate(text);
  assert.ok(result.matched && "draft" in result, JSON.stringify(result));
  return result.draft.goals[0];
}

test("a sub-task whose amount is not an amount stops at its line", () => {
  const error = errorOf(`${HEAD}## Tareas\n- 2026-10 · Tutor\n  - abc · Nombre\n`);
  assert.equal(error.line, 8);
  assert.equal(error.expected, "  - nombre, o   - monto · nombre");
});

test("a leading BOM still matches", () => {
  assert.equal(draftOf("﻿pulsar · plantilla 1\n# A\nhorizonte: 2027-10-01\n").name, "A");
});

test("«todos los días» reads as daily", () => {
  assert.equal(draftOf(`${HEAD}## Compromisos\n- x · todos los días · toque\n`).commitments[0].cadenceKind, "daily");
});

test("miércoles, sábados and domingos are recognised, in any order, once each", () => {
  const days = (words: string) => draftOf(`${HEAD}## Compromisos\n- x · ${words} · toque\n`).commitments[0].cadenceWeekdays;
  assert.deepEqual(days("miércoles, sábados y domingos"), [3, 6, 7]);
  assert.deepEqual(days("jueves y lunes"), [1, 4]);
  assert.deepEqual(days("lunes y lunes"), [1]);
});

test("«1 vez por semana» and «Toque» are accepted", () => {
  const c = draftOf(`${HEAD}## Compromisos\n- x · 1 vez por semana · Toque\n`).commitments[0];
  assert.equal(c.cadenceKind, "times_per_week");
  assert.equal(c.cadenceN, 1);
  assert.equal(c.satisfaction, "tap");
  assert.equal(draftOf(`${HEAD}## Compromisos\n- x · 1 vez al mes · toque\n`).commitments[0].cadenceKind, "times_per_month");
});

test("a name keeps its « · », in a task and in a sub-task", () => {
  const task = draftOf(`${HEAD}## Tareas\n- 2026-10 · 4 h · A · B\n  - 1 h · E · F\n`).tasks;
  assert.equal(task[0].name, "A · B");
  assert.equal(task[0].estimate, 240);
  assert.equal(task[0].children[0].name, "E · F");
});

test("with a non-time unit, «2 h» fails with the whole-number form", () => {
  const text = "pulsar · plantilla 1\n# A\nhorizonte: 2027-10-01\nmedida: páginas · páginas\n## Tareas\n- 2026-10 · 2 h · Leer\n";
  assert.deepEqual(errorOf(text), { line: 6, expected: "- AAAA-MM · nombre, o - AAAA-MM · monto · nombre" });
});

test("a sub-task cannot follow a task across a section switch back to tasks", () => {
  assert.equal(errorOf(`${HEAD}## Tareas\n- 2026-10 · A\n## Tareas\n  - c\n`).line, 9);
});

test("a sub-task cannot follow a task across another section", () => {
  assert.equal(errorOf(`${HEAD}## Tareas\n- 2026-10 · A\n## Meses\n  - c\n`).line, 9);
});

const DOC = readFileSync(new URL("../../../../docs/pulsar/PLANTILLA.md", import.meta.url), "utf8");
const DOC_EXAMPLE = /```\n([\s\S]*?)\n```/.exec(DOC)![1];

test("PLANTILLA.md's example, read from the file, carries the task's two-line note and the sub-task's", () => {
  const result = parseTemplate(DOC_EXAMPLE);
  assert.ok(result.matched && "draft" in result, JSON.stringify(result));
  const [, tutor] = result.draft.goals[0].tasks;
  assert.equal(tutor.note, "Preguntar por la tarifa por hora.\nPedir una clase de prueba antes de pagar.");
  assert.equal(tutor.children[0].note, "Comparar tres perfiles.");
  assert.equal("note" in tutor.children[1], false);
  assert.equal("note" in result.draft.goals[0].tasks[0], false);
});

test("a note repeats its line; a bare nota: is a blank line; the whole is trimmed; all blank is no note", () => {
  const tasks = (body: string) => `${HEAD}## Tareas\n- 2026-10 · Tutor\n${body}\n`;
  const noteOf = (body: string) => {
    const result = parseTemplate(tasks(body));
    assert.ok(result.matched && "draft" in result, JSON.stringify(result));
    return result.draft.goals[0].tasks[0].note;
  };
  assert.equal(noteOf("  nota: uno\n  nota:\n  nota: dos"), "uno\n\ndos");
  assert.equal(noteOf("  nota:\n  nota:   uno  \n  nota:"), "uno");
  assert.equal(noteOf("  nota:\n  nota:"), null);
});

test("a note of 2001 characters stops the read at its first nota: line; 2000 passes", () => {
  // The two lines join with one line break: x repeated, a break, "más".
  const tasks = (x: number) => `${HEAD}## Tareas\n- 2026-10 · Tutor\n  nota: ${"x".repeat(x)}\n  nota: más\n`;
  assert.deepEqual(errorOf(tasks(1997)), { line: 8, expected: "  nota: texto, o     nota: texto" });
  const ok = parseTemplate(tasks(1996));
  assert.ok(ok.matched && "draft" in ok);
  assert.equal(ok.draft.goals[0].tasks[0].note?.length, 2000);
});

test("nota: anywhere but under a task or a sub-task stops the read as out of form", () => {
  const at = (body: string) => errorOf(`${HEAD}${body}\n`);
  assert.equal(at("## Compromisos\n- x · cada día · toque\n  nota: a").line, 8);
  assert.equal(at("## Meses\n  nota: a").line, 7);
  assert.equal(at("## Tareas\n  nota: a").line, 7);
  // A task's note comes before its sub-tasks; a four-space note needs a sub-task.
  assert.equal(at("## Tareas\n- 2026-10 · T\n  - 1 h · c\n  nota: a").line, 9);
  assert.equal(at("## Tareas\n- 2026-10 · T\n    nota: a").line, 8);
  assert.equal(at("## Tareas\n- 2026-10 · T\n   nota: a").line, 8);
  assert.equal(at("## Tareas\n- 2026-10 · T\nnota: a").line, 8);
});

test("a template with no nota: reads with no note key anywhere", () => {
  const result = parseTemplate(`${HEAD}## Tareas\n- 2026-10 · T\n  - 1 h · c\n`);
  assert.ok(result.matched && "draft" in result);
  assert.equal(JSON.stringify(result.draft).includes("note"), false);
});

const RHYTHM_HEAD = "pulsar · plantilla 1\n# A\nhorizonte: 2027-10-01\n";

function rhythmOf(unit: string, amount: string) {
  const result = parseTemplate(`${RHYTHM_HEAD}medida: horas · ${unit}\nritmo: ${amount}\n`);
  assert.ok(result.matched && "draft" in result, JSON.stringify(result));
  return result.draft.goals[0].rhythm;
}

test("ritmo: reads a time amount into minutes, in every format", () => {
  assert.equal(rhythmOf("minutos", "12 h"), 720);
  assert.equal(rhythmOf("minutos", "12 h 30 min"), 750);
  assert.equal(rhythmOf("min", "90 min"), 90);
});

test("a template without ritmo: reads as before, rhythm null", () => {
  const result = parseTemplate(`${RHYTHM_HEAD}medida: horas · minutos\n`);
  assert.ok(result.matched && "draft" in result);
  assert.equal(result.draft.goals[0].rhythm, null);
});

test("ritmo: stops with its line and form when not under a time measure, not placed after medida:, or not an amount", () => {
  const form = "ritmo: 12 h, justo después de medida:, solo con una medida en minutos";
  const stops = (text: string, line: number) => assert.deepEqual(errorOf(`${RHYTHM_HEAD}${text}`), { line, expected: form }, text);
  stops("medida: carrera · km\nritmo: 10\n", 5);
  stops("medida: carrera · km\nritmo: 10 h\n", 5);
  stops("ritmo: 12 h\n", 4);
  stops("ritmo: 12 h\nmedida: horas · minutos\n", 4);
  stops("medida: horas · minutos\nritmo: 12\n", 5);
  stops("medida: horas · minutos\nritmo: 12 h\nritmo: 1 h\n", 6);
  stops("medida: horas · minutos\n## Meses\nritmo: 12 h\n", 6);
  stops("medida: horas · minutos\nritmo: 0 min\n", 5);
});

test("the draft the model is sent carries no rhythm", () => {
  assert.equal(JSON.stringify(importDraftJsonSchema).includes("rhythm"), false);
});

test("PLANTILLA.md's example, read from the file, carries ritmo: 12 h", () => {
  const fenced = /```\n([\s\S]*?)\n```/.exec(DOC);
  assert.ok(fenced && fenced[1].includes("\nritmo: 12 h\n"));
  const result = parseTemplate(fenced[1]);
  assert.ok(result.matched && "draft" in result);
  assert.equal(result.draft.goals[0].rhythm, 720);
});
