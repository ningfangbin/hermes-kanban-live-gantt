// src/core/gantt-core.ts
var DAY = 86400;
var MIN_BAR = 2 * 3600;
var STATUS_TONE = {
  triage: "var(--ui-text-tertiary)",
  todo: "var(--ui-text-secondary)",
  scheduled: "#a78bfa",
  ready: "#60a5fa",
  running: "#34d399",
  blocked: "#f87171",
  review: "#fbbf24",
  done: "var(--ui-text-tertiary)",
  archived: "var(--ui-text-quaternary)"
};
function statusTone(status) {
  return STATUS_TONE[status] || "var(--ui-text-secondary)";
}
function barRange(task, now, minBarSec) {
  const min = minBarSec || MIN_BAR;
  const rs = task.run_started_at;
  const re = task.run_ended_at;
  const realRun = rs != null && re != null && rs < re;
  if (task.status === "done" || task.status === "archived") {
    if (realRun) {
      return { t0: rs, t1: Math.max(rs + min, re), kind: "done", tone: statusTone(task.status) };
    }
    const anchor = task.completed_at ?? task.created_at;
    if (anchor == null) return null;
    return { t0: anchor, t1: anchor + min, kind: "done-instant" };
  }
  if (task.status === "running" || task.status === "review") {
    const start = task.run_started_at ?? task.started_at ?? task.created_at ?? now;
    return { t0: start, t1: Math.max(start + min, now), kind: "progress", tone: statusTone(task.status) };
  }
  if (task.started_at) {
    return { t0: task.started_at, t1: now, kind: "progress", tone: statusTone(task.status) };
  }
  const c = task.created_at;
  return c ? { t0: c, t1: c + min, kind: "todo", tone: statusTone(task.status) } : null;
}
function taskBars(task, now, minBarSec) {
  const min = minBarSec || MIN_BAR;
  const runs = Array.isArray(task.runs) ? task.runs : [];
  const validRuns = runs.filter((r) => r && r.started_at != null);
  if (validRuns.length > 1) {
    const bars = [];
    for (const r of validRuns) {
      const s = r.started_at;
      const e = r.ended_at;
      const isOngoing = (e == null || r.status === "running") && (task.status === "running" || task.status === "review");
      const t1 = isOngoing ? Math.max(s + min, now) : e != null ? Math.max(s + min, e) : s + min;
      const isFailed = ["crashed", "failed", "timed_out", "gave_up", "blocked"].includes(r.outcome || r.status);
      const tone = isOngoing ? statusTone("running") : isFailed ? statusTone("blocked") : statusTone(r.outcome === "completed" || r.status === "completed" || r.status === "done" ? "done" : "review");
      bars.push({
        t0: s,
        t1,
        kind: isOngoing ? "progress" : "done",
        tone,
        runId: r.id,
        profile: r.profile,
        outcome: r.outcome || r.status,
        isOngoing
      });
    }
    return bars;
  }
  const single = barRange(task, now, min);
  return single ? [single] : [];
}
function shortId(id) {
  return (id || "").replace(/^t_/, "").slice(0, 6);
}
function matchesSearch(task, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const label = (task.label || "").toLowerCase();
  const title = (task.title || "").toLowerCase();
  return label.includes(q) || title.includes(q);
}
function buildRows(tasks) {
  const set = new Set(tasks.map((t) => t.id));
  const byId = {};
  for (const t of tasks) byId[t.id] = t;
  const adj = /* @__PURE__ */ new Map();
  for (const t of tasks) adj.set(t.id, (t.children || []).filter((c) => set.has(c)));
  const hasParent = /* @__PURE__ */ new Set();
  for (const t of tasks) {
    for (const p of t.parents || []) if (set.has(p)) hasParent.add(t.id);
  }
  const roots = tasks.filter((t) => !hasParent.has(t.id));
  const rows = [];
  const visited = /* @__PURE__ */ new Set();
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
function isActive(task) {
  if (!task) return false;
  const s = task.status;
  return s !== "done" && s !== "archived" && !task.archived;
}
function localDayStart(sec) {
  const d = new Date(sec * 1e3);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1e3);
}
function dayStartsBetween(min, max) {
  const out = [];
  let t = localDayStart(min);
  while (t < max) {
    if (t + DAY > min) out.push(t);
    t = localDayStart(t + DAY + 3600);
  }
  return out;
}
var WINDOW_BACK = 24 * 3600;
var WINDOW_AHEAD = 48 * 3600;
var MIN_WINDOW = 2 * 3600;
function splitDuration(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor(s % 86400 / 3600),
    m: Math.floor(s % 3600 / 60),
    s: s % 60
  };
}
function computeRollingDomain(nowSec) {
  return { min: nowSec - WINDOW_BACK, max: nowSec + WINDOW_AHEAD };
}
function slideWindow(win, deltaSec) {
  return { min: win.min + deltaSec, max: win.max + deltaSec };
}
function slideWindowByPixels(win, dxPx, pxPerSec) {
  return slideWindow(win, -dxPx / pxPerSec);
}
function resizeWindow(win, edge, tSec) {
  if (edge === "start") return { min: Math.min(tSec, win.max - MIN_WINDOW), max: win.max };
  return { min: win.min, max: Math.max(tSec, win.min + MIN_WINDOW) };
}
function daySegments(min, max) {
  const out = [];
  let s = min;
  while (s < max) {
    const dayStart = localDayStart(s);
    const end = Math.min(localDayStart(dayStart + DAY + 3600), max);
    out.push({ start: s, end, dayStart });
    s = end;
  }
  return out;
}
function taskVisible(task, showDone, nowSec, min, max) {
  if (isActive(task)) return true;
  if (!showDone || !task || task.status !== "done" || task.archived) return false;
  return taskBars(task, nowSec).some((b) => barInWindow(b, min, max));
}
function barInWindow(bar, min, max) {
  return !!bar && bar.t1 != null && bar.t1 > min && bar.t0 < max;
}
function hourTickPlan(min, max, pxPerSec) {
  const hourPx = pxPerSec * 3600;
  if (hourPx < 24) return { major: [], minor: [] };
  let step = 0;
  for (const s of [1, 2, 3, 6, 12]) {
    if (s * hourPx >= 56) {
      step = s;
      break;
    }
  }
  if (!step) step = 12;
  const minorStepMin = hourPx >= 200 ? 15 : hourPx >= 96 ? 30 : 0;
  const major = [];
  const minor = [];
  for (let t = Math.ceil(min / 900) * 900; t < max; t += 900) {
    const d = new Date(t * 1e3);
    const h = d.getHours();
    const m = d.getMinutes();
    if (m === 0) {
      if (h % step === 0) major.push(t);
      else minor.push(t);
    } else if (minorStepMin && m % minorStepMin === 0) {
      minor.push(t);
    }
  }
  return { major, minor };
}
export {
  DAY,
  MIN_BAR,
  MIN_WINDOW,
  WINDOW_AHEAD,
  WINDOW_BACK,
  barInWindow,
  barRange,
  buildRows,
  computeRollingDomain,
  daySegments,
  dayStartsBetween,
  hourTickPlan,
  isActive,
  localDayStart,
  matchesSearch,
  resizeWindow,
  shortId,
  slideWindow,
  slideWindowByPixels,
  splitDuration,
  statusTone,
  taskBars,
  taskVisible
};
