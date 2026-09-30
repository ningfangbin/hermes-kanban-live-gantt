/** Pure timeline logic for the live Gantt view — forked from the kanban-gantt core
 * (https://github.com/e-is/hermes-kanban-gantt — (c) e-is, GPL-3.0; modified
 * 2026-09-29/30 by ningfangbin, same license). No React, no SDK: this module is
 * unit-testable as-is.
 *
 * Live view = a default 72 h window, now − 24h → now + 48h (local wall clock,
 * never a fixed day-count window). The window itself is slidable: the helpers
 * below move it as a whole (slideWindow) or one edge at a time (resizeWindow);
 * the UI re-anchors it to "now" on refresh until the user moves it.
 *
 * Rendering model (v0.1.3): every task is an alternating sequence of WAIT spans
 * (created → first run, gaps between runs, last run → now while unfinished —
 * dashed) and RUN spans (exact real durations, never stretched, never past
 * now) — see taskSegments(). A row shows iff at least one of its segments
 * overlaps the window. Rows are ordered by recency (running first), children
 * kept under their parents — see buildRows(). */

export const DAY = 86_400;
// Status tones — deliberately DIVERGED from the official kanban column colors
// (kanban-gantt parity was dropped on purpose: the amber/red/blue clusters were
// indistinguishable in the timeline). Semantics: red = failure only, amber =
// blocked only, green = live only, pink = review, blue = ready, slate = done.
const STATUS_TONE = {
  triage:   'var(--ui-text-tertiary)',
  todo:     'var(--ui-text-secondary)',
  scheduled:'#a78bfa',
  ready:    '#4d9fff',
  running:  '#34d399',
  blocked:  '#e0a13a',
  review:   '#f472b6',
  done:     '#7c8798',
  archived: 'var(--ui-text-quaternary)'
};
// Segment tones — one hue per segment MEANING (see taskSegments).
export const SEG_TONE = {
  wait:    '#8a9099', // created→run / retry gaps (dashed)
  blocked: '#e0a13a', // waiting while the task is blocked (dashed, amber)
  run:     '#5b8def', // finished run span (exact length)
  fail:    '#ef5350', // failed run span (crashed/failed/timed_out/…)
  live:    '#34d399'  // currently running (ends at "now")
};
export function statusTone(status) {
  return STATUS_TONE[status] || 'var(--ui-text-secondary)';
}
/** The task's lifecycle as alternating WAIT / RUN segments (seconds).
 *
 *   wait — created → first run, gaps between runs, and (while unfinished)
 *          last run end → now. `ongoing: true` marks the trailing wait.
 *   run  — one per real run, EXACT span [started_at, ended_at]: never
 *          stretched, never past now; `ongoing: true` while still running.
 *          tone: 'run' | 'fail' (crashed/failed/timed_out/gave_up/blocked) |
 *          'live' (still running). `instant: true` marks a hand-completed
 *          task with no run record (zero-width marker at completed_at).
 * Wait tone: 'blocked' while the task is currently blocked, else 'wait'.
 * The renderer clips every segment to the window. */
export function taskSegments(task, nowSec) {
  if (!task) return [];
  const now = nowSec != null ? nowSec : Math.floor(Date.now() / 1000);
  const done = task.status === 'done' || task.status === 'archived';
  const out = [];

  // Real runs: the runs[] history when present, else the consolidated fields.
  const runsRaw = [];
  if (Array.isArray(task.runs)) {
    for (const r of task.runs) {
      if (!r || r.started_at == null) continue;
      runsRaw.push({ s: r.started_at, e: r.ended_at != null ? r.ended_at : null, id: r.id, outcome: r.outcome || r.status });
    }
  } else if (task.run_started_at != null) {
    runsRaw.push({ s: task.run_started_at, e: task.run_ended_at != null ? task.run_ended_at : null, id: null, outcome: null });
  } else if (!done && task.started_at != null) {
    runsRaw.push({ s: task.started_at, e: null, id: null, outcome: 'running' });
  }

  if (!runsRaw.length) {
    // No run records: hand-completed → wait span + instant marker; still-open
    // → the waiting span runs from creation to now.
    if (done) {
      const anchor = task.completed_at ?? task.created_at;
      if (anchor != null) {
        if (task.created_at != null && task.created_at < anchor) {
          out.push({ kind: 'wait', t0: task.created_at, t1: anchor, tone: 'wait' });
        }
        out.push({ kind: 'run', t0: anchor, t1: anchor, tone: 'run', instant: true });
      }
    } else if (task.created_at != null && now > task.created_at) {
      out.push({ kind: 'wait', t0: task.created_at, t1: now, tone: task.status === 'blocked' ? 'blocked' : 'wait', ongoing: true });
    }
    return out;
  }

  // Sort by start; merge overlapping / touching spans (data noise, retries).
  runsRaw.sort((a, b) => a.s - b.s || (a.e ?? now) - (b.e ?? now));
  const runs = [];
  for (const r of runsRaw) {
    const open = r.e == null && !done; // still-running span (no end recorded)
    const end = r.e != null ? r.e : (open ? now : (done ? null : now));
    const prev = runs[runs.length - 1];
    if (prev && r.s <= (prev.e ?? now)) {
      if ((end ?? now) > (prev.e ?? now)) prev.e = end;
      continue;
    }
    runs.push({ s: r.s, e: end, open, id: r.id, outcome: r.outcome });
  }

  let cursor = task.created_at != null ? task.created_at : runs[0].s;
  for (const r of runs) {
    if (r.s > cursor) out.push({ kind: 'wait', t0: cursor, t1: r.s, tone: 'wait' });
    let end = r.e;
    if (end == null) {
      end = done ? (task.completed_at != null && task.completed_at > r.s ? task.completed_at : r.s) : now;
    }
    const failed = ['crashed', 'failed', 'timed_out', 'gave_up', 'blocked', 'rate_limited'].includes(r.outcome);
    const live = r.open === true;
    out.push({
      kind: 'run', t0: r.s, t1: end,
      tone: live ? 'live' : failed ? 'fail' : 'run',
      ongoing: live, runId: r.id, outcome: r.outcome
    });
    if (end > cursor) cursor = end;
  }
  if (!done && cursor < now) {
    out.push({ kind: 'wait', t0: cursor, t1: now, tone: task.status === 'blocked' ? 'blocked' : 'wait', ongoing: true });
  }
  return out;
}
export function shortId(id) {
  return (id || '').replace(/^t_/, '').slice(0, 6)
}

