# Goal log — design guide

Governs `apps/pulsar` alone. `docs/DESIGN.md` governs `apps/orbit` and `docs/voyager/DESIGN.md`
governs `apps/voyager`; neither applies here and no pattern crosses over because it exists next door.

Approved by the user 2026-09-22 from the canvas
<https://claude.ai/artifact/5ZNtobfQDzeBNFcEMs38Qp>.

## The direction: Bitácora

A ship's log: what happened, when, and who wrote it down.

- **The design has no colour for failure.** A commitment done is the accent; one not done is an
  empty outline. No red anywhere, no broken streak, no badge, no praise. Decided by the user
  2026-09-22. A palette with no red is what enforces it — a later screen cannot reach for one.
- **Light is the primary face.** Dark is the same design inverted, never a second design.
  `apps/voyager` is dark-first; this app inherits nothing from it.
- **A figure is set in mono, a sentence in Archivo.** Hours, counts, minutes, dates and quantities
  are the log's substance: they read as a log or they read as decoration.
- **Writing a fact costs one tap.** No form stands on the day's path. What needs a number offers it
  already filled.
- Rule between rows with a hairline. Never a card, never a border box.
- **No shadow anywhere.** Not on a sheet, not on a button, not on a field. Separation is a hairline,
  a change of fill, or the scrim — never a blur. Checked 2026-09-22 against all seventeen boards:
  they draw **zero**. A library that paints one is painting a decision this design did not take.

## Tokens

Light, the primary:

