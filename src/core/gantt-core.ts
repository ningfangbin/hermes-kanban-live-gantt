/** Pure timeline logic for the live Gantt view — forked from the kanban-gantt core
 * (https://github.com/e-is/hermes-kanban-gantt — (c) e-is, GPL-3.0; modified
 * 2026-09-29 by ningfangbin, same license). No React, no SDK: this module is
 * unit-testable as-is.
 *
 * Live view = a default 72 h window, now − 24h → now + 48h (local wall clock,
 * never a fixed day-count window). The window itself is slidable: the helpers
 * below move it as a whole (slideWindow) or one edge at a time (resizeWindow);
 * the UI re-anchors it to "now" on refresh until the user moves it. Open work
 * always shows; done tasks only when explicitly enabled AND they have activity
 * inside the window. */

export const DAY = 86_400;
export const MIN_BAR = 2 * 3600;
// Official Kanban plugin status tones (COLUMN_META, types.ts) — unified style
const STATUS_TONE = {
  triage:   'var(--ui-text-tertiary)',
  todo:     'var(--ui-text-secondary)',
  scheduled:'#a78bfa',
  ready:    '#60a5fa',
  running:  '#34d399',
  blocked:  '#f87171',
  review:   '#fbbf24',
  done:     'var(--ui-text-tertiary)',
  archived: 'var(--ui-text-quaternary)'
};
export function statusTone(status) {
  return STATUS_TONE[status] || 'var(--ui-text-secondary)';
}
export function barRange(task, now, minBarSec) {
  const min = minBarSec || MIN_BAR;
  // Real execution window (a worker actually ran the task) — the truth for
  // done durations. Hand-only completions carry run_started_at == null.
  const rs = task.run_started_at;
  const re = task.run_ended_at;
  const realRun = rs != null && re != null && rs < re;

  if (task.status === 'done' || task.status === 'archived') {
    if (realRun) {
      return { t0: rs, t1: Math.max(rs + min, re), kind: 'done', tone: statusTone(task.status) };
    }
    // no real run: unknown duration -> minimal bar anchored on completion
    const anchor = task.completed_at ?? task.created_at;
    if (anchor == null) return null;
    return { t0: anchor, t1: anchor + min, kind: 'done-instant' };
  }
  if (task.status === 'running' || task.status === 'review') {
    const start = task.run_started_at ?? task.started_at ?? task.created_at ?? now;
    // ensure running bar always extends to at least now (and at least minBar)
    return { t0: start, t1: Math.max(start + min, now), kind: 'progress', tone: statusTone(task.status) };
  }
  if (task.started_at) {
    // claimed but unfinished (ready edge case) — run start is real
    return { t0: task.started_at, t1: now, kind: 'progress', tone: statusTone(task.status) };
  }
  const c = task.created_at;
  return c ? { t0: c, t1: c + min, kind: 'todo', tone: statusTone(task.status) } : null;
}
export function taskBars(task, now, minBarSec) {
  const min = minBarSec || MIN_BAR;
  // If the task carries a list of recorded runs with timestamps, create a bar for each real run
  const runs = Array.isArray(task.runs) ? task.runs : [];
  const validRuns = runs.filter(r => r && r.started_at != null);

  if (validRuns.length > 1) {
    const bars = [];
    for (const r of validRuns) {
      const s = r.started_at;
      const e = r.ended_at;
      const isOngoing = (e == null || r.status === 'running') && (task.status === 'running' || task.status === 'review');
      const t1 = isOngoing ? Math.max(s + min, now) : (e != null ? Math.max(s + min, e) : s + min);
      const isFailed = ['crashed', 'failed', 'timed_out', 'gave_up', 'blocked'].includes(r.outcome || r.status);
      const tone = isOngoing
        ? statusTone('running')
        : isFailed
          ? statusTone('blocked')
          : statusTone(r.outcome === 'completed' || r.status === 'completed' || r.status === 'done' ? 'done' : 'review');
      bars.push({
        t0: s,
        t1,
        kind: isOngoing ? 'progress' : 'done',
        tone,
        runId: r.id,
        profile: r.profile,
        outcome: r.outcome || r.status,
        isOngoing
      });
    }
    return bars;
  }

  // Fallback to single consolidated bar
  const single = barRange(task, now, min);
  return single ? [single] : [];
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
export function buildRows(tasks) {
  const set = new Set(tasks.map(t => t.id));
  const byId = {};
  for (const t of tasks) byId[t.id] = t;
  const adj = new Map();
  for (const t of tasks) adj.set(t.id, (t.children || []).filter(c => set.has(c)));
  const hasParent = new Set();
  for (const t of tasks) {
    for (const p of t.parents || []) if (set.has(p)) hasParent.add(t.id);
  }
  const roots = tasks.filter(t => !hasParent.has(t.id));
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

/* ─────────────────────────── day-view window ────────────────────────────────
   Rolling [now − 24h, now + 24h] in the machine's local timezone. */

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

/** Day-view visibility: open work always; `done` tasks only when `showDone`
 *  is on AND they have activity inside the window. Archived never shows. */
export function taskVisible(task, showDone, nowSec, min, max) {
  if (isActive(task)) return true;
  if (!showDone || !task || task.status !== 'done' || task.archived) return false;
  return taskBars(task, nowSec).some(b => barInWindow(b, min, max));
}

/** Does `bar` overlap the [min, max) window? (bars outside are not drawn) */
export function barInWindow(bar, min, max) {
  return !!bar && bar.t1 != null && bar.t1 > min && bar.t0 < max;
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