export function matchesSearch(task, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  const label = (task.label || '').toLowerCase();
  const title = (task.title || '').toLowerCase();
  return label.includes(q) || title.includes(q);
}
/** Recency key for row ordering: running → now; else the latest recorded run
 *  activity; never-run → created; done without runs → completed. */
export function taskRecency(task, nowSec) {
  const now = nowSec != null ? nowSec : Math.floor(Date.now() / 1000);
  if (!task) return 0;
  if (task.status === 'running') return now;
  let last = null;
  if (Array.isArray(task.runs)) {
    for (const r of task.runs) {
      if (!r || r.started_at == null) continue;
      const e = r.ended_at != null ? r.ended_at : r.started_at;
      if (last == null || e > last) last = e;
    }
  }
  if (last == null && task.run_ended_at != null) last = task.run_ended_at;
  if (last == null && task.run_started_at != null) last = task.run_started_at;
  if (last == null && task.status === 'done' && task.completed_at != null) last = task.completed_at;
  if (last == null) last = task.created_at ?? 0;
  return last;
}

/** Flatten tasks into parent→child rows; siblings ordered by recency DESC
 *  (running / most recently active first) using each subtree's max recency,
 *  so a parent whose child is running floats to the top with it. Children
 *  stay nested under their parent. */
export function buildRows(tasks, nowSec) {
  const set = new Set(tasks.map(t => t.id));
  const byId = {};
  for (const t of tasks) byId[t.id] = t;
  const adj = new Map();
  for (const t of tasks) adj.set(t.id, (t.children || []).filter(c => set.has(c)));
  const hasParent = new Set();
  for (const t of tasks) {
    for (const p of t.parents || []) if (set.has(p)) hasParent.add(t.id);
  }
  const key = new Map();
  const inFlight = new Set();
  const subtreeKey = id => {
    if (key.has(id)) return key.get(id);
    if (inFlight.has(id)) return 0; // cycle guard
    inFlight.add(id);
    const t = byId[id];
    let k = t ? taskRecency(t, nowSec) : 0;
    for (const c of adj.get(id) || []) k = Math.max(k, subtreeKey(c));
    inFlight.delete(id);
    key.set(id, k);
    return k;
  };
  const byRecency = (a, b) => subtreeKey(b) - subtreeKey(a);
  const roots = tasks.filter(t => !hasParent.has(t.id)).sort((x, y) => byRecency(x.id, y.id));
  for (const id of adj.keys()) adj.get(id).sort(byRecency);
  const rows = [];
  const visited = new Set();
  const walk = (id, depth, isChild) => {
    if (visited.has(id)) return;
    visited.add(id);
    rows.push({ task: byId[id], depth, isChild });
    for (const c of adj.get(id) || []) walk(c, depth + 1, true);
  };
  for (const r of roots) walk(r.id, 0, false);
  for (const t of tasks) walk(t.id, 0, Boolean(hasParent.has(t.id)));
  return rows;
}

/* ─────────────────────────── window helpers ─────────────────────────────────
   Rolling 72 h window (now − 24h → now + 48h) in the machine's local timezone. */

