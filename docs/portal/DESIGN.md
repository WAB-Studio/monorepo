# Universo — diseño

`apps/portal`: una sola página estática, `index.html`, que lleva a las tres apps. Sin build, sin dependencias.

## Decisiones

- **Bento oscuro.** Aprobado por el usuario el 2026-10-01, tras rechazar una lista simple, un cielo con brillos, una
  placa grabada y una escena three.js. Tablero: «Universo», https://claude.ai/artifact/RqkVpe5eP47Qu4S9YbC3GZ
- Una tarjeta por app, con una miniatura de la app en sus propios colores, tomados de su `DESIGN.md`. Pulsar muestra
  Hoy, Voyager una palabra buscada y Orbit el saldo del fondo. Los datos de las miniaturas son de ejemplo.
- Tema único: oscuro.
- La fecha de la tarjeta de presentación es la del navegador de quien abre la página. No nombra ninguna ciudad.
- Sin degradados de color, sin vidrio, sin brillos. Al pasar el mouse la tarjeta se aclara, la miniatura sube 3 px y la
  flecha se llena.

## Tableros que no existen

- Un estado de error: la página no carga datos, así que no tiene.
- Una cara clara: el usuario aprobó solo la oscura.

## Despliegue

- Proyecto de Vercel `universo-apps`, https://universo-apps.vercel.app
- `vercel.json` apaga los despliegues por git: la página no gasta la cuota de `main`.
- Se despliega a mano desde `apps/portal`: `npx vercel deploy --prod --yes`. Solo cuando cambia una dirección o la página.
