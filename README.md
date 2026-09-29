# kanban-day-gantt

Desktop **day view** for the Hermes kanban boards — a fork of the
[`kanban-gantt`](https://github.com/e-is/hermes-kanban-gantt) plugin (same
layout: `src/main.ts` + `src/core/gantt-core.ts`, built by `scripts/build.mjs`
into `desktop/plugin.js` + `desktop/gantt-core.js`). Licensed **GPL-3.0** —
see [Credits & license](#credits--license).

## What it changes vs `kanban-gantt`

| | kanban-gantt | kanban-day-gantt (this) |
|---|---|---|
| Statuses shown | all (incl. done / archived) | **open work by default; done optional** ("Done" entry in the status filter, default off; archived never) |
| Timeline domain | data-driven, **loops over ≥7 days (1 week)** | **rolling 48 h: now − 24 h → now + 24 h** (local wall clock) |
| Window length | zoom slider (20 %–180 %) | none — the rolling window is fixed by design; **wheel = free zoom** (×1 fit → 240 px/h, double-click resets) |
| Day cells | UTC-based ticks | local-midnight cells; today highlighted ("今天 / Today") |
| Now marker | none | thin accent **now line** with time label |
| Bars | full extents | clipped to the window; bars fully outside are not drawn (row shows "—") |
| i18n | en + fr | **en + zh** (full coverage, 76 keys aligned; sidebar/palette labels follow the app language) + straggler French removed |

Everything else (board switcher, filters, search, bulk actions, task drawer,
write endpoints, resizable columns, header chrome) is unchanged.

## Layout

```
src/main.ts            # desktop renderer (single self-contained ESM module)
src/core/gantt-core.ts # pure timeline logic (day window, bars, rows) — Node-testable
scripts/build.mjs      # esbuild → desktop/plugin.js + desktop/gantt-core.js
dashboard/plugin_api.py# Python backend (FastAPI) — copy of the kanban-gantt backend
dashboard/manifest.json# dashboard manifest (api entrypoint)
plugin.yaml            # plugin metadata
tests/gantt-core.test.mjs # core unit tests (run against the built core)
tests/ui/esm-render.mjs   # UI smoke: import-scan, register, render, done-filtered
```

## Build & test

```sh
npm install          # esbuild
npm run build        # regenerate desktop/
npm run check        # node --check on the built halves
npm test             # core unit tests + UI smoke
```

## Enable

The plugin is a two-half package, like `kanban-gantt`:

1. **desktop half** — `~/.hermes/plugins/kanban-day-gantt/desktop/plugin.js` is
   materialized by the desktop app into `~/.hermes/desktop-plugins/kanban-day-gantt/`
   (local, non-marketplace package → **opt-in**: enable it in the app's plugin list).
2. **backend half** — `dashboard/plugin_api.py` is mounted at
   `/api/plugins/kanban-day-gantt/` **at serve-process start**; after adding the
   plugin, restart the app backend (or restart the desktop app) so the route mounts.
   `plugins.enabled` in `~/.hermes/config.yaml` must include `kanban-day-gantt`.

## Window semantics

The timeline is a **rolling 48 h window — `[now − 24 h, now + 24 h]`** anchored
on the current moment (local wall clock). No day-count switch: it re-anchors on
every data refresh, the "now" line marks the current moment and today's
calendar cell stays highlighted. Tasks appear only when they have activity in
that window; an open task created days ago still gets a row, but no bar ("—").

**Done is optional:** a **Done** entry sits in the status filter (same place as
every other status toggle — also clickable in the footer legend), default
**off**, persisted. It surfaces `done` tasks **that have activity inside the
window** — a task that finished before the window stays out. `archived` never
shows.

## Free zoom (hour granularity)

- **Wheel over the timeline** — zoom in/out freely, anchored at the cursor
  (from ×1 "whole window fits the pane" up to 240 px per hour ⇒ 15-min detail).
  At ≥ ~24 px/h the ruler gets hour ticks; labelled every 1/2/3/6/12 h so the
  spacing never drops below ~56 px; gridlines run down the body.
- **Shift + wheel** — pan horizontally. The name column keeps native
  scrolling; the horizontal scrollbar still works.
- **Double-click the ruler** (or the `×N` chip in the toolbar) — reset to fit.
- The zoom level persists via `ctx.storage` (key `zoom`).

## Credits & license

Fork of **kanban-gantt** (c) e-is (Benoit Lavenier) —
<https://github.com/e-is/hermes-kanban-gantt> — **GNU GPL v3.0** (`LICENSE`).
This is a modified work distributed under the same license (GPL-3.0 change
notice: modified 2026-09-29 by **ningfangbin**).

Changes in this fork: status-filter "Done" lane (open work by default), rolling
48 h window replacing the fixed day-count window, wheel zoom with hour ticks
replacing the zoom slider, now-line, local-midnight day cells, **en + zh**
i18n replacing en + fr, plugin renamed to `kanban-day-gantt`.