/** Open work? (done / archived are hidden by default — see taskVisible). */
export function isActive(task) {
  if (!task) return false;
  const s = task.status;
  return s !== 'done' && s !== 'archived' && !task.archived;
}

/** Local midnight (machine timezone) of the day containing `sec`. */
export function localDayStart(sec) {
  const d = new Date(sec * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
}

/** Local day starts (step = 1 calendar day) of every day overlapping [min, max). */
export function dayStartsBetween(min, max) {
  const out = [];
  let t = localDayStart(min);
  while (t < max) {
    if (t + DAY > min) out.push(t);
    t = localDayStart(t + DAY + 3600); // +1h guard — DST-safe next local midnight
  }
  return out;
}

export const WINDOW_BACK = 24 * 3600;   // default window: now − 24 h …
export const WINDOW_AHEAD = 48 * 3600;  // … → now + 48 h (72 h total)
export const MIN_WINDOW = 2 * 3600;     // edge drags never shrink below 2 h

/** Split a duration in seconds into day/hour/minute/second parts — for bar
 *  tooltips (computed from raw run spans, never from window-clamped bars). */
export function splitDuration(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60
  };
}

/** The default day-view window — anchored on the current moment, not on a
 *  fixed day count; the UI re-anchors it on refresh until the user slides it. */
export function computeRollingDomain(nowSec) {
  return { min: nowSec - WINDOW_BACK, max: nowSec + WINDOW_AHEAD };
}

/** Slide the whole window in time (both edges move together). */
export function slideWindow(win, deltaSec) {
  return { min: win.min + deltaSec, max: win.max + deltaSec };
}

/** Window slide from a ruler drag: dragging right pulls the window back in
 *  time, so the timeline follows the pointer one pixel per pixel. */
export function slideWindowByPixels(win, dxPx, pxPerSec) {
  return slideWindow(win, -dxPx / pxPerSec);
}

/** Move ONE edge of the window to `tSec` (clamped so the span stays ≥
 *  MIN_WINDOW). `edge` is 'start' or 'end'. */
export function resizeWindow(win, edge, tSec) {
  if (edge === 'start') return { min: Math.min(tSec, win.max - MIN_WINDOW), max: win.max };
  return { min: win.min, max: Math.max(tSec, win.min + MIN_WINDOW) };
}

/** [min, max) split into local-calendar-day segments — the rolling window
 *  never starts at midnight, so the first/last segments are partial. */
export function daySegments(min, max) {
  const out = [];
  let s = min;
  while (s < max) {
    const dayStart = localDayStart(s);
    const end = Math.min(localDayStart(dayStart + DAY + 3600), max); // +1h guard — next local midnight
    out.push({ start: s, end, dayStart });
    s = end;
  }
  return out;
}

/** Window-consistent visibility: a task shows iff at least one of its
 *  lifecycle segments overlaps the window; `done` additionally requires the
 *  showDone toggle; archived never shows. */
export function taskVisible(task, showDone, nowSec, min, max) {
  if (!task || task.archived || task.status === 'archived') return false;
  if (!isActive(task) && !showDone) return false;
  return taskSegments(task, nowSec).some(s => barInWindow(s, min, max));
}

/** Does the span overlap the [min, max] window? (outside spans are not drawn)
 *  Zero-width spans — instant markers — count while inside the window. */
export function barInWindow(bar, min, max) {
  if (!bar || bar.t1 == null) return false;
  if (bar.t0 === bar.t1) return bar.t0 >= min && bar.t0 <= max;
  return bar.t1 > min && bar.t0 < max;
}

/** Hour tick plan for the live view (free zoom).
 *  major = labelled hour lines, spacing kept ≥ 56 px (step 1/2/3/6/12 h);
 *  minor = light :15/:30/:45 (deep zoom) or :30 lines, plus odd hours when
 *  the major step skips them. Both empty below ~24 px per hour, where the
 *  day cells alone are dense enough. */
export function hourTickPlan(min, max, pxPerSec) {
  const hourPx = pxPerSec * 3600
  if (hourPx < 24) return { major: [], minor: [] }
  let step = 0
  for (const s of [1, 2, 3, 6, 12]) {
    if (s * hourPx >= 56) { step = s; break }
  }
  if (!step) step = 12
  const minorStepMin = hourPx >= 200 ? 15 : hourPx >= 96 ? 30 : 0
  const major = []
  const minor = []
  for (let t = Math.ceil(min / 900) * 900; t < max; t += 900) {
    const d = new Date(t * 1000)
    const h = d.getHours()
    const m = d.getMinutes()
    if (m === 0) {
      if (h % step === 0) major.push(t)
      else minor.push(t)
    } else if (minorStepMin && m % minorStepMin === 0) {
      minor.push(t)
    }
  }
  return { major, minor }
}
