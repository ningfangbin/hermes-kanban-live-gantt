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
| Status colors | official kanban column tones | **own palette** — red = failure only, amber = blocked only, green = live only; one `--kg-*` token table shared by bars and glyphs, light + dark sets (see Rendering model) |
| Status coding | colour dot per status | **9 status glyphs** (shape-first) + per-status counts in the legend, colour as the second channel |
| i18n | en + fr | **en + zh** (full coverage, 95 keys aligned; sidebar/palette labels follow the app language) + straggler French removed |
| Empty view | blank timeline | **self-explaining** — an unreadable board is reported in a banner (never silently dropped from the aggregate), a window that misses every open task says how many sit outside it and offers *jump to now*, and 0-open-task boards are labelled in the switcher |
| Board scope | named boards only | **+ the back-compat `default` board** (`<home>/kanban.db`) — the board the CLI calls "current" is selectable and aggregated too |
| Backend reads | full dump per request | short-lived snapshot cache (**5 s**, `KANBAN_GANTT_CACHE_SECONDS`, `?refresh=1` bypasses), invalidated by every write |

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
tests/ui/esm-render.mjs   # UI smoke: import-scan, register, render, done-filtered, error banner, window hint
tests/backend/test_plugin_api.py # backend unittest (unittest, needs fastapi)
```

## Build & test

```sh
npm install          # esbuild
npm run build        # regenerate desktop/
npm run check        # node --check on the built halves
npm test             # core unit tests + UI smoke
npm run test:backend # backend unittest — needs a Python with fastapi, e.g.
                     # ~/01_Source/12_hermes-agent/venv/bin/python -m unittest discover -s tests/backend -v
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

A manually placed window stays exactly there — refreshes and board switches do
not move it, and it **survives leaving and re-entering the view** (persisted
via `ctx.storage['window']`); the `↺ window` chip resets it to the default.
The "now" line only shows while now is inside the window; today's calendar
cell stays highlighted. A row appears iff at least one of the task's segments (waiting
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
  currently **blocked** task's waiting span is dashed **amber** (`--kg-blocked`).
- **Run spans — solid, exact**: `[started_at, ended_at]` at their real
  length — short runs are **never stretched** (below 3 px they collapse to a
  dot marker; zoom in for the exact width). A span still in progress ends at
  *now* and glows green (`--kg-live`); **hard failures** (`crashed`, `failed`,
  `spawn_failed`, `gave_up`) are red (`--kg-fail`); a run that ended
  **`blocked`** (awaiting human input) is amber (`--kg-blocked`); everything else —
  including `timed_out` and `rate_limited`, which are normal workflow events —
  is the standard blue (`--kg-run`).
- **Hand-completed tasks** (no run record) get a waiting span plus a small
  round marker at `completed_at` ("unknown duration").

**Rows** appear iff at least one segment overlaps the window, ordered **by
recency — running first**; a parent floats up with its subtree, children stay
nested. Segment tooltips show exact durations ("waiting (3h5m so far)",
"failed run (12m)").

**Status symbols (v0.1.5).** Every status is a 14 px inline-SVG glyph in the
row strip, the filter menus, the drawer badge and the legend — colour is the
second channel, not the only one (WCAG 1.4.1). The nine silhouettes are
`triage` inbox, `todo` hollow ring, `scheduled` calendar, `ready` arrow,
`running` 3/4 arc + centre dot, `blocked` octagon with a bold slash, `review`
eye, `done` filled disc with a knocked-out check (fill-rule=evenodd — never a
white stroke, rows are zebra-striped) and `archived` box. Measured on the
rasterised 14 px bitmaps, the closest pair of the 36 pairs differs in 38 % of
its ink and the median pair in 68 % (an all-circles variant scored 11 %, which
is why `ready` is a bare arrow and `blocked` an octagon).

**Palette.** One token table (`--kg-*`) feeds both the glyphs and the bars, in
two sets: `:root` (light) and `:root.dark`, so the app's theme switch is
enough — no JS. The seven chromatic tones are colour-separated (CIEDE2000 ≥ 19
on dark / ≥ 16 on light) and every token is ≥ 3:1 against its chrome
background (WCAG 1.4.11). The five neutral tones (`wait`, `triage`, `todo`,
`done`, `archived`) are one grey ladder on purpose: shape tells them apart.
`running` and the live segment share `--kg-live`, `blocked` shares
`--kg-blocked`, so a row and its bar can never disagree. The legend lists the
eight statuses that can render (archived tasks never do) with a live count
each; clicking one still toggles its visibility.

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

Model v0.1.5 additions: nine status glyphs replace the colour dots (shape is
the primary cue, measured 38 %/68 % ink separation), and the palette became a
single `--kg-*` token table with measured light/dark values — the previous two
hardcoded tables collided (wait/done ΔE00 4.9, run/ready 6.8; now 16.9 and
22.1).
