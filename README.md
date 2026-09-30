# kanban-live-gantt

Desktop **live Gantt view** for the Hermes kanban boards — a now-centered,
slidable timeline; a fork of the
[`kanban-gantt`](https://github.com/e-is/hermes-kanban-gantt) plugin (same
layout: `src/main.ts` + `src/core/gantt-core.ts`, built by `scripts/build.mjs`
into `desktop/plugin.js` + `desktop/gantt-core.js`). Licensed **GPL-3.0** —
see [Credits & license](#credits--license).

## What it changes vs `kanban-gantt`

| | kanban-gantt | kanban-live-gantt (this) |
|---|---|---|
| Statuses shown | all (incl. done / archived) | **open work by default; done optional** ("Done" entry in the status filter, default off; archived never) |
| Timeline domain | data-driven, **loops over ≥7 days (1 week)** | **slidable 72 h: default now − 24 h → now + 48 h** (local wall clock) — drag the ruler to move it, drag its ends to move start/end |
| Window length | zoom slider (20 %–180 %) | user-controlled — **wheel = free zoom** (×1 fit → 240 px/h); the window slides/resizes freely (min 2 h), reset restores the default |
| Day cells | UTC-based ticks | local-midnight cells; today highlighted ("今天 / Today") |
| Now marker | none | thin accent **now line** with time label |
| Bars | full extents, 2 h minimum length, running bars drawn into the future | **lifecycle segments** — dashed waiting spans ↔ exact run spans (never stretched, never past "now"); a row shows iff a segment overlaps the window |
| Row order | kanban order | **recency desc — running / most recently active on top** (children stay under their parents) |
| Status colors | official kanban column tones | **own palette** — red = failure only, amber = blocked only, green = live only (see Rendering model) |
| i18n | en + fr | **en + zh** (full coverage, 95 keys aligned; sidebar/palette labels follow the app language) + straggler French removed |

Everything else (board switcher, filters, search, bulk actions, task drawer,
write endpoints, resizable columns, header chrome) is unchanged.

## Layout

```
src/main.ts            # desktop renderer (single self-contained ESM module)
src/core/gantt-core.ts # pure timeline logic (window, segments, recency rows) — Node-testable
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

1. **desktop half** — `~/.hermes/plugins/kanban-live-gantt/desktop/plugin.js` is
   materialized by the desktop app into `~/.hermes/desktop-plugins/kanban-live-gantt/`
   (local, non-marketplace package → **opt-in**: enable it in the app's plugin list).
2. **backend half** — `dashboard/plugin_api.py` is mounted at
   `/api/plugins/kanban-live-gantt/` **at serve-process start**; after adding the
   plugin, restart the app backend (or restart the desktop app) so the route mounts.
   `plugins.enabled` in `~/.hermes/config.yaml` must include `kanban-live-gantt`.

## Window semantics

The timeline opens on a **72 h window — `[now − 24 h, now + 48 h]`** (local wall
clock), re-anchored to the current moment on every refresh **until you move
it**. The window is not fixed:

- **Drag the ruler** — slide the whole window in time (both edges together,
  1 px = 1 px at the current zoom; drag right to look further back).
- **Drag the ruler's end handles** (the thin bars at either end, `col-resize`
  cursor) — move just the window **start** or **end**; it never shrinks below
  2 h.
- **Double-click the ruler** (or the `↺ window` / `×N` toolbar chips) — reset
  to the default window and zoom.

A manually placed window stays exactly there (refreshes and board switches do
not move it; it is not persisted — a reload returns to the default). The "now"
line only shows while now is inside the window; today's calendar cell stays
highlighted. A row appears iff at least one of the task's segments (waiting
or run) overlaps the window — see **Rendering model** below.

**Done is optional:** a **Done** entry sits in the status filter (same place as
every other status toggle — also clickable in the footer legend), default
**off**, persisted. It surfaces `done` tasks **that have activity inside the
window** — a task that finished before the window stays out. `archived` never
shows.

## Rendering model (v0.1.3)

Every task is drawn as an **alternating sequence of segments**, all clipped to
the window:

- **Waiting spans — dashed** (`#8a9099`): creation → first run, the gaps
  between runs, and (while the task is unfinished) its last run → *now*. A
  currently **blocked** task's waiting span is dashed **amber** (`#e0a13a`).
- **Run spans — solid, exact**: `[started_at, ended_at]` at their real
  length — short runs are **never stretched** (below 3 px they collapse to a
  dot marker; zoom in for the exact width). A span still in progress ends at
  *now* and glows green (`#34d399`); failed runs (`crashed`, `failed`,
  `timed_out`, `gave_up`, `blocked`, `rate_limited`) are red (`#ef5350`);
  finished runs are blue (`#5b8def`).
- **Hand-completed tasks** (no run record) get a waiting span plus a small
  round marker at `completed_at` ("unknown duration").

**Rows** appear iff at least one segment overlaps the window, ordered **by
recency — running first**; a parent floats up with its subtree, children stay
nested. **Status colors** (row dot, filter dots, legend) use their own palette
instead of the kanban column tones: `ready #4d9fff`, `running #34d399`,
`review #f472b6`, `blocked #e0a13a`, `done #7c8798`, `scheduled #a78bfa`,
`todo`/`triage` theme grays. Segment tooltips show exact durations ("waiting
(3h5m so far)", "failed run (12m)").

## Free zoom (hour granularity)

- **Wheel over the timeline** — zoom in/out freely, anchored at the cursor
  (from ×1 "whole window fits the pane" up to 240 px per hour ⇒ 15-min detail).
  At ≥ ~24 px/h the ruler gets hour ticks; labelled every 1/2/3/6/12 h so the
  spacing never drops below ~56 px; gridlines run down the body.
- **Shift + wheel** — pan horizontally. The name column keeps native
  scrolling; the horizontal scrollbar still works.
- **Double-click the ruler** (or the `×N` chip in the toolbar) — reset the view
  (default window + fit).
- The zoom level persists via `ctx.storage` (key `zoom`).

## Credits & license

Fork of **kanban-gantt** (c) e-is (Benoit Lavenier) —
<https://github.com/e-is/hermes-kanban-gantt> — **GNU GPL v3.0** (`LICENSE`).
This is a modified work distributed under the same license (GPL-3.0 change
notice: modified 2026-09-29 by **ningfangbin**).

Changes in this fork: status-filter "Done" lane (open work by default), a
now-centered slidable 72 h window (default −24 h → +48 h; drag to move, drag
the ends to resize) replacing the fixed day-count window, wheel zoom with hour
ticks replacing the zoom slider, now-line, local-midnight day cells, **en + zh**
i18n replacing en + fr, plugin renamed to `kanban-live-gantt` (from the working
name `kanban-day-gantt`, which predated the slidable window).

Model v0.1.3 additions: lifecycle segments (dashed waiting spans; exact run
spans that never pass "now"), recency-descending rows (running first), and a
re-designed non-kanban color palette (red = failure only, amber = blocked
only, green = live only).