| role | value |
|---|---|
| ground | `#EDEFF2` |
| raised (a sheet, a field, the tab bar) | `#FFFFFF` |
| line | `#DCE1E7` |
| border | `#C7CED7` |
| ink | `#12171C` |
| ink, secondary | `#333C45` |
| muted | `#5E6874` |
| quiet (strokes and decoration only) | `#8A939E` |
| accent | `#1C6E5A` |
| accent, soft (the evidence mark's fill) | `#DCEAE5` |
| scrim (behind a sheet) | `rgba(18, 23, 28, 0.34)` |

Dark, the same design inverted:

| role | value |
|---|---|
| ground | `#0F1317` |
| raised | `#161B20` |
| line | `#222930` |
| border | `#2B333B` |
| ink | `#E7ECF1` |
| ink, secondary | `#C3CBD3` |
| muted | `#949EA9` |
| quiet | `#5C666F` |
| accent | `#4FBEA0` |
| accent, soft | `#17332C` |
| scrim | `rgba(5, 7, 9, 0.62)` |

- The scrim is darker than the dark ground on purpose: a sheet is `raised`, and it has to lift off
  what is behind it on both faces. Taken 2026-09-22, when the only scrim in the app was a library's
  black alpha that no table held.
- **The theme root speaks these tokens.** Radix paints its own ground and ink on `.radix-themes`;
  both are overridden there. A surface that is not a `Page` would otherwise show a colour this table
  never chose — the same way it showed the system font before the family moved here.
- The accent is a different hex per face, not one colour at two opacities. `#1C6E5A` has too little
  contrast on the dark ground; `#4FBEA0` has too little on the light one.
- **muted is the smallest text colour there is.** `quiet` never carries a word a person must read:
  it draws strokes, empty marks and the units beside a figure.
- Text on the accent is `#FFFFFF` on the light face and `#0F1317` on the dark one.

## Type

- Sentences, headings, commitment names and controls: **Archivo**, fallback `system-ui, sans-serif`.
- Every figure: **DM Mono**, fallback `ui-monospace, monospace`, `letter-spacing: 0.02em`.
- Set a section label at 11 px, mono, uppercase, `letter-spacing: 0.14em`, in **muted**. It names a
  goal or a group, never a state.
- Set a screen title at 27 px / 600 / `-0.02em` on the phone, 38–44 px / 600–700 / `-0.03em` wide.
- Set a commitment name at 16 px / 500. Its metadata line is mono 12 in muted.
- Set the measure at 26 px mono / 500, with its unit beside it at mono 11 in quiet.
- Set a sheet's title at 21 px / 600 / `-0.02em`, and the line under it at 15 px / 1.6 in ink
  secondary. Both are what `HoyCantidad.dc.html` and `CompromisoRetirar.dc.html` already draw;
  written down 2026-09-22, when a primitive reached for 19 px and 14 px because no role here
  claimed them.
- Every size in this table is a `--pulsar-text-*` token in `app/theme.css`, the sheet's pair
  included. A size that lives as a literal inside one component is a size the next component will
  guess differently.
- **There is no role at 24 px and none at 14 px.** A component that needs one is a component
  reaching past this table; give it the nearest role or bring the decision here first.

## The marks

Three states, one shape — a 24 px circle at the head of the row:

| state | mark |
|---|---|
| done, declared | filled accent, a `#FFFFFF` check inside (`#0F1317` on dark) |
| done, by evidence | accent-soft fill, 1.5 px accent border, an accent check |
| not done | 1.5 px border, nothing inside |

- The two done marks differ so a day marked by another app never reads as one the person said they
  did (RP-09). The difference is fill, never hue: a second hue would be a second accent.
- A row is a real `<button>`, never a div. Minimum 56 px tall; every other control minimum 48 px.
- Radius: 10 px on a control or a field, 16 px on the top corners of a sheet.

## The controls

Two variants, and no third until a board draws one:

| variant | fill | border | ink |
|---|---|---|---|
| solid — the act the screen is for | accent | none | `#FFFFFF` light, `#0F1317` dark |
| outline — the way out of it | transparent | 1.5 px `border` | ink |
| ghost — an icon alone, no frame | transparent | none | muted |

- `ghost` is what the day's theme control is drawn with: a 44 px glyph and nothing around it. Added
  to this table 2026-09-22 rather than left as a variant the code had and the design did not name.

- `CompromisoRetirar.dc.html` draws both, one above the other: «Retirarlo» solid, «Dejarlo como
  está» outline. That is the pair, and the outline's border is the `border` token, never a tint of
  the accent.
- **Disabled drops the fill, in every variant**: muted ink on the ground with a `line` ring. It never
  changes hue and never goes grey from somewhere else.
  - **Corrected 2026-09-22, the day it was written.** The first wording said «muted ink over the
    same fill», which on a solid control measures **1.08:1** light and **1.19:1** dark — unreadable.
    Dropping the fill measures 4.92 and 6.86. The rule was wrong, not the code that obeyed it; it
    was caught by measuring a rule nobody had drawn on a board.
- A variant the design has not dressed is not reachable: the primitive's own type offers these and
  no others. An undressed variant behind a legal prop is the same gap as an undressed export — it
  just takes one more keystroke to reach. Settled 2026-09-22, after `variant="outline"` was measured
  painting a library's teal.

## The boards

On the canvas, in three pages. A module that draws a screen cites its board by name.

| board | what it holds |
|---|---|
| `Main.dc.html` | the direction, both palettes and the type scale |
| `Hoy.dc.html` | the day with work left, one goal |
| `HoyVarias.dc.html` | two goals open and two one-offs that belong to none — the general case |
| `HoyOscuro.dc.html` | the same day on the dark face |
| `HoyCantidad.dc.html` | the sheet that takes a quantity and its optional line (RP-03, RP-04) |
| `HoyCompleto.dc.html` | every commitment satisfied, with no congratulation |
| `HoyVacio.dc.html` | no goal open yet |
| `HoyCargando.dc.html` | the day while it loads |
| `HoySinEvidencia.dc.html` | a source that could not be read (RNP-04) |
| `Semana.dc.html` | the week with its gaps (RP-16) |
| `Revision.dc.html` | the measure week by week, on the phone (RP-17) |
| `RevisionEscritorio.dc.html` | the same table wide |
| `Meta.dc.html` | a goal's commitments, cadences and phases |
| `MetaNueva.dc.html` | the least it takes to open a goal |
| `CompromisoNuevo.dc.html` | adding a commitment: what it is, how often, what satisfies it (RP-12) |
| `CompromisoRetirar.dc.html` | the sheet that retires one, saying what it leaves intact (RP-13) |
| `SueltaBorrar.dc.html` | deleting a one-off, and how it differs from finishing one (RP-22) |
| `Entrar.dc.html` | the link sent to an address (RP-18) |

## The boards that do not exist

Say what is missing, so a gap nobody drew reads as a gap nobody needed.

- **Dark beyond `HoyOscuro.dc.html`.** Every other state is this design with the dark column of the
  token table. Drawing it again repeats a decision instead of taking one. Decided by the user
  2026-09-10, for every app.
- **A wide face beyond `RevisionEscritorio.dc.html`.** Only the review's table changes shape rather
  than width. The rest is used with one thumb.
- **The one-offs with no day (RP-21).** Their list is named in the contract and drawn nowhere.
- **The goals list (`/metas` with more than one goal).** Its own way in reuses `commitment-list.tsx`'s
  block-button pattern; no board draws the list itself. Decided 2026-09-27 by the coordinator, the
  user having delegated it.
- **The empty week.** No board draws a week with no goal open; it reuses the empty day's own shape
  and sentence, never a state of its own. Decided 2026-09-27 by the coordinator, the user having
  delegated it.
- **Writing a fact for a day already past (RP-06).** Not drawn.
- **The moment a phase ends (RP-15)** and the review's own act — recording the answer again. Not drawn.
- **A read-only field.** No board shows one; "Decisions taken here" says what it looks like anyway,
  because the kit needed the answer before any screen asked for it.
- **The goal's entry to a new commitment.** Decided under "Decisions taken here", built, not drawn
  on `Meta.dc.html`.
- **«Escribir otra cantidad», typed.** `HoyCantidad.dc.html` draws the chips alone; the typed field
  the tap on that button opens — the exception this design already allows — is built and not drawn.
- **A done row with its note.** No board draws a commitment's second and third lines once it is
  satisfied — what was logged, and the note under it. "Decisions taken here" says what they read.

## Decisions taken here

- **The light/dark control sits in the day's header** (RNP-08), a 44 px icon button at the top
  right. No `/cuenta` screen exists in this app. Taken by the user 2026-09-22; drawn on
  `Hoy.dc.html`, `HoyOscuro.dc.html` and every other day board the same day.
- **A one-off is written in a field at the foot of the day** (RP-19), permanently visible under the
  day's one-offs: type and it lands. No sheet and no screen of its own. Taken by the user
  2026-09-22; drawn on `Hoy.dc.html` and `HoyVarias.dc.html`. The empty mark beside it is dashed,
  the only dashed stroke in the design, because it is the one row nothing has written yet.
- **A goal is opened with a name and a horizon, nothing more** (RP-11). The measure and its unit are set later,
  with the first commitment that measures something. Taken by the user 2026-09-22, and
  `MetaNueva.dc.html` redrawn the same day: it had a third field for the measure and now has two.
- **The day is `America/Bogota`** (RNP-06), one constant in one file, not a column and not the
  browser's zone. Taken by the user 2026-09-22.
- **The day holds every open goal at once, grouped, with no selector**, and the one-offs sit below
  the last goal. With four goals the person scrolls. Taken by the user 2026-09-22;
  `HoyVarias.dc.html` is the board that shows it.
- **The theme control is binary** (RNP-08). It offers light and dark; «system» is the state before a
  choice is made, never a third thing the control cycles to. Settled 2026-09-22 against a control
  that cycled three ways.
- **The tap floor is 48 px, with two named exceptions**: the mark, 24 px inside its 56 px row, and
  the theme control at 44. Both clear RNP-07's 32.
- **A field's label takes the section label's type** — 11 px mono, uppercase, 0.14 em, muted — and
  has no type of its own. It is what `MetaNueva.dc.html`, `HoyCantidad.dc.html` and
  `CompromisoNuevo.dc.html` already draw; written down 2026-09-22 so it reads as a decision rather
  than a coincidence.
- **A quantity is offered as chips, not typed** (RP-03). `HoyCantidad.dc.html` draws four, with the
  number the plan expects already selected. Typing a number is the exception, not the path.
- **Deleting a one-off reuses the retire sheet** (RP-22). No swipe and no ×: this app has neither,
  and a gesture invented for one row is a gesture nobody finds. The sheet's sentence carries the
  only thing anyone hesitates over — done leaves a record, deleted leaves nothing. Drawn
  2026-09-22 on `SueltaBorrar.dc.html`.
- **A cadence is chosen with chips, not a menu** (RP-12). «días sueltos» opens a row of seven day
  toggles; the other three cadences replace that row with one number. Drawn 2026-09-22 on
  `CompromisoNuevo.dc.html`, which unblocks the commitment act.
- **Retiring says what it does not do** (RP-13). The sheet's sentence is about what survives — the
  weeks already governed, the days already done — because that is the only thing anyone hesitates
  over. Drawn 2026-09-22 on `CompromisoRetirar.dc.html`.
- **How much evidence satisfies a day (RP-08): one search.** Taken by the user 2026-09-22.
  `Meta.dc.html` draws «1 búsqueda · diccionario»; the day boards draw 55, which is the real figure
  measured in `reading.lookups` that day. The threshold is per commitment and the person can raise it.
- **The kit keeps composing on Radix Themes.** A fourth path of unstyled Radix paint reached the
  screen — `-webkit-text-fill-color` on a disabled or read-only field, set by Radix beside `color`
  and never pinned by the kit, so Chromium and WebKit painted their own grey under a correct-looking
  computed style. Taken knowing a fifth path can still surface: the fix is dressing what Radix paints,
  not leaving the library or rebuilding a primitive on bare elements. Taken by the user 2026-09-22.
- **A read-only field reads exactly as a disabled one.** Muted ink, a `line` ring, no fill of its
  own — one form for "this does not move," not two half-dressed states a reader would have to tell
  apart. No board draws a read-only field; this decision has none. Taken by the user 2026-09-22.
- **A goal adds a commitment from its own screen.** `Meta.dc.html` draws the list and no way into
  `CompromisoNuevo.dc.html`, and a goal is born with no commitment. A block button «Añadir un
  compromiso» sits under the goal's list: outlined while the list holds one, solid while it is empty,
  because then it is the only thing the screen asks for. Decided 2026-09-27 by the coordinator, the
  user having delegated it.
- **«N veces al mes» has no chip.** The schema and the engine accept `times_per_month`; the new
  commitment's screen offers the four cadences `CompromisoNuevo.dc.html` draws, and one already
  stored still reads on the goal. Taken by the user 2026-09-27: no chip until someone needs it.
- **The week draws no footer and no «descanso deliberado».** `Semana.dc.html` closes on a
  paragraph that only explains an empty day, and marks a day asking one thing as a deliberate rest.
  The first is cut as text a person does not act on; the second has no data behind it — nothing
  tells a rest the person chose from a day the plan simply asks little of. Also taken: one 8 px
  `dot` mark instead of the board's 9, the 56 px `Row` instead of 54, and «semana N de M» on each
  goal's label rather than once above the week, which reads right with several goals of different
  horizons. Decided 2026-09-27 by the coordinator, the user having delegated it.
- **The quantity sheet's question is neutral, never gendered by the unit.** «¿Cuántos {unit}?» read
  «¿Cuántos páginas?» for a feminine unit; the heading is now «¿Cuánto hiciste hoy?», the unit named
  once beside the chips instead of inside the sentence. Decided 2026-09-27 by the coordinator, the
  user having delegated it, over storing a gender per unit.
- **The chip row keeps the whole unit word, never the board's short form.** «10 minutos», not «10
  min»: no table maps an arbitrary unit string to an abbreviation, and guessing one would be a second
  unit the person never typed. Decided 2026-09-27 by the coordinator, the user having delegated it.
- **`/metas` always lists the person's open goals, and never redirects past a single one.** Each row
  is its own way into `Meta.dc.html`; the list ends with a block `Button` «Abrir otra meta», outlined,
  linking to `/metas/nueva` — the same pattern `commitment-list.tsx` draws under a goal's own
  commitments. With none yet, there is nothing to list and nobody to open a second goal from, so
  `/metas/nueva` is still the only useful screen and the redirect there stays. The bottom nav's
  «Meta» tab lands on this list. Decided 2026-09-27 by the coordinator, the user having delegated it.
- **The goal's own screen has no added way back to the list.** The bottom nav's «Meta» tab already
  sits on every signed-in screen and already routes to `/metas`, so a second link would be a second
  way to do what one control already does. Checked, not built, 2026-09-27 by the coordinator.
- **The empty week reuses the day's own empty state, word for word.** «Todavía no tienes una meta
  abierta.» and «Crear una meta», linking to `/metas/nueva` — copied into `week.json` and a sibling
  component (`components/week/empty-week.tsx`) rather than importing `components/day/empty-day.tsx`,
  since a week's own screen owns nothing under `components/day/**`. Decided 2026-09-27 by the
  coordinator, the user having delegated it.
- **A figure formats through `Intl.NumberFormat`, in the one locale `i18n/request.ts` fixes the app
  on** (`"es"`), rather than printing a bare number. `components/ui/figure.tsx` still takes only
  props and imports no catalogue: the locale is a constant beside it, the same way `lib/zone.ts`
  fixes `TIME_ZONE` for the same reason — the app has exactly one of each and nothing negotiates
  either. `Intl.NumberFormat("es")` groups `1000039` into `1.000.039` — a period, not the space this
  decision was first asked for in, measured against both Node's and Chromium's own ICU data on this
  machine (`Intl.NumberFormat.supportedLocalesOf`, Playwright's own bundled Chromium): grouped
  digits is the fix RP-14's own figure needed, and which punctuation mark ICU picks for Spanish is
  not this app's decision to make twice. Decided 2026-09-27 by the coordinator, the user having
  delegated it.
- **A second tap on a done `tap` row undoes its fact through `undoFact`.** No confirm sheet: the
  same gesture that made it unmakes it. Decided 2026-09-27 by the coordinator, the user having
  delegated it.
- **A tap on a done `quantity` row opens the quantity sheet showing the logged figure**, with
  «Deshacer» as a secondary action beside changing the amount. Its primary reads «Cambiar» and
  replaces that day's fact in one transaction; only the first log of the day reads «Anotar» and adds.
  Replacing, not adding, keeps the day and the goal's total saying the same number. Evidence rows stay untappable
  (RP-05: a derived fact cannot be undone). Decided 2026-09-27 by the coordinator, the user having
  delegated it.
- **A done row's second line shows what was logged** («25 minutos») instead of the target, and the
  note, when there is one, as a third quiet line (the type role already named `quiet` in the token
  table; no new role). Decided 2026-09-27 by the coordinator, the user having delegated it.
