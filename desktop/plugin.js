/*
 * Hermes Kanban Live Gantt — desktop renderer (BUILD ARTIFACT).
 * Source of truth: src/ — run `npm run build` after editing.
 * Loaded uncompiled by Hermes Desktop; only @hermes/plugin-sdk, react
 * and react/jsx-runtime are importable specifiers.
 */

// src/main.ts
import {
  atom,
  Badge,
  Button,
  cn,
  Codicon,
  Contribute,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  host,
  Loader,
  profileColor,
  profileColorSoft,
  Streamdown,
  useMutation,
  usePluginI18n,
  useQuery,
  useQueryClient,
  useValue,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  TITLEBAR_AREAS
} from "@hermes/plugin-sdk";
import { useMemo, useRef, useEffect, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";

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
var WINDOW_BACK = 24 * 3600;
var WINDOW_AHEAD = 48 * 3600;
var MIN_WINDOW = 2 * 3600;
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

// src/main.ts
var ID = "kanban-live-gantt";
var LABEL_W = 300;
var ROW_H = 28;
var BAR_H = 14;
var MIN_BAR_SEC = 2 * 3600;
var ZOOM_MAX_PX_PER_HOUR = 240;
var rest = null;
var storage = null;
var $baseUrl = atom("");
var $boardSlug = atom("");
var $labelW = atom(LABEL_W);
var $drawerW = atom(416);
var $drawerDocked = atom(false);
var LABEL_W_MIN = 160;
var LABEL_W_MAX = 640;
var DRAWER_W_MIN = 320;
var DRAWER_W_MAX = 720;
var $openTaskId = atom(null);
var apiBase = () => ($baseUrl.get() || "").trim().replace(/\/+$/, "");
var apiFetch = (path, init) => {
  const base = apiBase();
  if (base) {
    return fetch(`${base}${path}`, {
      method: init?.method || "GET",
      headers: init?.body != null ? { "Content-Type": "application/json" } : void 0,
      body: init?.body != null ? JSON.stringify(init.body) : void 0
    }).then((r) => {
      if (!r.ok) throw new Error(`${init?.method || "GET"} ${path} → HTTP ${r.status}`);
      return r.json();
    });
  }
  if (!rest) return Promise.reject(new Error("backend not ready"));
  return rest(path, init?.body != null ? { method: init.method, body: init.body } : void 0);
};
var fetchTask = (id, board) => apiFetch(`/tasks/${encodeURIComponent(id)}${board ? `?board=${encodeURIComponent(board)}` : ""}`);
function NowLine({ min, max, pxPerSec, now, label }) {
  if (now == null || now < min || now > max) return null;
  const left = Math.round((now - min) * pxPerSec);
  return jsxs("div", {
    className: "absolute top-0 bottom-0 pointer-events-none z-10",
    style: { left: `${left}px`, width: "1px", background: "var(--ui-accent)", opacity: 0.5 },
    children: [
      label ? jsx("div", {
        className: "absolute top-0.5 -translate-x-1/2 rounded px-1 py-px text-[8.5px] font-semibold whitespace-nowrap",
        style: { background: "var(--ui-bg-chrome)", color: "var(--ui-accent)", border: "1px solid color-mix(in srgb, var(--ui-accent) 40%, transparent)" },
        children: label
      }) : null
    ]
  });
}
function Ruler({ min, max, pxPerSec, now, onResetView, onWindow }) {
  const i18n = useGanttI18n();
  const rootRef = useRef(null);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const suppressResetRef = useRef(false);
  const beginDrag = (mode) => (event) => {
    if (event.button !== 0 || !rootRef.current) return;
    event.stopPropagation();
    dragRef.current = {
      mode,
      x0: event.clientX,
      left0: rootRef.current.getBoundingClientRect().left,
      startWin: { min, max },
      moved: false,
      pointerId: event.pointerId
    };
    setDragging(true);
    try {
      rootRef.current.setPointerCapture(event.pointerId);
    } catch (err) {
    }
  };
  const onPointerMove = (event) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = event.clientX - d.x0;
    if (!d.moved && Math.abs(dx) > 2) d.moved = true;
    if (d.mode === "slide") {
      onWindow(slideWindowByPixels(d.startWin, dx, pxPerSec));
    } else {
      const tSec = d.startWin.min + (event.clientX - d.left0) / pxPerSec;
      onWindow(resizeWindow(d.startWin, d.mode, tSec));
    }
  };
  const endDrag = (event) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDragging(false);
    if (d.moved) suppressResetRef.current = true;
    try {
      rootRef.current && rootRef.current.releasePointerCapture(d.pointerId);
    } catch (err) {
    }
  };
  const dayWidth = pxPerSec * DAY;
  const showWeekday = dayWidth >= 50;
  const todayStart = now != null ? localDayStart(now) : localDayStart(min);
  const cells = [];
  for (const seg of daySegments(min, max)) {
    const t = seg.dayStart;
    const cellStart = seg.start;
    const cellEnd = seg.end;
    const left = Math.round((cellStart - min) * pxPerSec);
    const width = Math.max(1, Math.round((cellEnd - cellStart) * pxPerSec));
    const d = new Date(t * 1e3);
    const isToday = t === todayStart;
    const date = d.toLocaleDateString(void 0, { month: "short", day: "numeric" });
    const weekday = d.toLocaleDateString(void 0, { weekday: "short" }).replace(/\.$/, "");
    cells.push(jsxs("div", {
      className: cn(
        "absolute top-0 bottom-0 flex items-center gap-1.5 border-l border-(--ui-stroke-tertiary) pl-1.5 overflow-hidden",
        isToday && "bg-(--ui-accent)/8"
      ),
      style: { left: `${left}px`, width: `${width}px` },
      children: [
        jsx("span", { className: cn("font-semibold truncate", isToday ? "text-(--ui-accent)" : "text-(--ui-text-secondary)"), children: showWeekday ? weekday : date }),
        jsx("span", { className: "shrink-0 text-(--ui-text-quaternary)", children: showWeekday ? date : null }),
        isToday ? jsx("span", { className: "shrink-0 rounded px-1 py-px font-semibold", style: { background: "var(--ui-accent)", color: "var(--ui-bg-chrome)" }, children: i18n.today }) : null
      ]
    }, t));
  }
  const plan = hourTickPlan(min, max, pxPerSec);
  const ticks = [];
  for (const t of plan.minor) {
    const left = Math.round((t - min) * pxPerSec);
    ticks.push(jsx("div", {
      className: "absolute bottom-0 top-1/2 border-l border-(--ui-stroke-tertiary)/60",
      style: { left: `${left}px` }
    }, "m" + t));
  }
  for (const t of plan.major) {
    if (localDayStart(t) === t) continue;
    const left = Math.round((t - min) * pxPerSec);
    const label = new Date(t * 1e3).toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit", hour12: false });
    ticks.push(jsxs("div", {
      className: "absolute top-0 bottom-0",
      style: { left: `${left}px` },
      children: [
        jsx("div", { className: "absolute top-0 bottom-0 border-l border-(--ui-stroke-tertiary)" }),
        jsx("span", { className: "absolute bottom-0.5 left-1 text-[9px] leading-none tabular-nums text-(--ui-text-quaternary)", children: label })
      ]
    }, "H" + t));
  }
  const nowLabel = now != null && now >= min && now <= max ? `${i18n.now} ${new Date(now * 1e3).toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit" })}` : null;
  const handleAt = (side, style) => jsx("div", {
    onPointerDown: beginDrag(side),
    onDoubleClick: (event) => event.stopPropagation(),
    // a handle is not a reset target
    title: side === "start" ? i18n.dragWindowStart : i18n.dragWindowEnd,
    className: "absolute top-0 bottom-0 z-20 w-2.5 cursor-col-resize flex justify-center group",
    style,
    children: jsx("div", { className: "w-1 h-full rounded-full bg-(--ui-accent)/25 group-hover:bg-(--ui-accent)/70 transition-colors" })
  }, "handle-" + side);
  return jsxs("div", {
    ref: rootRef,
    className: cn(
      "relative border-b border-(--ui-stroke-secondary) select-none text-[10px]",
      dragging ? "cursor-grabbing" : "cursor-grab"
    ),
    style: { height: showWeekday ? "32px" : "24px" },
    title: i18n.zoomHint,
    onPointerDown: beginDrag("slide"),
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick: () => {
      if (suppressResetRef.current) {
        suppressResetRef.current = false;
        return;
      }
      onResetView();
    },
    children: [
      ...cells,
      ...ticks,
      jsx(NowLine, { min, max, pxPerSec, now, label: nowLabel }),
      handleAt("start", { left: 0 }),
      handleAt("end", { left: "100%", marginLeft: "-10px" })
    ]
  });
}
function Bar({ task, bar, pxPerSec, min, max, onOpen }) {
  const i18n = useGanttI18n();
  const start = Math.max(bar.t0, min);
  const end = Math.min(bar.t1 ?? bar.t0, max);
  const left = Math.round((start - min) * pxPerSec);
  const top = Math.round((ROW_H - BAR_H) / 2);
  const tone = bar.tone || statusTone(task.status);
  const style = { top: `${top}px`, height: `${BAR_H}px`, left: `${left}px`, cursor: "pointer" };
  let title = task.title;
  if (bar.kind === "done") {
    style.background = tone === "var(--ui-text-tertiary)" ? "#60a5fa" : tone;
    style.opacity = "0.85";
    title = `${task.title} · ${i18n.tipDone}`;
  } else if (bar.kind === "done-instant") {
    style.background = tone === "var(--ui-text-tertiary)" ? "#60a5fa" : tone;
    style.opacity = "0.55";
    style.width = style.width || "4px";
    style.borderRadius = "999px";
    title = `${task.title} · ${i18n.tipDoneUnknown}`;
  } else if (bar.kind === "progress") {
    style.background = `color-mix(in srgb, ${tone} 22%, transparent)`;
    style.border = `1px solid ${tone}`;
    title = `${task.title} · ${i18n.tipRunning}`;
  } else {
    style.border = `1px dashed ${tone}`;
    style.background = "transparent";
    title = `${task.title} · ${i18n.tipTodo}`;
  }
  style.width = `${Math.max(Math.round((end - start) * pxPerSec), 2)}px`;
  const children = [];
  if (bar.kind === "progress") {
    children.push(jsx("div", {
      className: "absolute rounded-sm",
      style: {
        left: 0,
        top: 0,
        bottom: 0,
        width: "100%",
        background: tone,
        opacity: 0.75
      }
    }));
    if (task.status === "running") {
      children.push(jsx("div", { className: "kg-arc", style: { "--kanban-tone": tone } }));
    }
  }
  const onClick = onOpen ? () => onOpen(task.id) : void 0;
  if (bar.kind === "done" || bar.kind === "done-instant") {
    return jsx("div", { className: "absolute rounded-sm kg-bar hover:brightness-110 transition-all", style, title, onClick });
  }
  return jsxs("div", { className: "absolute rounded-sm kg-bar hover:brightness-110 transition-all", style, title, onClick, children });
}
function cleanTitle(title, label, untitled) {
  if (!title) return untitled || "(untitled)";
  let t = title.trim();
  if (t.startsWith("[")) {
    const idx = t.indexOf("]");
    if (idx > 0) {
      t = t.slice(idx + 1).trim();
    }
  }
  return t || title;
}
function ResizeHandle({ get, set, min, max, resetTo, storageKey, growDirection = "right" }) {
  const drag = useRef(null);
  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { startPointer: e.clientX, startW: get() };
    const onMove = (ev) => {
      const d = drag.current;
      if (!d) return;
      const delta = growDirection === "right" ? ev.clientX - d.startPointer : d.startPointer - ev.clientX;
      set(Math.min(max, Math.max(min, Math.round(d.startW + delta))));
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (storage) storage.set(storageKey, String(get()));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return jsx("div", {
    onPointerDown,
    onDoubleClick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      set(resetTo);
      if (storage) storage.set(storageKey, String(resetTo));
    },
    className: cn(
      "absolute z-40 touch-none transition-colors hover:bg-(--ui-accent)/30 active:bg-(--ui-accent)/50 cursor-col-resize"
    ),
    style: {
      touchAction: "none",
      // Inline positioning: negative Tailwind offsets may be missing from the
      // desktop's compiled CSS, which shifts the drawer handle ~16px inward.
      top: 0,
      bottom: 0,
      ...growDirection === "right" ? { right: -5, width: 10 } : { left: -4, width: 8 }
    },
    role: "separator",
    "aria-orientation": "vertical"
  });
}
function TaskRow({ task, depth, isChild, now, pxPerSec, min, max, timelineW, onOpen, isSelected, isChecked, onToggleCheck, isEven, showBoardBadge }) {
  const i18n = useGanttI18n();
  const labelW = useValue($labelW);
  const bars = taskBars(task, now).filter((b) => barInWindow(b, min, max));
  const label = task.label ? `[${task.label}]` : "";
  const name = cleanTitle(task.title, task.label, i18n.untitled);
  const isBlocked = task.status === "blocked";
  const connector = isChild ? jsx("span", {
    className: "absolute",
    style: {
      // Drawn BEFORE the checkbox (visually left of it).
      left: `${depth * 12 + 2}px`,
      // Box sits ABOVE the row's vertical center so the bottom border
      // (the horizontal segment) lands exactly on the center line, next
      // to the status dot — no stray border above/left of it.
      top: "calc(50% - 12px)",
      width: "10px",
      height: "12px",
      borderLeft: "1px solid var(--ui-stroke-secondary)",
      borderBottom: "1px solid var(--ui-stroke-secondary)"
    }
  }) : null;
  const dotColor = (bars.length > 0 ? bars[bars.length - 1]?.tone : null) || statusTone(task.status);
  return jsxs("div", {
    className: cn(
      "group grid items-center border-b border-(--ui-stroke-tertiary)/40 transition-colors cursor-pointer",
      isSelected ? "bg-(--ui-accent)/12 font-semibold" : isChecked ? "bg-(--ui-accent)/6" : isEven ? "bg-black/[0.02] dark:bg-white/[0.02]" : "bg-transparent",
      "hover:bg-(--ui-accent)/8"
    ),
    style: { gridTemplateColumns: `${labelW}px ${timelineW}px`, height: `${ROW_H}px` },
    onClick: (e) => {
      if (e.target.tagName === "INPUT" && e.target.type === "checkbox") return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        onToggleCheck(task.id, !isChecked, e.nativeEvent);
      } else {
        onOpen(task.id);
      }
    },
    children: [
      jsxs("div", {
        className: cn(
          "relative flex items-center gap-1.5 min-w-0 sticky left-0 z-10 self-stretch",
          isSelected ? "font-semibold text-(--ui-accent)" : ""
        ),
        "data-glass-opaque": true,
        style: {
          paddingLeft: `${depth * 12 + 8}px`,
          paddingRight: "8px",
          width: `${labelW}px`,
          // Opaque fill spanning the full row height, tinted like the row
          // itself so the selection/check highlight stays visible through it.
          backgroundColor: isSelected ? "color-mix(in srgb, var(--ui-accent) 12%, var(--ui-bg-chrome))" : isChecked ? "color-mix(in srgb, var(--ui-accent) 6%, var(--ui-bg-chrome))" : isEven ? "color-mix(in srgb, var(--ui-text-primary) 2%, var(--ui-bg-chrome))" : "var(--ui-bg-chrome)"
        },
        children: [
          connector,
          jsx("input", {
            type: "checkbox",
            checked: Boolean(isChecked),
            onChange: (e) => onToggleCheck(task.id, e.target.checked, e.nativeEvent),
            onClick: (e) => e.stopPropagation(),
            className: "shrink-0 rounded cursor-pointer mr-1",
            "aria-label": i18n.tipSelect(name)
          }),
          isBlocked ? jsx("span", {
            className: "inline-flex items-center justify-center shrink-0 text-[#f87171]",
            title: i18n.tipBlocked,
            children: jsx(Codicon, { name: "warning", size: "0.85rem" })
          }) : jsx("span", { className: "h-1.5 w-1.5 rounded-full shrink-0 self-center ml-0.5", style: { backgroundColor: dotColor } }),
          showBoardBadge && task.board ? jsx(Badge, {
            size: "xs",
            variant: "outline",
            className: "shrink-0 font-mono text-[9px] px-1 py-0 h-3.5 max-w-[80px] truncate leading-tight",
            title: i18n.tipBoard(task.board),
            children: task.board
          }) : null,
          jsxs("span", {
            className: cn(
              "relative inline-flex items-center min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[11px] text-left select-none px-1 py-0.5 rounded",
              task.status === "running" && "font-medium",
              isSelected ? "font-bold text-(--ui-accent)" : ""
            ),
            title: `${showBoardBadge && task.board ? `[${task.board}] ` : ""}${name} (${task.id}) — ${i18n.clickForDetail}`,
            children: [
              task.status === "running" ? jsx("div", { className: "kg-arc", style: { "--kanban-tone": dotColor } }) : null,
              name
            ]
          })
        ]
      }),
      jsxs("div", {
        className: "relative overflow-hidden",
        style: { height: `${ROW_H}px` },
        children: bars.length > 0 ? bars.map((b, idx) => jsx(Bar, { key: b.runId || idx, task, bar: b, pxPerSec, min, max, onOpen })) : [jsx("div", { key: "empty", className: "text-(--ui-text-quaternary) text-[10px]", children: "—" })]
      })
    ]
  });
}
function ProfileAvatar({ name, size = "1rem" }) {
  const color = profileColor(name);
  const initials = (() => {
    const parts = (name || "?").split(/[\s_\-./]+/).filter(Boolean);
    return `${parts[0]?.[0] ?? "?"}${parts[1]?.[0] ?? ""}`.toUpperCase();
  })();
  return jsx("span", {
    className: "grid shrink-0 place-items-center rounded-full font-semibold select-none text-[8px]",
    style: {
      backgroundColor: color ? profileColorSoft(color, 22) : "var(--ui-bg-quaternary, rgba(150,150,150,0.15))",
      color: color ?? "var(--ui-text-secondary)",
      height: size,
      width: size
    },
    title: name,
    children: initials
  });
}
var ALL_STATUS_KEYS = ["ready", "running", "review", "blocked", "scheduled", "todo", "triage"];
function FilterDropdown({
  assignees,
  selectedAssignees,
  onToggleAssignee,
  onClearAssignees,
  disabledStatuses,
  onToggleStatus,
  showDone,
  onToggleShowDone
}) {
  const i18n = useGanttI18n();
  const active = selectedAssignees.size > 0 || disabledStatuses.size > 0;
  return jsxs(DropdownMenu, {
    children: [
      jsx(DropdownMenuTrigger, {
        asChild: true,
        children: jsx(Button, {
          size: "icon-xs",
          variant: "ghost",
          className: cn(active && "bg-(--ui-control-active-background) text-(--ui-accent)"),
          "aria-label": i18n.filters,
          children: jsx(Codicon, { name: "filter", size: "0.85rem" })
        })
      }),
      jsxs(DropdownMenuContent, {
        align: "start",
        className: "min-w-[12rem] p-1",
        children: [
          jsx("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase text-(--ui-text-tertiary)", children: i18n.profiles }),
          jsxs(DropdownMenuItem, {
            onClick: onClearAssignees,
            className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
            children: [
              jsx("span", { className: "flex-1 font-medium", children: i18n.allProfiles }),
              selectedAssignees.size === 0 ? jsx(Codicon, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
            ]
          }),
          assignees.map((name) => {
            const isChecked = selectedAssignees.has(name);
            return jsxs(DropdownMenuItem, {
              key: name,
              onClick: () => onToggleAssignee(name),
              className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
              children: [
                jsx(ProfileAvatar, { name, size: "1rem" }),
                jsx("span", { className: "flex-1", children: name }),
                isChecked ? jsx(Codicon, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
              ]
            });
          }),
          jsx(DropdownMenuSeparator, {}),
          jsx("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase text-(--ui-text-tertiary)", children: i18n.statuses }),
          ALL_STATUS_KEYS.map((s) => {
            const isVisible = !disabledStatuses.has(s);
            const meta = STATUS_META[s] || { tone: "var(--ui-text-secondary)", label: s };
            const label = i18n.col?.[s] || meta.label;
            return jsxs(DropdownMenuItem, {
              key: s,
              onClick: () => onToggleStatus(s),
              className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
              children: [
                jsx("span", { className: "h-2 w-2 rounded-full shrink-0", style: { backgroundColor: meta.tone } }),
                jsx("span", { className: cn("flex-1", !isVisible && "line-through opacity-50"), children: label }),
                isVisible ? jsx(Codicon, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
              ]
            });
          }),
          // Done — same toggle language as every other status: hidden by
          // default, click to show. Only done tasks with activity inside the
          // window are listed (hundreds of stale ones would flood the view).
          jsxs(DropdownMenuItem, {
            onClick: onToggleShowDone,
            title: i18n.showDoneHint,
            className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
            children: [
              jsx("span", { className: "h-2 w-2 rounded-full shrink-0", style: { backgroundColor: STATUS_META.done.tone } }),
              jsx("span", { className: cn("flex-1", !showDone && "line-through opacity-50"), children: i18n.col?.done || STATUS_META.done.label }),
              showDone ? jsx(Codicon, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
            ]
          })
        ]
      })
    ]
  });
}
function Legend({ disabledStatuses, onToggleStatus, showDone, onToggleShowDone }) {
  const i18n = useGanttI18n();
  const item = (statusKey, color, txt) => {
    const isExcluded = disabledStatuses ? disabledStatuses.has(statusKey) : false;
    const label = i18n.col?.[statusKey] || txt;
    return jsxs("button", {
      type: "button",
      onClick: onToggleStatus ? () => onToggleStatus(statusKey) : void 0,
      className: cn(
        "inline-flex items-center gap-1.5 text-[10px] cursor-pointer bg-transparent border-0 p-0 select-none transition-opacity hover:opacity-100",
        isExcluded ? "opacity-40 line-through text-(--ui-text-quaternary)" : "text-(--ui-text-tertiary)"
      ),
      title: isExcluded ? i18n.legendShow(label) : i18n.legendHide(label),
      children: [
        jsx("div", {
          className: "h-2 w-3 rounded-xs shrink-0",
          style: { backgroundColor: color, opacity: isExcluded ? 0.3 : 1 }
        }),
        jsx("span", { children: label })
      ]
    });
  };
  const doneLabel = i18n.col?.done || STATUS_META.done.label;
  return jsxs("div", {
    className: "flex flex-wrap items-center gap-3 pt-2 border-t border-(--ui-stroke-tertiary)/50 shrink-0 mt-auto select-none",
    children: [
      item("ready", "#60a5fa", "Ready"),
      item("running", "#34d399", "Running"),
      item("review", "#fbbf24", "Review"),
      item("blocked", "#f87171", "Blocked"),
      item("scheduled", "#a78bfa", "Scheduled"),
      item("todo", "var(--ui-text-secondary)", "Todo"),
      item("triage", "var(--ui-text-tertiary)", "Triage"),
      jsxs("button", {
        type: "button",
        onClick: onToggleShowDone,
        className: cn(
          "inline-flex items-center gap-1.5 text-[10px] cursor-pointer bg-transparent border-0 p-0 select-none transition-opacity hover:opacity-100",
          showDone ? "text-(--ui-text-tertiary)" : "opacity-40 line-through text-(--ui-text-quaternary)"
        ),
        title: i18n.showDoneHint,
        children: [
          jsx("div", {
            className: "h-2 w-3 rounded-xs shrink-0",
            style: { backgroundColor: STATUS_META.done.tone, opacity: showDone ? 1 : 0.3 }
          }),
          jsx("span", { children: doneLabel })
        ]
      })
    ]
  });
}
function WeekendBands({ min, max, pxPerSec }) {
  const bands = [];
  for (const seg of daySegments(min, max)) {
    const t = seg.dayStart;
    const d = new Date(t * 1e3);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const cellStart = seg.start;
      const cellEnd = seg.end;
      const left = Math.round((cellStart - min) * pxPerSec);
      const width = Math.max(1, Math.round((cellEnd - cellStart) * pxPerSec));
      bands.push(jsx("div", {
        className: "absolute top-0 bottom-0 pointer-events-none bg-black/15 dark:bg-black/25",
        style: { left: `${left}px`, width: `${width}px` }
      }, t));
    }
  }
  return jsxs("div", { className: "absolute inset-0 pointer-events-none z-0", children: bands });
}
function HourLines({ min, max, pxPerSec }) {
  const plan = hourTickPlan(min, max, pxPerSec);
  if (!plan.major.length && !plan.minor.length) return null;
  const lines = [];
  for (const t of plan.minor) {
    lines.push(jsx("div", {
      className: "absolute top-0 bottom-0 border-l border-(--ui-stroke-tertiary)/50",
      style: { left: `${Math.round((t - min) * pxPerSec)}px` }
    }, "m" + t));
  }
  for (const t of plan.major) {
    lines.push(jsx("div", {
      className: "absolute top-0 bottom-0 border-l border-(--ui-stroke-tertiary)/80",
      style: { left: `${Math.round((t - min) * pxPerSec)}px` }
    }, "H" + t));
  }
  return jsxs("div", { className: "absolute inset-0 pointer-events-none z-0", children: lines });
}
var GANTT_LOCALES = {
  en: {
    title: "Kanban Live",
    nav: "Kanban Live",
    openCommand: "Kanban Live Gantt: open the now-centered timeline",
    refresh: "Refresh",
    backend: "Backend:",
    allBoards: "All boards",
    board: "Board:",
    noBoard: "no board",
    dockDrawer: "Dock the drawer next to the timeline",
    undockDrawer: "Undock the drawer",
    filterCards: "Filter cards…",
    showDoneHint: "Show done tasks with activity inside the window (default: hidden)",
    today: "Today",
    now: "now",
    zoomReset: "Reset view — default window (now −24h → +48h) and zoom",
    zoomHint: "Wheel: zoom · Shift+Wheel: pan · Drag the ruler: slide the window · Drag its ends: move start/end · Double-click: reset",
    resetWindow: "↺ window",
    dragWindowStart: "Drag to move the window start",
    dragWindowEnd: "Drag to move the window end",
    nothingToDisplay: "Nothing to display",
    noTasksMatch: "No OPEN tasks match the current search or filters (done tasks are never shown here).",
    emptyBoard: "No data",
    emptyBoardDesc: (board) => `Board ${board} has no open tasks.`,
    cannotLoadBoard: "Cannot load board",
    cannotLoadBoardDesc: (base) => `Backend kanban-live-gantt unreachable${base ? ` (${base})` : ""} — plugin enabled? app backend restarted?`,
    taskUnreadable: "Task unreadable",
    taskUnreadableDesc: "Backend did not respond.",
    nTasksTotal: (n, status) => `${n} open task${n > 1 ? "s" : ""} (dominant priority: ${status})`,
    nBlockedWarning: (n) => `${n} blocked task${n > 1 ? "s" : ""} (requires attention)`,
    nSelected: (n) => `${n} selected`,
    statusLabel: "Status:",
    assignLabel: "Assign:",
    assignPlaceholder: "Profile…",
    clearSelection: "Clear selection (Esc)",
    filters: "Filters",
    profiles: "Profiles",
    allProfiles: "All profiles",
    statuses: "Statuses",
    unassigned: "Unassigned",
    unassignedEmpty: "Unassigned (empty)",
    reassigned: "(reassigned)",
    dependencies: "Dependencies:",
    description: "Description",
    result: "Result",
    latestSummary: "Latest summary",
    runs: (n) => `Runs (${n})`,
    show: "Show",
    hide: "Hide",
    comments: (n) => `Comments (${n})`,
    showPreviousComments: (n) => `Show ${n} previous comment${n > 1 ? "s" : ""}`,
    addCommentPlaceholder: "Add a comment…",
    send: "Send",
    activity: (n) => `Activity (${n})`,
    action: "Action:",
    copyTaskId: "Copy task id",
    copyTitle: "Copy title",
    copyViaMenu: "click […] to copy",
    moveToShort: "Move to",
    unassignAction: "Unassign",
    delete: "Delete",
    confirmDelete: (id) => `Permanently delete task ${id}?`,
    untitled: "(untitled)",
    drawerAria: "Task detail",
    close: "Close",
    actionsMenu: "Actions menu",
    tasksHeader: "Tasks",
    selectAll: "Select all",
    clickForDetail: "click for details",
    tipDone: "done (real run)",
    tipDoneUnknown: "done (unknown duration)",
    tipRunning: "in progress",
    tipTodo: "not started",
    tipSelect: (name) => `Select ${name}`,
    tipBlocked: "Blocked task",
    tipBoard: (board) => `Board: ${board}`,
    legendShow: (label) => `Click to show ${label}`,
    legendHide: (label) => `Click to hide ${label}`,
    col: {
      triage: "Triage",
      todo: "Todo",
      scheduled: "Scheduled",
      ready: "Ready",
      running: "Running",
      blocked: "Blocked",
      review: "Review",
      done: "Done",
      archived: "Archived"
    },
    actions: {
      done: "Done",
      blocked: "Block",
      unblock: "Unblock",
      review: "Request review",
      reopen: "Reopen",
      archive: "Archive",
      ready: "Set to Ready",
      todo: "Set to Todo",
      triage: "Send to Triage",
      delete: "Delete",
      restore: "Restore"
    }
  },
  zh: {
    title: "看板实时甘特图",
    nav: "看板实时甘特图",
    openCommand: "看板实时甘特图：打开以现在为中心的任务时间线",
    refresh: "刷新",
    backend: "后端：",
    allBoards: "全部看板",
    board: "看板：",
    noBoard: "无看板",
    dockDrawer: "将详情面板固定在时间线旁",
    undockDrawer: "取消固定详情面板",
    filterCards: "筛选任务…",
    showDoneHint: "显示时间窗内有活动的已完成任务（默认隐藏）",
    today: "今天",
    now: "现在",
    zoomReset: "重置视图 — 恢复默认窗口（now−24h → +48h）与缩放",
    zoomHint: "滚轮：缩放 · Shift+滚轮：平移 · 拖拽标尺：滑动窗口 · 拖拽两端：移动起点/终点 · 双击：重置",
    resetWindow: "↺ 默认窗口",
    dragWindowStart: "拖动：移动窗口起点",
    dragWindowEnd: "拖动：移动窗口终点",
    nothingToDisplay: "暂无可显示内容",
    noTasksMatch: "没有未完成任务匹配当前搜索或筛选条件（已完成任务不在此视图显示）。",
    emptyBoard: "无数据",
    emptyBoardDesc: (board) => `看板 ${board} 没有未完成任务。`,
    cannotLoadBoard: "无法加载看板",
    cannotLoadBoardDesc: (base) => `后端 kanban-live-gantt 不可达${base ? `（${base}）` : ""} — 插件已启用？应用后端已重启？`,
    taskUnreadable: "任务信息不可读",
    taskUnreadableDesc: "后端没有响应。",
    nTasksTotal: (n, status) => `${n} 个未完成任务（主状态：${status}）`,
    nBlockedWarning: (n) => `${n} 个任务被阻塞（需要处理）`,
    nSelected: (n) => `已选 ${n} 项`,
    statusLabel: "状态：",
    assignLabel: "指派：",
    assignPlaceholder: "执行者…",
    clearSelection: "清除选择（Esc）",
    filters: "筛选",
    profiles: "执行者",
    allProfiles: "全部执行者",
    statuses: "状态",
    unassigned: "未指派",
    unassignedEmpty: "未指派（空）",
    reassigned: "（已改派）",
    dependencies: "依赖：",
    description: "描述",
    result: "结果",
    latestSummary: "最新摘要",
    runs: (n) => `运行记录（${n}）`,
    show: "展开",
    hide: "收起",
    comments: (n) => `评论（${n}）`,
    showPreviousComments: (n) => `显示前 ${n} 条评论`,
    addCommentPlaceholder: "添加评论…",
    send: "发送",
    activity: (n) => `活动（${n}）`,
    action: "操作：",
    copyTaskId: "复制任务 ID",
    copyTitle: "复制标题",
    copyViaMenu: "点击 […] 可复制",
    moveToShort: "移动到",
    unassignAction: "取消指派",
    delete: "删除",
    confirmDelete: (id) => `确定永久删除任务 ${id}？`,
    untitled: "（无标题）",
    drawerAria: "任务详情",
    close: "关闭",
    actionsMenu: "操作菜单",
    tasksHeader: "任务",
    selectAll: "全选",
    clickForDetail: "点击查看详情",
    tipDone: "已完成（真实运行时长）",
    tipDoneUnknown: "已完成（时长未知）",
    tipRunning: "进行中",
    tipTodo: "未开始",
    tipSelect: (name) => `选择 ${name}`,
    tipBlocked: "已阻塞任务",
    tipBoard: (board) => `看板：${board}`,
    legendShow: (label) => `点击显示「${label}」`,
    legendHide: (label) => `点击隐藏「${label}」`,
    col: {
      triage: "分诊",
      todo: "待办",
      scheduled: "已计划",
      ready: "就绪",
      running: "运行中",
      blocked: "已阻塞",
      review: "待评审",
      done: "已完成",
      archived: "已归档"
    },
    actions: {
      done: "完成",
      blocked: "阻塞",
      unblock: "解除阻塞",
      review: "请求评审",
      reopen: "重新打开",
      archive: "归档",
      ready: "设为就绪",
      todo: "设为待办",
      triage: "退回分诊",
      delete: "删除",
      restore: "恢复"
    }
  }
};
function bindI18n(t, template, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(template)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out[key] = typeof value === "function" ? (...args) => t(path, ...args) : value && typeof value === "object" ? bindI18n(t, value, path) : t(path);
  }
  return out;
}
function useGanttI18n() {
  const t = usePluginI18n(ID);
  return useMemo(() => bindI18n(t, GANTT_LOCALES.en), [t]);
}
var STATUS_META = {
  triage: { tone: "var(--ui-text-tertiary)", label: "Triage" },
  todo: { tone: "var(--ui-text-secondary)", label: "Todo" },
  scheduled: { tone: "#a78bfa", label: "Scheduled" },
  ready: { tone: "#60a5fa", label: "Ready" },
  running: { tone: "#34d399", label: "Running" },
  blocked: { tone: "#f87171", label: "Blocked" },
  review: { tone: "#fbbf24", label: "Review" },
  done: { tone: "var(--ui-text-tertiary)", label: "Done" },
  archived: { tone: "var(--ui-text-quaternary)", label: "Archived" }
};
var STATUS_ORDER = ["triage", "todo", "ready", "blocked", "running", "review", "done"];
var ACTION_MATRIX = {
  triage: { primary: ["todo"], more: ["blocked", "archive"] },
  todo: { primary: ["ready"], more: ["blocked", "review", "archive"] },
  scheduled: { primary: ["ready"], more: ["blocked", "archive"] },
  ready: { primary: ["done", "blocked"], more: ["review", "archive"] },
  running: { primary: ["done", "review"], more: ["blocked"] },
  blocked: { primary: ["ready"], more: ["review", "archive"] },
  review: { primary: ["done", "reopen"], more: ["blocked"] },
  done: { primary: ["archive"], more: ["ready"] },
  archived: { primary: ["done"], more: [] }
};
var ACTION_LABELS = {
  done: "Done",
  blocked: "Block",
  unblock: "Unblock",
  review: "Request review",
  reopen: "Reopen",
  archive: "Archive",
  ready: "Set to Ready",
  todo: "Set to Todo",
  triage: "Send to Triage",
  delete: "Delete",
  restore: "Restore"
};
function AssigneeBadge({ assignee, assignees = [], onAssign, disabled }) {
  const i18n = useGanttI18n();
  const current = assignee || i18n.unassigned;
  return jsxs(DropdownMenu, { children: [
    jsx(DropdownMenuTrigger, {
      asChild: true,
      disabled,
      children: jsx("button", {
        type: "button",
        className: "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer border border-(--ui-stroke-secondary) bg-(--ui-bg-subtle, transparent) hover:bg-(--chrome-action-hover)",
        children: [
          assignee ? jsx(ProfileAvatar, { name: assignee, size: "0.9rem" }) : jsx("span", { className: "text-(--ui-text-tertiary)", children: "👤" }),
          jsx("span", { children: current }),
          jsx("span", { className: "text-[9px] opacity-60", children: "▾" })
        ]
      })
    }),
    jsxs(DropdownMenuContent, {
      align: "start",
      className: "min-w-[10rem] p-1",
      children: [
        jsx(DropdownMenuItem, {
          className: "flex items-center gap-2 px-2.5 py-1 text-[11px] text-(--ui-text-tertiary)",
          onClick: () => onAssign(""),
          children: [
            jsx("span", { className: "flex-1", children: i18n.unassignedEmpty }),
            !assignee ? jsx("span", { className: "opacity-60", children: "✓" }) : null
          ]
        }),
        assignees.map((name) => {
          const isCur = name === assignee;
          return jsx(DropdownMenuItem, {
            key: name,
            className: "flex items-center gap-2 px-2.5 py-1 text-[11px]",
            onClick: () => onAssign(name),
            children: [
              jsx(ProfileAvatar, { name, size: "0.9rem" }),
              jsx("span", { className: "flex-1", children: name }),
              isCur ? jsx("span", { className: "opacity-60", children: "✓" }) : null
            ]
          }, name);
        })
      ]
    })
  ] });
}
function SelectionBar({
  selected,
  onClear,
  onStatus,
  onAssign,
  onArchive,
  onDelete,
  assignees = [],
  busy = false
}) {
  const i18n = useGanttI18n();
  const [menu, setMenu] = useState(null);
  const [customAssignee, setCustomAssignee] = useState("");
  if (selected.size === 0) return null;
  return jsx("div", {
    className: "pointer-events-none absolute inset-x-0 bottom-12 z-40 flex justify-center px-4 animate-in fade-in slide-in-from-bottom-2 duration-150",
    children: jsxs("div", {
      className: "pointer-events-auto flex items-center gap-1.5 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) py-1.5 pr-1.5 pl-3.5 shadow-xl",
      children: [
        jsx("span", { className: "mr-1 text-xs tabular-nums font-medium text-(--ui-text-secondary)", children: i18n.nSelected(selected.size) }),
        // Move to dropdown
        jsxs(DropdownMenu, {
          open: menu === "move",
          onOpenChange: (open) => setMenu(open ? "move" : null),
          children: [
            jsx(DropdownMenuTrigger, {
              asChild: true,
              children: jsxs(Button, {
                disabled: busy,
                size: "xs",
                variant: "ghost",
                className: "gap-1 text-xs",
                children: [
                  jsx("span", { children: i18n.moveToShort }),
                  jsx(Codicon, { name: "chevron-down", size: "0.7rem" })
                ]
              })
            }),
            jsx(DropdownMenuContent, {
              align: "center",
              className: "min-w-[9rem] p-1",
              children: STATUS_ORDER.map((s) => {
                const meta = STATUS_META[s] || { tone: "var(--ui-text-secondary)", label: s };
                const label = i18n.col?.[s] || meta.label;
                return jsxs(DropdownMenuItem, {
                  key: s,
                  onClick: () => {
                    setMenu(null);
                    onStatus(s);
                  },
                  className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
                  children: [
                    jsx("span", { className: "h-2 w-2 rounded-full shrink-0", style: { backgroundColor: meta.tone } }),
                    jsx("span", { className: "flex-1", children: label })
                  ]
                });
              })
            })
          ]
        }),
        // Assign dropdown
        jsxs(DropdownMenu, {
          open: menu === "assign",
          onOpenChange: (open) => setMenu(open ? "assign" : null),
          children: [
            jsx(DropdownMenuTrigger, {
              asChild: true,
              children: jsxs(Button, {
                disabled: busy,
                size: "xs",
                variant: "ghost",
                className: "gap-1 text-xs",
                children: [
                  jsx("span", { children: i18n.assignLabel.replace(":", "") }),
                  jsx(Codicon, { name: "chevron-down", size: "0.7rem" })
                ]
              })
            }),
            jsxs(DropdownMenuContent, {
              align: "center",
              className: "min-w-[10rem] p-1",
              children: [
                assignees.map((name) => jsx(DropdownMenuItem, {
                  key: name,
                  onClick: () => {
                    setMenu(null);
                    onAssign(name);
                  },
                  className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
                  children: [
                    jsx(ProfileAvatar, { name, size: "0.85rem" }),
                    jsx("span", { className: "flex-1", children: name })
                  ]
                })),
                assignees.length > 0 ? jsx(DropdownMenuSeparator, {}) : null,
                jsx(DropdownMenuItem, {
                  onClick: () => {
                    setMenu(null);
                    onAssign("");
                  },
                  className: "text-xs py-1.5 cursor-pointer text-(--ui-text-tertiary)",
                  children: i18n.unassignAction
                })
              ]
            })
          ]
        }),
        // Archive button
        jsx(Button, {
          disabled: busy,
          onClick: onArchive,
          size: "xs",
          variant: "ghost",
          className: "text-xs",
          children: i18n.actions.archive
        }),
        // Delete button
        jsx(Button, {
          disabled: busy,
          onClick: onDelete,
          size: "xs",
          variant: "ghost",
          className: "text-destructive text-xs hover:bg-destructive/10",
          children: i18n.delete
        }),
        // Clear button (✕)
        jsx(Button, {
          "aria-label": i18n.clearSelection,
          onClick: onClear,
          size: "icon-xs",
          variant: "ghost",
          className: "ml-1 text-(--ui-text-quaternary) hover:text-(--ui-text-primary)",
          children: jsx(Codicon, { name: "close", size: "0.8rem" })
        })
      ]
    })
  });
}
function StatusBadge({ status, onPick, disabled }) {
  const i18n = useGanttI18n();
  const meta = STATUS_META[status] || STATUS_META.todo;
  const label = i18n.col?.[status] || meta.label;
  const isRunning = status === "running";
  return jsxs(DropdownMenu, { children: [
    jsx(DropdownMenuTrigger, {
      asChild: true,
      disabled,
      children: jsx("button", {
        type: "button",
        className: "relative inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer",
        style: { background: `color-mix(in srgb, ${meta.tone} 18%, transparent)`, color: "inherit", border: `1px solid color-mix(in srgb, ${meta.tone} 45%, transparent)` },
        children: [
          isRunning ? jsx("div", { className: "kg-arc", style: { "--kanban-tone": meta.tone } }) : null,
          jsx("span", { className: "h-2 w-2 rounded-full", style: { backgroundColor: meta.tone } }),
          jsx("span", { children: label }),
          jsx("span", { className: "text-[9px] opacity-60", children: "▾" })
        ]
      })
    }),
    jsxs(DropdownMenuContent, {
      align: "start",
      className: "min-w-[9rem] p-1",
      children: STATUS_ORDER.map((s) => {
        const m = STATUS_META[s];
        const current = s === status;
        const l = i18n.col?.[s] || m.label;
        return jsx(DropdownMenuItem, {
          className: "flex items-center gap-2 px-2.5 py-1 text-[11px]",
          onClick: () => {
            if (!current) onPick(s);
          },
          disabled: current,
          children: [
            jsx("span", { className: "h-2 w-2 rounded-full shrink-0", style: { backgroundColor: m.tone } }),
            jsx("span", { className: "flex-1", children: l }),
            current ? jsx("span", { className: "opacity-60", children: "✓" }) : null
          ]
        }, s);
      })
    })
  ] });
}
function TaskDrawer({ taskId, board, onClose, assignees = [], docked = false, onToggleDock }) {
  const drawerW = useValue($drawerW);
  const i18n = useGanttI18n();
  const scrollContainerRef = useRef(null);
  const prevTaskIdRef = useRef(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["kanban-live-gantt", "task", apiBase(), board, taskId],
    queryFn: () => fetchTask(taskId, board),
    enabled: Boolean(taskId)
  });
  useEffect(() => {
    if (taskId && prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId;
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    }
  }, [taskId]);
  const [comment, setComment] = useState("");
  const [actionError, setActionError] = useState(null);
  const [runsOpen, setRunsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [showAllComments, setShowAllComments] = useState(false);
  const statusMutation = useMutation({
    mutationFn: (payload) => apiFetch(
      `/tasks/${encodeURIComponent(taskId)}/status${board ? `?board=${encodeURIComponent(board)}` : ""}`,
      { method: "PATCH", body: payload }
    ),
    onSuccess: () => {
      setActionError(null);
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["kanban-live-gantt", "gantt"] });
    },
    onError: (error) => setActionError(String(error?.message || error))
  });
  const commentMutation = useMutation({
    mutationFn: (body) => apiFetch(
      `/tasks/${encodeURIComponent(taskId)}/comments${board ? `?board=${encodeURIComponent(board)}` : ""}`,
      { method: "POST", body }
    ),
    onSuccess: () => {
      setActionError(null);
      void refetch();
    },
    onError: (error) => setActionError(String(error?.message || error))
  });
  const assignMutation = useMutation({
    mutationFn: (profile) => apiFetch(
      `/tasks/${encodeURIComponent(taskId)}/assignee${board ? `?board=${encodeURIComponent(board)}` : ""}`,
      { method: "PATCH", body: { profile } }
    ),
    onSuccess: () => {
      setActionError(null);
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["kanban-live-gantt", "gantt"] });
    },
    onError: (error) => setActionError(String(error?.message || error))
  });
  const st = data?.task?.status || "todo";
  const matrix = ACTION_MATRIX[st] || { primary: [], more: [] };
  const more = matrix.more || [];
  const actionLabel = (a) => i18n.actions?.[a] || ACTION_LABELS[a] || a;
  return jsxs("div", {
    className: docked ? "relative flex flex-col h-full min-h-0 border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) pt-3.5 px-4" : "absolute inset-y-0 right-0 z-50 max-w-full border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) shadow-xl flex flex-col pt-3.5 px-4",
    "data-glass-opaque": true,
    role: "dialog",
    "aria-label": i18n.drawerAria,
    style: { width: `${drawerW}px` },
    children: [
      jsx(ResizeHandle, {
        get: () => $drawerW.get(),
        set: (w) => $drawerW.set(w),
        min: DRAWER_W_MIN,
        max: DRAWER_W_MAX,
        resetTo: 416,
        storageKey: "drawerW",
        growDirection: "left"
      }),
      // Pinned top section: header, actions and title with bottom separator
      jsxs("div", {
        className: "flex flex-col gap-2 pb-3 border-b border-(--ui-stroke-tertiary) shrink-0",
        children: [
          // Top row: status, assignee, task id, [...] menu, close
          jsxs("div", {
            className: "flex items-center justify-between gap-1.5",
            children: [
              jsxs("div", { className: "flex flex-wrap items-center gap-1.5 min-w-0", children: [
                jsx(Button, { size: "icon-xs", variant: "ghost", onClick: onToggleDock, "aria-label": docked ? i18n.undockDrawer : i18n.dockDrawer, title: docked ? i18n.undockDrawer : i18n.dockDrawer, children: docked ? "»" : "«" }),
                StatusBadge({
                  status: data?.task?.status,
                  disabled: statusMutation.isPending,
                  onPick: (next) => {
                    const action = next === "done" ? "done" : next === "blocked" ? "blocked" : next === "ready" ? "ready" : next === "todo" ? "todo" : next === "review" ? "review" : next === "triage" ? "triage" : null;
                    if (action) statusMutation.mutate({ action });
                  }
                }),
                jsx(AssigneeBadge, {
                  assignee: data?.task?.assignee,
                  assignees,
                  disabled: assignMutation.isPending,
                  onAssign: (profile) => assignMutation.mutate(profile)
                }),
                jsx("span", {
                  className: "text-[11px] font-mono text-(--ui-text-quaternary) hover:text-(--ui-text-secondary) cursor-help select-all",
                  title: `${taskId} — ${i18n.copyViaMenu}`,
                  children: shortId(taskId)
                })
              ] }),
              jsxs("div", { className: "flex items-center gap-1 shrink-0", children: [
                jsxs(DropdownMenu, { children: [
                  jsx(DropdownMenuTrigger, {
                    asChild: true,
                    children: jsx("button", {
                      type: "button",
                      className: "inline-flex items-center justify-center rounded-md p-1 hover:bg-(--chrome-action-hover) cursor-pointer text-(--ui-text-secondary) border-0 bg-transparent",
                      "aria-label": i18n.actionsMenu,
                      children: jsx(Codicon, { name: "ellipsis", size: "0.9rem" })
                    })
                  }),
                  jsxs(DropdownMenuContent, {
                    align: "end",
                    className: "min-w-[11rem] p-1 text-xs",
                    children: [
                      jsx(DropdownMenuItem, {
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => void navigator.clipboard.writeText(taskId),
                        children: i18n.copyTaskId
                      }),
                      jsx(DropdownMenuItem, {
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => {
                          if (data?.task?.title) void navigator.clipboard.writeText(data.task.title);
                        },
                        children: i18n.copyTitle
                      }),
                      more.length ? jsx(DropdownMenuSeparator, {}) : null,
                      more.map((a) => jsx(DropdownMenuItem, {
                        key: a,
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => statusMutation.mutate({ action: a }),
                        children: actionLabel(a)
                      })),
                      jsx(DropdownMenuSeparator, {}),
                      jsx(DropdownMenuItem, {
                        className: "flex items-center gap-2 px-3 py-1.5 text-red-500 hover:bg-red-500/10",
                        onClick: () => {
                          if (confirm(i18n.confirmDelete(taskId))) {
                            statusMutation.mutate({ action: "delete" });
                            onClose();
                          }
                        },
                        children: i18n.delete
                      })
                    ]
                  })
                ] }),
                jsx(Button, { size: "icon-xs", variant: "ghost", onClick: onClose, "aria-label": i18n.close, children: "✕" })
              ] })
            ]
          }),
          // Primary actions bar placed ABOVE the title
          (matrix.primary || []).length ? jsxs("div", { className: "flex flex-wrap items-center gap-1.5 py-0.5", children: [
            jsx("span", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary) mr-1", children: i18n.action }),
            (matrix.primary || []).map((a) => jsx(Button, {
              key: a,
              size: "xs",
              disabled: statusMutation.isPending,
              onClick: () => statusMutation.mutate({ action: a }),
              children: actionLabel(a)
            }))
          ] }) : null,
          // Title kept always visible
          jsx("div", { className: "text-base font-semibold leading-snug", children: cleanTitle(data?.task?.title, data?.task?.label, i18n.untitled) })
        ]
      }),
      actionError ? jsx("div", { className: "text-[10px] text-red-500 bg-red-500/10 border border-red-500/20 rounded p-1.5 shrink-0", children: actionError }) : null,
      // Scrollable content underneath the pinned header + title
      isLoading ? jsx("div", { className: "py-8 flex justify-center", children: jsx(Loader, {}) }) : isError ? jsx(ErrorState, { title: i18n.taskUnreadable, description: i18n.taskUnreadableDesc }) : jsxs("div", { ref: scrollContainerRef, className: "flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pt-1", children: [
        (data?.task?.dependencies || []).length ? jsxs("div", { className: "text-[11px]", children: [
          jsx("span", { className: "text-[10px] uppercase text-(--ui-text-tertiary)", children: i18n.dependencies }),
          ...(data.task.dependencies || []).map((d, i) => jsxs("span", { title: d.id, children: [
            i > 0 ? " · " : null,
            jsx("span", { className: "text-(--ui-text-secondary)", children: `${d.relation === "parent" ? "⬅" : "➡"} ${d.title}` })
          ] }, i))
        ] }) : null,
        // 1. Description (no max-h clamp)
        data?.task?.body ? jsxs("div", { className: "flex flex-col gap-1", children: [
          jsx("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.description }),
          jsx("div", {
            className: "text-[11px] prose prose-sm max-w-none border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
            children: jsx(Streamdown, { children: data.task.body })
          })
        ] }) : null,
        // 2. Result (no max-h clamp)
        data?.task?.result ? jsxs("div", { className: "flex flex-col gap-1", children: [
          jsx("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.result }),
          jsx("div", {
            className: "text-[11px] prose prose-sm max-w-none border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
            children: jsx(Streamdown, { children: data.task.result })
          })
        ] }) : null,
        // 3. Latest summary (highlighted when blocked or done/completed)
        data?.task?.latest_summary ? jsxs("div", { className: "flex flex-col gap-1", children: [
          jsx("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.latestSummary }),
          jsx("div", {
            className: cn(
              "text-[11px] prose prose-sm max-w-none rounded p-2.5 transition-colors",
              data?.task?.status === "blocked" ? "border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" : data?.task?.status === "done" || data?.task?.status === "archived" ? "border border-emerald-500/35 bg-emerald-500/10" : "border border-(--ui-stroke-tertiary) bg-(--ui-bg-subtle, transparent)"
            ),
            children: jsx(Streamdown, { children: data.task.latest_summary })
          })
        ] }) : null,
        // 4. Run history (Collapsible section, collapsed by default, no internal scrollbar)
        (data?.task?.runs || []).length ? jsxs("div", { className: "border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1.5", children: [
          jsxs("button", {
            type: "button",
            className: "flex items-center justify-between w-full text-left py-1 px-1 -mx-1 rounded hover:bg-(--chrome-action-hover) cursor-pointer border-0 bg-transparent text-(--ui-text-primary)",
            onClick: () => setRunsOpen((o) => !o),
            children: [
              jsxs("div", { className: "flex items-center gap-1.5", children: [
                jsx("span", { className: "text-[10px] text-(--ui-text-tertiary) select-none", children: runsOpen ? "▼" : "▶" }),
                jsx("span", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.runs(data.task.runs.length) })
              ] }),
              jsx("span", { className: "text-[10px] text-(--ui-text-quaternary)", children: runsOpen ? i18n.hide : i18n.show })
            ]
          }),
          runsOpen ? jsx("div", { className: "flex flex-col gap-2 pt-1", children: data.task.runs.map((r, i) => {
            const failed = ["crashed", "failed", "timed_out", "gave_up"].includes(r.outcome || r.status);
            const isDiffProfile = r.profile && data?.task?.assignee && r.profile !== data.task.assignee;
            const durationStr = (() => {
              if (!r.started_at) return "";
              const end = r.ended_at || Math.floor(Date.now() / 1e3);
              const sec = Math.max(0, end - r.started_at);
              if (sec < 60) return `${sec}s`;
              if (sec < 3600) return `${Math.floor(sec / 60)}m`;
              const h = Math.floor(sec / 3600);
              const m = Math.floor(sec % 3600 / 60);
              return m > 0 ? `${h}h ${m}m` : `${h}h`;
            })();
            const dateStr = r.started_at ? new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" }).format(new Date(r.started_at * 1e3)) : "";
            return jsxs("div", {
              key: r.id || i,
              className: "flex flex-col gap-1 text-[11px] border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
              children: [
                jsxs("div", { className: "flex flex-wrap items-center gap-1.5 text-[10px]", children: [
                  jsx(Badge, { size: "xs", variant: failed ? "destructive" : r.ended_at ? "muted" : "secondary", children: r.outcome || r.status || "run" }),
                  r.profile ? jsxs("span", { className: cn("font-medium", isDiffProfile ? "text-amber-500 font-semibold" : "text-(--ui-text-secondary)"), children: [
                    "👤 ",
                    r.profile,
                    isDiffProfile ? jsx("span", { className: "text-[9px] text-(--ui-text-quaternary) ml-1", children: i18n.reassigned }) : null
                  ] }) : null,
                  durationStr ? jsx("span", { className: "text-(--ui-text-tertiary)", children: `⏱ ${durationStr}` }) : null,
                  dateStr ? jsx("span", { className: "text-(--ui-text-quaternary) ml-auto text-[9.5px]", children: dateStr }) : null
                ] }),
                r.summary ? jsx("div", { className: "prose prose-sm max-w-none text-[11px] mt-1 pt-1 border-t border-(--ui-stroke-tertiary)/50", children: jsx(Streamdown, { children: r.summary }) }) : null
              ]
            });
          }) }) : null
        ] }) : null,
        // 5. Commentaires (Collapsible section, open by default, 3 latest by default with button to show previous, no internal scrollbar)
        (() => {
          const commentsList = data?.task?.comments || [];
          const totalComments = commentsList.length;
          const visibleComments = showAllComments ? commentsList : commentsList.slice(-3);
          const hiddenCount = totalComments - visibleComments.length;
          return jsxs("div", { className: "border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1.5", children: [
            jsxs("button", {
              type: "button",
              className: "flex items-center justify-between w-full text-left py-1 px-1 -mx-1 rounded hover:bg-(--chrome-action-hover) cursor-pointer border-0 bg-transparent text-(--ui-text-primary)",
              onClick: () => {
                setCommentsOpen((o) => {
                  if (o) setShowAllComments(false);
                  return !o;
                });
              },
              children: [
                jsxs("div", { className: "flex items-center gap-1.5", children: [
                  jsx("span", { className: "text-[10px] text-(--ui-text-tertiary) select-none", children: commentsOpen ? "▼" : "▶" }),
                  jsx("span", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.comments(totalComments) })
                ] }),
                jsx("span", { className: "text-[10px] text-(--ui-text-quaternary)", children: commentsOpen ? i18n.hide : i18n.show })
              ]
            }),
            commentsOpen ? jsxs("div", { className: "flex flex-col gap-1.5 pt-1", children: [
              hiddenCount > 0 ? jsx("button", {
                type: "button",
                className: "text-[10.5px] text-(--ui-accent) hover:underline cursor-pointer border-0 bg-transparent text-left py-0.5 select-none",
                onClick: () => setShowAllComments(true),
                children: `↑ ${i18n.showPreviousComments(hiddenCount)}`
              }) : null,
              visibleComments.map((c, i) => {
                const dateStr = c.created_at ? new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" }).format(new Date(c.created_at * 1e3)) : "";
                return jsxs("div", {
                  key: c.id || i,
                  className: "text-[11px] border border-(--ui-stroke-tertiary)/60 rounded p-1.5 bg-(--ui-bg-subtle, transparent)",
                  children: [
                    jsxs("div", { className: "flex items-center gap-1.5 text-[10px] text-(--ui-text-tertiary) mb-0.5", children: [
                      jsx("span", { className: "font-medium text-(--ui-text-secondary)", children: c.author || "?" }),
                      dateStr ? jsx("span", { className: "ml-auto text-(--ui-text-quaternary)", children: dateStr }) : null
                    ] }),
                    jsx("div", { className: "prose prose-sm max-w-none text-[11px]", children: jsx(Streamdown, { children: c.body || "" }) })
                  ]
                });
              }),
              jsxs("div", { className: "flex gap-1.5 mt-1", children: [
                jsx("input", {
                  type: "text",
                  value: comment,
                  placeholder: i18n.addCommentPlaceholder,
                  className: "flex-1 bg-transparent border border-(--ui-stroke-tertiary) rounded px-1.5 py-0.5 text-[11px]",
                  onInput: (event) => setComment(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === "Enter" && comment.trim()) {
                      commentMutation.mutate({ body: comment.trim() });
                      setComment("");
                    }
                  }
                }),
                jsx(Button, {
                  size: "xs",
                  disabled: !comment.trim() || commentMutation.isPending,
                  onClick: () => {
                    commentMutation.mutate({ body: comment.trim() });
                    setComment("");
                  },
                  children: i18n.send
                })
              ] })
            ] }) : null
          ] });
        })(),
        // 6. Activity (recent events)
        (data?.task?.events || []).length ? jsxs("div", { className: "border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1", children: [
          jsx("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.activity(data.task.events.length) }),
          jsx("div", { className: "flex flex-col gap-0.5 max-h-32 overflow-auto", children: data.task.events.slice(-12).reverse().map((e, i) => jsx("div", {
            key: i,
            className: "text-[10px] text-(--ui-text-tertiary)",
            children: String(e.kind || "event")
          }, i)) })
        ] }) : null
      ] })
    ]
  });
}
function TitlebarBoardSwitcher() {
  const board = useValue($boardSlug);
  const i18n = useGanttI18n();
  const queryClient2 = useQueryClient();
  const { data } = useQuery({
    queryKey: ["kanban-live-gantt", "boards", apiBase()],
    queryFn: () => apiFetch("/boards"),
    refetchInterval: 5 * 6e4
  });
  const boards = data?.boards || [];
  const isAllBoards = board === "all" || board === "*";
  const current = isAllBoards ? { slug: "all", label: i18n.allBoards } : boards.find((b) => b.slug === (board || data?.current));
  const setBoard = (slug) => {
    $boardSlug.set(slug);
    if (storage) storage.set("board", slug);
    void queryClient2.invalidateQueries({ queryKey: ["kanban-live-gantt", "gantt"] });
  };
  return jsxs(DropdownMenu, {
    children: [
      jsx(DropdownMenuTrigger, {
        asChild: true,
        children: jsx(Button, {
          className: "h-7 max-w-56 gap-1.5 px-2 [-webkit-app-region:no-drag]",
          size: "sm",
          variant: "ghost",
          // Single-element child: Radix `asChild` (Slot) rejects arrays.
          children: jsx("span", {
            className: "flex min-w-0 items-center gap-1.5",
            children: [
              jsx("span", { className: "min-w-0 flex-1 truncate text-[0.75rem] font-medium leading-none", children: current?.label || "—" }),
              current && typeof current.total === "number" ? jsx("span", { className: "text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)", children: `${current.total}` }) : null,
              jsx("span", { className: "text-[9px] opacity-60", children: "▾" })
            ]
          })
        })
      }),
      jsxs(DropdownMenuContent, {
        align: "center",
        className: "min-w-[12rem] p-1",
        children: [
          jsxs(DropdownMenuItem, {
            key: "all",
            onClick: () => setBoard("all"),
            className: "flex items-center justify-between text-xs py-1.5 cursor-pointer font-medium border-b border-(--ui-stroke-tertiary) mb-1",
            children: [
              jsx("span", { className: cn("flex-1 truncate", isAllBoards && "font-semibold text-(--ui-accent)"), children: i18n.allBoards }),
              isAllBoards ? jsx(Codicon, { name: "check", size: "0.8rem", className: "ml-2" }) : null
            ]
          }),
          ...boards.map((b) => {
            const isCurrent = !isAllBoards && b.slug === (board || data?.current);
            return jsxs(DropdownMenuItem, {
              key: b.slug,
              onClick: () => setBoard(b.slug),
              className: "flex items-center justify-between text-xs py-1.5 cursor-pointer",
              children: [
                jsx("span", { className: cn("flex-1 truncate", isCurrent && "font-semibold text-(--ui-accent)"), children: b.label || b.slug }),
                isCurrent ? jsx(Codicon, { name: "check", size: "0.8rem", className: "ml-2" }) : null
              ]
            });
          })
        ]
      })
    ]
  });
}
function KanbanGanttPage() {
  const i18n = useGanttI18n();
  const queryClient2 = useQueryClient();
  const base = useValue($baseUrl);
  const board = useValue($boardSlug);
  const openTaskId = useValue($openTaskId);
  const labelW = useValue($labelW);
  const drawerW = useValue($drawerW);
  const drawerDocked = useValue($drawerDocked);
  const { data: boardsData } = useQuery({
    queryKey: ["kanban-live-gantt", "boards", apiBase()],
    queryFn: () => apiFetch("/boards"),
    refetchInterval: 5 * 6e4
  });
  const { data, isLoading, isError } = useQuery({
    queryKey: ["kanban-live-gantt", "gantt", apiBase(), board],
    queryFn: () => apiFetch(`/gantt${board ? `?board=${encodeURIComponent(board)}` : ""}`),
    refetchInterval: 6e4
  });
  const [selectedAssignees, setSelectedAssignees] = useState(() => /* @__PURE__ */ new Set());
  const [disabledStatuses, setDisabledStatuses] = useState(() => {
    const saved = storage ? storage.get("disabledStatuses", null) : null;
    return Array.isArray(saved) ? new Set(saved) : /* @__PURE__ */ new Set();
  });
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => /* @__PURE__ */ new Set());
  const [bulkAssignee, setBulkAssignee] = useState("");
  const lastCheckedIdRef = useRef(null);
  const [showDone, setShowDone] = useState(() => storage ? storage.get("showDone", false) === true : false);
  const [zoom, setZoom] = useState(() => {
    const saved = storage ? Number(storage.get("zoom", null)) : NaN;
    return Number.isFinite(saved) && saved >= 1 ? saved : 1;
  });
  const [win, setWin] = useState(null);
  const containerRef = useRef(null);
  const scrollerRef = useRef(null);
  const [trackW, setTrackW] = useState(0);
  const handleToggleAssignee = (name) => {
    setSelectedAssignees((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const handleClearAssignees = () => setSelectedAssignees(/* @__PURE__ */ new Set());
  const handleToggleStatus = (status) => {
    setDisabledStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      if (storage) storage.set("disabledStatuses", [...next]);
      return next;
    });
  };
  const derived = useMemo(() => {
    if (!data || !data.tasks) return null;
    const nowSec = Date.now() / 1e3;
    const domain2 = win ? { min: win.min, max: win.max } : computeRollingDomain(nowSec);
    let visible = data.tasks.filter((t) => taskVisible(t, showDone, nowSec, domain2.min, domain2.max));
    if (disabledStatuses.size > 0) {
      visible = visible.filter((t) => !disabledStatuses.has(t.status));
    }
    if (selectedAssignees.size > 0) {
      visible = visible.filter((t) => t.assignee && selectedAssignees.has(t.assignee));
    }
    visible = visible.filter((t) => matchesSearch(t, search));
    const rows2 = buildRows(visible);
    const allAssignees = Array.from(new Set(data.tasks.map((t) => t.assignee).filter(Boolean))).sort();
    return { rows: rows2, domain: domain2, total: visible.length, tasks: visible, allAssignees };
  }, [data, disabledStatuses, selectedAssignees, search, showDone, win]);
  const handleToggleCheck = (id, checked, nativeEvent) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const rowsList = derived?.rows || [];
      const taskIds = rowsList.map((r) => r.task.id);
      if (nativeEvent?.shiftKey && lastCheckedIdRef.current && taskIds.includes(lastCheckedIdRef.current)) {
        const lastIdx = taskIds.indexOf(lastCheckedIdRef.current);
        const curIdx = taskIds.indexOf(id);
        const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        for (let i = start; i <= end; i++) {
          if (checked) next.add(taskIds[i]);
          else next.delete(taskIds[i]);
        }
      } else {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    lastCheckedIdRef.current = id;
  };
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (selectedIds.size > 0) {
          setSelectedIds(/* @__PURE__ */ new Set());
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, derived]);
  const bulkMutation = useMutation({
    mutationFn: ({ action, ids }) => apiFetch(`/tasks/bulk${board ? `?board=${encodeURIComponent(board)}` : ""}`, {
      method: "POST",
      body: { ids, action }
    }),
    onSuccess: () => {
      setSelectedIds(/* @__PURE__ */ new Set());
      setBulkAssignee("");
      void queryClient2.invalidateQueries({ queryKey: ["kanban-live-gantt"] });
    }
  });
  const handleToggleShowDone = () => {
    setShowDone((prev) => {
      const next = !prev;
      if (storage) storage.set("showDone", next);
      return next;
    });
  };
  const setBoard = (slug) => {
    $boardSlug.set(slug);
    if (storage) storage.set("board", slug);
    setSearch("");
    void queryClient2.invalidateQueries({ queryKey: ["kanban-live-gantt", "gantt"] });
  };
  useEffect(() => {
    if (!board && boardsData?.boards?.length) {
      const fallback = boardsData.current || boardsData.boards[0].slug;
      if (fallback) setBoard(fallback);
    }
  }, [boardsData, board]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observe = () => setTrackW(el.getBoundingClientRect().width);
    observe();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(observe);
      ro.observe(el);
    } else {
      window.addEventListener("resize", observe);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", observe);
    };
  }, []);
  const boards = boardsData?.boards || [];
  const isAllBoards = board === "all" || board === "*";
  const currentBoardObj = isAllBoards ? { slug: "all", label: i18n.allBoards } : boards.find((b) => b.slug === (board || boardsData?.current));
  const boardLabel = (slug) => {
    if (slug === "all" || slug === "*") return i18n.allBoards;
    return boards.find((b) => b.slug === slug)?.label || slug || "—";
  };
  const visibleWidth = Math.max(trackW - labelW - 24, 300);
  const basePerSec = visibleWidth / (WINDOW_BACK + WINDOW_AHEAD);
  const basePxPerHour = basePerSec * 3600;
  const maxZoom = Math.max(1, ZOOM_MAX_PX_PER_HOUR / basePxPerHour);
  const effZoom = Math.min(Math.max(zoom, 1), maxZoom);
  const pxPerSec = basePerSec * effZoom;
  const resetView = () => {
    setZoom(1);
    setWin(null);
    if (storage) storage.set("zoom", 1);
  };
  const applyWindow = (next) => {
    setWin({ min: Math.round(next.min), max: Math.round(next.max) });
  };
  const zoomAnchorRef = useRef(null);
  useEffect(() => {
    const el = scrollerRef.current;
    const domainMin = derived && derived.domain ? derived.domain.min : null;
    if (!el || domainMin == null) return void 0;
    const onWheel = (event) => {
      const rect = el.getBoundingClientRect();
      const xInView = event.clientX - rect.left;
      if (xInView < labelW) return;
      if (event.shiftKey) {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        el.scrollLeft += delta;
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const contentX = el.scrollLeft + xInView;
      const at = domainMin + Math.max(0, contentX - labelW) / pxPerSec;
      const next = Math.min(Math.max(effZoom * Math.exp(-event.deltaY * 22e-4), 1), maxZoom);
      if (Math.abs(next - effZoom) < 1e-4) return;
      zoomAnchorRef.current = { at, xInView };
      setZoom(next);
      if (storage) storage.set("zoom", next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [derived, labelW, pxPerSec, effZoom, maxZoom]);
  useEffect(() => {
    const el = scrollerRef.current;
    const anchor = zoomAnchorRef.current;
    if (!el || !anchor || !derived || !derived.domain) return;
    zoomAnchorRef.current = null;
    el.scrollLeft = Math.max(0, labelW + (anchor.at - derived.domain.min) * pxPerSec - anchor.xInView);
  }, [pxPerSec, labelW, derived]);
  const hasAutoScrolledBoardRef = useRef(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !derived || !derived.domain) return;
    if (win) return;
    if (hasAutoScrolledBoardRef.current === board) return;
    hasAutoScrolledBoardRef.current = board;
    const nowSec = Date.now() / 1e3;
    const vw = Math.max(trackW - labelW - 24, 300);
    el.scrollLeft = Math.max(0, labelW + (nowSec - derived.domain.min) * pxPerSec - vw / 2);
  }, [board, derived, trackW, pxPerSec, labelW, win]);
  if (isLoading && !data) {
    return jsx("div", { className: "flex h-full items-center justify-center p-8", children: jsx(Loader, {}) });
  }
  if (isError) {
    return jsx("div", { className: "p-6", children: jsx(ErrorState, {
      title: i18n.cannotLoadBoard,
      description: i18n.cannotLoadBoardDesc(base)
    }) });
  }
  if (!derived || !derived.domain) {
    return jsx("div", { className: "p-6", children: jsx(EmptyState, { title: i18n.emptyBoard, description: i18n.emptyBoardDesc(boardLabel(board)) }) });
  }
  const now = Date.now() / 1e3;
  const { rows, domain } = derived;
  const timelineW = Math.max(1, Math.ceil((domain.max - domain.min) * pxPerSec));
  const grid = rows.map((row, idx) => jsx(TaskRow, {
    ...row,
    now,
    pxPerSec,
    min: domain.min,
    max: domain.max,
    timelineW,
    onOpen: (id) => $openTaskId.set(id),
    isSelected: openTaskId === row.task.id,
    isChecked: selectedIds.has(row.task.id),
    onToggleCheck: handleToggleCheck,
    isEven: idx % 2 === 0,
    showBoardBadge: isAllBoards
  }, row.task.id));
  const STATUS_PRIORITY = ["blocked", "running", "review", "ready", "scheduled", "todo", "triage", "done", "archived"];
  const blockedCount = derived.tasks.filter((t) => t.status === "blocked").length;
  const dominantStatus = (() => {
    const present = new Set(derived.tasks.map((t) => t.status));
    for (const s of STATUS_PRIORITY) {
      if (present.has(s)) return s;
    }
    return "todo";
  })();
  const dominantTone = statusTone(dominantStatus);
  const dockDrawer = Boolean(openTaskId && drawerDocked);
  return jsxs("div", {
    ref: containerRef,
    // No root padding: the desktop shell already insets plugin pages, and the
    // demo adds its own body padding (tests/demo.html).
    className: cn("relative h-full flex", dockDrawer ? "flex-row gap-3" : "flex-col"),
    children: [
      // Desktop titlebar chrome: exists exactly while this page is mounted —
      // the board switcher lives in the titlebar band (titleBar.center), like
      // the official kanban plugin's switcher.
      jsx(Contribute, { area: TITLEBAR_AREAS.center, id: "kanban-gantt:board-switcher", children: jsx(TitlebarBoardSwitcher, {}) }),
      // Main column (header + chart + legend). When the drawer is docked it
      // becomes a flex sibling of this column, so the gantt shrinks to make
      // room instead of being covered. Carries the view padding (the desktop
      // shell already insets contributed pages; the demo adds its own).
      jsxs("div", {
        className: "flex flex-col flex-1 min-h-0 min-w-0 pl-3 py-2",
        children: [
          // Top header row: Left title + task count badge + blocked badge + filter + search, Center board switcher, Right refresh
          jsxs("div", {
            className: "flex flex-wrap items-center justify-between gap-2 mb-2",
            children: [
              // Left: Title + Task Count Badge + Blocked Badge + Filter + Search Field
              jsxs("div", {
                className: "inline-flex items-center gap-2 text-sm font-medium",
                children: [
                  jsx("span", { className: "font-semibold", children: i18n.title }),
                  jsx("span", {
                    className: "inline-flex items-center justify-center rounded-full px-2 py-0.2 text-[10.5px] font-semibold tracking-tight shadow-xs cursor-help",
                    title: i18n.nTasksTotal(derived.total, dominantStatus),
                    style: {
                      backgroundColor: `color-mix(in srgb, ${dominantTone} 18%, transparent)`,
                      borderColor: `color-mix(in srgb, ${dominantTone} 40%, transparent)`,
                      borderWidth: "1px",
                      color: dominantTone
                    },
                    children: `${derived.total}`
                  }),
                  blockedCount > 0 ? jsxs("span", {
                    className: "inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10.5px] font-semibold tracking-tight shadow-xs text-[#f87171] border border-[#f87171]/40 bg-[#f87171]/18 cursor-help",
                    title: i18n.nBlockedWarning(blockedCount),
                    children: [
                      jsx(Codicon, { name: "warning", size: "0.8rem" }),
                      jsx("span", { children: `${blockedCount}` })
                    ]
                  }) : null,
                  jsx(FilterDropdown, {
                    assignees: derived.allAssignees || [],
                    selectedAssignees,
                    onToggleAssignee: handleToggleAssignee,
                    onClearAssignees: handleClearAssignees,
                    disabledStatuses,
                    onToggleStatus: handleToggleStatus,
                    showDone,
                    onToggleShowDone: handleToggleShowDone
                  }),
                  jsxs("div", {
                    className: "inline-flex items-center gap-1.5 border-b border-transparent focus-within:border-(--ui-stroke-secondary) px-1 py-0.5 ml-1",
                    children: [
                      jsx(Codicon, { name: "search", size: "0.85rem", className: "text-(--ui-text-quaternary)" }),
                      jsx("input", {
                        type: "search",
                        value: search,
                        placeholder: i18n.filterCards,
                        className: "bg-transparent border-0 text-xs text-(--ui-text-primary) placeholder:text-(--ui-text-quaternary) focus:outline-none w-48",
                        onInput: (event) => setSearch(event.target.value)
                      })
                    ]
                  })
                ]
              }),
              // Board switcher moved to the desktop titlebar band (titleBar.center)
              // — see TitlebarBoardSwitcher above.
              // Right: window chip (manual only) + zoom chip + Refresh
              jsxs("div", {
                className: "inline-flex items-center gap-3",
                children: [
                  win !== null ? jsx("button", {
                    type: "button",
                    onClick: resetView,
                    title: i18n.zoomReset,
                    className: "rounded px-1.5 py-0.5 text-[10px] border border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:text-(--ui-text-secondary) cursor-pointer",
                    children: i18n.resetWindow
                  }) : null,
                  effZoom > 1.001 ? jsx("button", {
                    type: "button",
                    onClick: resetView,
                    title: i18n.zoomReset,
                    className: "rounded px-1.5 py-0.5 text-[10px] tabular-nums border border-(--ui-accent)/40 bg-(--ui-accent)/10 text-(--ui-accent) cursor-pointer",
                    children: `×${effZoom >= 10 ? Math.round(effZoom) : effZoom.toFixed(1)}`
                  }) : null,
                  jsx(Button, { size: "xs", onClick: () => void queryClient2.invalidateQueries({ queryKey: ["kanban-live-gantt", "gantt"] }), children: i18n.refresh })
                ]
              })
            ]
          }),
          rows.length === 0 ? jsx("div", {
            className: "py-10",
            children: jsx(EmptyState, { title: i18n.nothingToDisplay, description: i18n.noTasksMatch })
          }) : jsxs("div", {
            className: "mt-2 border border-(--ui-stroke-tertiary) rounded-md overflow-hidden flex-1 min-h-0 flex flex-col relative",
            children: [
              jsx(SelectionBar, {
                selected: selectedIds,
                onClear: () => setSelectedIds(/* @__PURE__ */ new Set()),
                onStatus: (status) => bulkMutation.mutate({ action: status, ids: [...selectedIds] }),
                onAssign: (profile) => bulkMutation.mutate({ action: "assign", ids: [...selectedIds], assignee: profile }),
                onArchive: () => bulkMutation.mutate({ action: "archive", ids: [...selectedIds] }),
                onDelete: () => {
                  if (confirm(i18n.confirmDelete(`${selectedIds.size} tasks`))) {
                    bulkMutation.mutate({ action: "delete", ids: [...selectedIds] });
                  }
                },
                assignees: derived.allAssignees || [],
                busy: bulkMutation.isPending
              }),
              jsxs("div", {
                ref: scrollerRef,
                className: "overflow-auto flex-1 min-h-0 relative",
                children: [
                  jsxs("div", {
                    className: "grid w-max sticky top-0 z-20 bg-(--ui-bg-chrome)",
                    "data-glass-opaque": true,
                    style: { gridTemplateColumns: `${labelW}px ${timelineW}px` },
                    children: [
                      jsxs("div", {
                        className: "sticky left-0 z-30 bg-(--ui-bg-chrome) border-r border-b border-(--ui-stroke-tertiary) flex items-center px-2 gap-1.5",
                        "data-glass-opaque": true,
                        style: { height: pxPerSec * DAY >= 50 ? "32px" : "24px" },
                        children: [
                          jsx("input", {
                            type: "checkbox",
                            checked: Boolean(derived.rows.length > 0 && selectedIds.size === derived.rows.length),
                            ref: (el) => {
                              if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < derived.rows.length;
                            },
                            onChange: (e) => {
                              if (e.target.checked) {
                                setSelectedIds(new Set(derived.rows.map((r) => r.task.id)));
                              } else {
                                setSelectedIds(/* @__PURE__ */ new Set());
                              }
                            },
                            className: "rounded cursor-pointer",
                            "aria-label": i18n.selectAll
                          }),
                          jsx("span", { className: "text-[10px] text-(--ui-text-tertiary) uppercase font-medium select-none", children: i18n.tasksHeader }),
                          jsx(ResizeHandle, {
                            get: () => $labelW.get(),
                            set: (w) => $labelW.set(w),
                            min: LABEL_W_MIN,
                            max: LABEL_W_MAX,
                            resetTo: LABEL_W,
                            storageKey: "labelW"
                          })
                        ]
                      }),
                      jsx(Ruler, { min: domain.min, max: domain.max, pxPerSec, now, onResetView: resetView, onWindow: applyWindow })
                    ]
                  }),
                  jsxs("div", {
                    className: "relative flex flex-col w-max",
                    children: [
                      jsxs("div", {
                        className: "absolute top-0 bottom-0 pointer-events-none z-0",
                        style: { left: `${labelW}px`, width: `${timelineW}px` },
                        children: [
                          jsx(WeekendBands, { min: domain.min, max: domain.max, pxPerSec }),
                          jsx(HourLines, { min: domain.min, max: domain.max, pxPerSec }),
                          jsx(NowLine, { min: domain.min, max: domain.max, pxPerSec, now })
                        ]
                      }),
                      grid
                    ]
                  })
                ]
              })
            ]
          }),
          jsx("div", {
            children: jsx(Legend, { disabledStatuses, onToggleStatus: handleToggleStatus, showDone, onToggleShowDone: handleToggleShowDone })
          })
        ]
      }),
      openTaskId ? jsx(TaskDrawer, {
        taskId: openTaskId,
        board,
        assignees: derived.allAssignees || [],
        onClose: () => $openTaskId.set(null),
        docked: dockDrawer,
        onToggleDock: () => {
          const next = !drawerDocked;
          $drawerDocked.set(next);
          if (storage) storage.set("drawerDocked", next ? "1" : "0");
        }
      }) : null
    ]
  });
}
var plugin = {
  id: ID,
  name: "Kanban Live Gantt",
  description: "Live Gantt of a Hermes kanban board — a now-centered, slidable 72 h window (default now − 24h → now + 48h), open work by default (done optional), free wheel zoom. Local fork of kanban-gantt.",
  register(ctx) {
    rest = ctx.rest;
    storage = ctx.storage;
    $baseUrl.set((ctx.storage.get("baseUrl", "") || "").replace(/\/+$/, ""));
    $boardSlug.set(ctx.storage.get("board", "") || "");
    $labelW.set(Number(ctx.storage.get("labelW", LABEL_W)) || LABEL_W);
    $drawerW.set(Number(ctx.storage.get("drawerW", 416)) || 416);
    $drawerDocked.set(ctx.storage.get("drawerDocked", "0") === "1");
    if (ctx.i18n && typeof ctx.i18n.register === "function") {
      ctx.i18n.register(GANTT_LOCALES);
    }
    if (!document.getElementById("kg-arc-style")) {
      const style = document.createElement("style");
      style.id = "kg-arc-style";
      style.textContent = `
@property --kg-arc-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.kg-arc {
  pointer-events: none; position: absolute; inset: -2px; border-radius: 4px;
  padding: 1.5px;
  background: conic-gradient(from var(--kg-arc-angle), transparent 0deg,
    var(--kanban-tone, var(--ui-stroke-primary)) 55deg, transparent 110deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: kg-arc-spin 2.2s linear infinite;
}
@keyframes kg-arc-spin { to { --kg-arc-angle: 360deg; } }
`;
      document.head.appendChild(style);
    }
    const tr = (key, fallback) => ctx.i18n && typeof ctx.i18n.t === "function" ? ctx.i18n.t(key) : fallback;
    ctx.registerMany([
      {
        id: "page",
        area: ROUTES_AREA,
        data: { path: "/kanban-live-gantt" },
        render: () => jsx(KanbanGanttPage, {})
      }
    ]);
    const registerLabels = () => ctx.registerMany([
      {
        id: "nav",
        area: SIDEBAR_NAV_AREA,
        order: 70,
        data: { codicon: "calendar", label: tr("nav", "Kanban Live"), path: "/kanban-live-gantt" }
      },
      {
        id: "open",
        area: PALETTE_AREA,
        data: {
          id: "kanbanLiveGantt.open",
          label: tr("openCommand", "Kanban Live Gantt: open the now-centered timeline"),
          keywords: ["kanban", "gantt", "day", "today", "timeline", "日视图"],
          run: () => host.navigate("/kanban-live-gantt")
        }
      }
    ]);
    let disposeLabels = registerLabels();
    if (ctx.i18n && typeof ctx.i18n.onLocaleChange === "function") {
      ctx.i18n.onLocaleChange(() => {
        disposeLabels();
        disposeLabels = registerLabels();
      });
    }
  }
};
var main_default = plugin;
export {
  KanbanGanttPage,
  main_default as default
};
