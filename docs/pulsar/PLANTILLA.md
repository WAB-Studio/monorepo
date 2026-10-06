# La plantilla de un plan

Un plan escrito así se lee en la app, sin IA y sin tope (RP-37). Cualquier otro texto se envía a OpenAI.

## Gramática

- La primera línea no vacía es exactamente `pulsar · plantilla 1`. Sin ella, el texto no es una plantilla.
- Las líneas en blanco se ignoran. Cada meta empieza en `# <nombre>`; un archivo trae de 1 a 12.
- `horizonte: AAAA-MM-DD` es obligatorio y va justo después del nombre. Es el primer día después de la meta.
- `medida: <nombre> · <unidad>` es opcional. Sin ella, la meta no lleva montos ni tiempo.
- Las secciones `## Fases`, `## Meses`, `## Compromisos` y `## Tareas` van en cualquier orden y son opcionales; cada una lista líneas que empiezan en `- `.
- Fase: `- AAAA-MM-DD a AAAA-MM-DD · <objetivo>`.
- Mes: `- AAAA-MM · <monto>`. Un mes no se repite.
- Compromiso: `- <nombre> · <cadencia> · <toque o monto>`. Un monto cuenta en la unidad de la medida.
- Cadencia: `cada día`, `lunes y jueves` (días separados por coma o «y»), `3 veces por semana`, `cada 2 días`, `2 veces al mes`.
- Tarea: `- AAAA-MM · <nombre>` o `- AAAA-MM · <monto> · <nombre>`.
- Sub-tarea: una línea `- ` con exactamente dos espacios antes, justo bajo su tarea: `  - <nombre>` o `  - <monto> · <nombre>`.
- Monto: con una medida en minutos, `12 h`, `1,5 h`, `12 h 30 min` o `90 min`, y se guarda en minutos; con cualquier otra unidad, un número entero.
- Una línea que no sigue la forma detiene la lectura y se dice cuál era y qué se esperaba.

## Ejemplo

```
pulsar · plantilla 1

# IA aplicada
horizonte: 2027-10-01
medida: horas de estudio · minutos

## Fases
- 2026-10-01 a 2026-12-31 · Evals y harness

## Meses
- 2026-10 · 12 h
- 2026-11 · 20 h

## Compromisos
- Tema técnico · martes y jueves · 2 h
- Inglés pasivo · cada día · toque

## Tareas
- 2026-10 · 4 h · Leer AI Engineering cap. 1–4
- 2026-10 · Tutor
  - 1 h · Elegir tutor
  - 6 h · Sesiones 1–4
```
