// src/core/gantt-core.ts
var DAY = 86400;
var STATUS_TONE = {
  triage: "var(--ui-text-tertiary)",
  todo: "var(--ui-text-secondary)",
  scheduled: "#a78bfa",
  ready: "#4d9fff",
  running: "#34d399",
  blocked: "#e0a13a",
  review: "#f472b6",
  done: "#7c8798",
  archived: "var(--ui-text-quaternary)"
};
var SEG_TONE = {
  wait: "#8a9099",
  // created→run / retry gaps (dashed)
  blocked: "#e0a13a",
  // blocked: waiting (dashed) or a run that ended blocked (solid)
  run: "#5b8def",
  // finished run span (exact length; incl. timed_out / rate_limited)
  fail: "#ef5350",
  // hard failure — crashed / failed / spawn_failed / gave_up
  live: "#34d399"
  // currently running (ends at "now")
};
function statusTone(status) {
  return STATUS_TONE[status] || "var(--ui-text-secondary)";
}
function taskSegments(task, nowSec) {
  if (!task) return [];
  const now = nowSec != null ? nowSec : Math.floor(Date.now() / 1e3);
  const done = task.status === "done" || task.status === "archived";
  const out = [];
  const runsRaw = [];
  if (Array.isArray(task.runs)) {
    for (const r of task.runs) {
      if (!r || r.started_at == null) continue;
      runsRaw.push({ s: r.started_at, e: r.ended_at != null ? r.ended_at : null, id: r.id, outcome: r.outcome || r.status });
    }
  } else if (task.run_started_at != null) {
    runsRaw.push({ s: task.run_started_at, e: task.run_ended_at != null ? task.run_ended_at : null, id: null, outcome: null });
  } else if (!done && task.started_at != null) {
    runsRaw.push({ s: task.started_at, e: null, id: null, outcome: "running" });
  }
  if (!runsRaw.length) {
    if (done) {
      const anchor = task.completed_at ?? task.created_at;
      if (anchor != null) {
        if (task.created_at != null && task.created_at < anchor) {
          out.push({ kind: "wait", t0: task.created_at, t1: anchor, tone: "wait" });
        }
        out.push({ kind: "run", t0: anchor, t1: anchor, tone: "run", instant: true });
      }
    } else if (task.created_at != null && now > task.created_at) {
      out.push({ kind: "wait", t0: task.created_at, t1: now, tone: task.status === "blocked" ? "blocked" : "wait", ongoing: true });
    }
    return out;
  }
  runsRaw.sort((a, b) => a.s - b.s || (a.e ?? now) - (b.e ?? now));
  const runs = [];
  for (const r of runsRaw) {
    const open = r.e == null && !done;
    const end = r.e != null ? r.e : open ? now : done ? null : now;
    const prev = runs[runs.length - 1];
    if (prev && r.s <= (prev.e ?? now)) {
      if ((end ?? now) > (prev.e ?? now)) prev.e = end;
      continue;
    }
    runs.push({ s: r.s, e: end, open, id: r.id, outcome: r.outcome });
  }
  let cursor = task.created_at != null ? task.created_at : runs[0].s;
  for (const r of runs) {
    if (r.s > cursor) out.push({ kind: "wait", t0: cursor, t1: r.s, tone: "wait" });
    let end = r.e;
    if (end == null) {
      end = done ? task.completed_at != null && task.completed_at > r.s ? task.completed_at : r.s : now;
    }
    const failed = ["crashed", "failed", "spawn_failed", "gave_up"].includes(r.outcome);
    const live = r.open === true;
    out.push({
      kind: "run",
      t0: r.s,
      t1: end,
      tone: live ? "live" : failed ? "fail" : r.outcome === "blocked" ? "blocked" : "run",
      ongoing: live,
      runId: r.id,
      outcome: r.outcome
    });
    if (end > cursor) cursor = end;
  }
  if (!done && cursor < now) {
    out.push({ kind: "wait", t0: cursor, t1: now, tone: task.status === "blocked" ? "blocked" : "wait", ongoing: true });
  }
  return out;
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
function taskRecency(task, nowSec) {
  const now = nowSec != null ? nowSec : Math.floor(Date.now() / 1e3);
  if (!task) return 0;
  if (task.status === "running") return now;
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
  if (last == null && task.status === "done" && task.completed_at != null) last = task.completed_at;
  if (last == null) last = task.created_at ?? 0;
  return last;
}
function buildRows(tasks, nowSec) {
  const set = new Set(tasks.map((t) => t.id));
  const byId = {};
  for (const t of tasks) byId[t.id] = t;
  const adj = /* @__PURE__ */ new Map();
  for (const t of tasks) adj.set(t.id, (t.children || []).filter((c) => set.has(c)));
  const hasParent = /* @__PURE__ */ new Set();
  for (const t of tasks) {
    for (const p of t.parents || []) if (set.has(p)) hasParent.add(t.id);
  }
  const key = /* @__PURE__ */ new Map();
  const inFlight = /* @__PURE__ */ new Set();
  const subtreeKey = (id) => {
    if (key.has(id)) return key.get(id);
    if (inFlight.has(id)) return 0;
    inFlight.add(id);
    const t = byId[id];
    let k = t ? taskRecency(t, nowSec) : 0;
    for (const c of adj.get(id) || []) k = Math.max(k, subtreeKey(c));
    inFlight.delete(id);
    key.set(id, k);
    return k;
  };
  const byRecency = (a, b) => subtreeKey(b) - subtreeKey(a);
  const roots = tasks.filter((t) => !hasParent.has(t.id)).sort((x, y) => byRecency(x.id, y.id));
  for (const id of adj.keys()) adj.get(id).sort(byRecency);
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
  if (!task || task.archived || task.status === "archived") return false;
  if (!isActive(task) && !showDone) return false;
  return taskSegments(task, nowSec).some((s) => barInWindow(s, min, max));
}
function barInWindow(bar, min, max) {
  if (!bar || bar.t1 == null) return false;
  if (bar.t0 === bar.t1) return bar.t0 >= min && bar.t0 <= max;
  return bar.t1 > min && bar.t0 < max;
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
  MIN_WINDOW,
  SEG_TONE,
  WINDOW_AHEAD,
  WINDOW_BACK,
  barInWindow,
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
  taskRecency,
  taskSegments,
  taskVisible
};
