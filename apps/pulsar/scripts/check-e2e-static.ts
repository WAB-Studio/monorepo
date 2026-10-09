// Fails when a spec reads a layout or a computed value after a navigation with nothing in
// between that waits for the page. `load` fires with the loading fallback still standing, so
// the box or style read there belongs to the fallback (docs/TRAPS.md). Line-based: a read
// counts from the line it appears on, an anchor clears from the position it appears at.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type Allowed = { file: string; line: number; why: string };
export type Violation = { file: string; line: number; text: string };

const NAVIGATIONS = [/\.goto\(/, /\.waitForURL\(/, /\.reload\(/, /\.goBack\(/, /\.goForward\(/];
// `settled(` and `visit(` (e2e/fixtures.ts) wait for the one visible `main` and the fonts.
const ANCHORS = [/\bsettled\(/, /\bvisit\(/];
// An awaited web-first assertion retries; one whose argument is itself awaited has already read
// the page, and a bare `expect(value)` waits for nothing. It anchors from the next statement on.
const ASSERTION = /\bawait\s+expect\s*(?:\.poll\s*)?\((?!\s*\(?\s*await\b)/;
const MEASURES = [
  /\.boundingBox\(/,
  /\.screenshot\(/,
  /\bgetBoundingClientRect\b/,
  /\bgetComputedStyle\b/,
  /\boffset(?:Width|Height|Top|Left|Parent)\b/,
  /\bclient(?:Width|Height|Top|Left)\b/,
  /\bscroll(?:Width|Height)\b/,
];
// A new test, or a top-level declaration, starts from a page nobody navigated.
const BOUNDARY = /^\s*test(?:\.\w+)*\(|^(?:export\s+)?(?:async\s+)?function\b|^(?:export\s+)?const\s+\w+\s*=|^\}\);?\s*$/;

type Event = { at: number; kind: "nav" | "anchor" | "assertion" | "measure" };

function events(code: string): Event[] {
  const found: Event[] = [];
  const add = (patterns: RegExp[], kind: Event["kind"]) => {
    for (const re of patterns) {
      const hit = re.exec(code);
      if (hit) found.push({ at: hit.index, kind });
    }
  };
  add(NAVIGATIONS, "nav");
  add(ANCHORS, "anchor");
  add([ASSERTION], "assertion");
  add(MEASURES, "measure");
  return found.sort((a, b) => a.at - b.at);
}

// Net open brackets of `code` from `from` on, with string contents dropped.
function depth(code: string, from: number): number {
  const bare = code.slice(from).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, "");
  let open = 0;
  for (const ch of bare) open += "([{".includes(ch) ? 1 : ")]}".includes(ch) ? -1 : 0;
  return open;
}

export function scan(
  files: ReadonlyArray<{ name: string; text: string }>,
  allowed: readonly Allowed[],
): { violations: Violation[]; stale: Allowed[] } {
  const raw: Violation[] = [];
  for (const { name, text } of files) {
    let armed = false;
    // Open brackets of an assertion's statement; null when none is being read.
    let assertion: number | null = null;
    text.split("\n").forEach((line, i) => {
      if (BOUNDARY.test(line)) {
        armed = false;
        assertion = null;
      }
      const code = line.replace(/^\s*\/\/.*$/, "");
      let from = 0;
      for (const event of events(code)) {
        if (event.kind === "nav") armed = true;
        else if (event.kind === "anchor") armed = false;
        else if (event.kind === "assertion") {
          assertion ??= 0;
          from = event.at;
        } else if (armed) {
          raw.push({ file: name, line: i + 1, text: line.trim() });
          armed = false;
        }
      }
      if (assertion !== null) {
        assertion += depth(code, from);
        if (assertion <= 0) {
          assertion = null;
          armed = false;
        }
      }
    });
  }
  const hit = (v: Violation) => allowed.find((a) => a.file === v.file && a.line === v.line);
  return {
    violations: raw.filter((v) => !hit(v)),
    stale: allowed.filter((a) => !raw.some((v) => v.file === a.file && v.line === a.line)),
  };
}

// `file:line` of a read that is safe without an anchor, and why. An entry that matches no violation fails the run.
export const ALLOWED: readonly Allowed[] = [
  {
    file: "armazon-estados.spec.ts",
    line: 133,
    why: "`loaded(page)` on :132 is `expect(main).toContainText(/\\S/)`, a web-first wait the scan cannot see through",
  },
  {
    file: "pestanas.spec.ts",
    line: 249,
    why: "`loaded(page)` on :248 is `expect(main).toContainText(/\\S/)`, a web-first wait the scan cannot see through",
  },
];

function main(): void {
  const dir = path.join(import.meta.dirname, "..", "e2e");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".spec.ts"))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8") }));
  const { violations, stale } = scan(files, ALLOWED);
  for (const v of violations) console.error(`${v.file}:${v.line} measures after a navigation with no expect/settled/visit: ${v.text}`);
  for (const a of stale) console.error(`stale allowlist entry ${a.file}:${a.line} (${a.why}) matches nothing`);
  if (violations.length || stale.length) process.exit(1);
  console.log(`check:e2e-static: ${files.length} specs clean`);
}

if (process.argv[1]?.endsWith("check-e2e-static.ts")) main();
