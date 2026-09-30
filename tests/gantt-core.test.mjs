#!/usr/bin/env node
/**
 * Core unit tests for the kanban-live-gantt timeline logic.
 * Imports the BUILT module (desktop/gantt-core.js) so tests run against the
 * exact shipped code. Run: npm run build && node --test tests/gantt-core.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DAY, SEG_TONE, statusTone,
  taskSegments, taskRecency, shortId, matchesSearch, buildRows,
  isActive, localDayStart, dayStartsBetween, computeRollingDomain, daySegments, taskVisible, barInWindow, hourTickPlan,
  slideWindow, slideWindowByPixels, resizeWindow, MIN_WINDOW, WINDOW_BACK, WINDOW_AHEAD,
  splitDuration } from '../desktop/gantt-core.js'

const NOW = 1_800_000_000 // fixed clock for the pure logic tests

test('isActive — done and archived never show in the live view', () => {
  assert.equal(isActive({ status: 'running' }), true)
  assert.equal(isActive({ status: 'todo' }), true)
  assert.equal(isActive({ status: 'blocked' }), true)
  assert.equal(isActive({ status: 'done' }), false)
  assert.equal(isActive({ status: 'archived' }), false)
  // bare archived flag (not a status) also hides the task
  assert.equal(isActive({ status: 'running', archived: true }), false)
  assert.equal(isActive(null), false)
})

test('localDayStart — local midnight of the day containing the timestamp', () => {
  const mid = localDayStart(NOW)
  const d = new Date(mid * 1000)
  assert.equal(d.getHours(), 0)
  assert.equal(d.getMinutes(), 0)
  assert.equal(d.getSeconds(), 0)
  assert.ok(mid <= NOW && NOW - mid < DAY)
})

test('computeRollingDomain — default window: now − 24 h → now + 48 h (72 h)', () => {
  const d = computeRollingDomain(NOW)
  assert.equal(d.min, NOW - WINDOW_BACK)
  assert.equal(d.max, NOW + WINDOW_AHEAD)
  assert.equal(d.max - d.min, 72 * 3600)
})

test('window helpers — slide, pixel-slide, one-edge resize (MIN_WINDOW floor)', () => {
  const w = { min: NOW - 24 * 3600, max: NOW + 48 * 3600 }
  assert.deepEqual(slideWindow(w, 3600), { min: w.min + 3600, max: w.max + 3600 })
  // dragging the ruler right pulls the window back in time (content follows the pointer)
  assert.deepEqual(slideWindowByPixels(w, 100, 0.01), { min: w.min - 10_000, max: w.max - 10_000 })
  // one edge at a time
  assert.deepEqual(resizeWindow(w, 'start', NOW), { min: NOW, max: w.max })
  assert.deepEqual(resizeWindow(w, 'end', NOW + 20 * 3600), { min: w.min, max: NOW + 20 * 3600 })
  // never below MIN_WINDOW (2 h)
  assert.equal(resizeWindow(w, 'start', w.max + 3600).min, w.max - MIN_WINDOW)
  assert.equal(resizeWindow(w, 'end', w.min - 3600).max, w.min + MIN_WINDOW)
  assert.equal(MIN_WINDOW, 2 * 3600)
  assert.equal(WINDOW_BACK, 24 * 3600)
  assert.equal(WINDOW_AHEAD, 48 * 3600)
})

test('splitDuration — d/h/m/s parts for done-bar tooltip durations', () => {
  assert.deepEqual(splitDuration(0), { d: 0, h: 0, m: 0, s: 0 })
  assert.deepEqual(splitDuration(45), { d: 0, h: 0, m: 0, s: 45 })
  assert.deepEqual(splitDuration(3661), { d: 0, h: 1, m: 1, s: 1 })
  assert.deepEqual(splitDuration(90 * 3600 + 61), { d: 3, h: 18, m: 1, s: 1 })
  assert.deepEqual(splitDuration(-5), { d: 0, h: 0, m: 0, s: 0 }) // negative -> zeroed
})

test('daySegments — rolling window splits into local days (partial ends kept)', () => {
  // deterministic: 05:00 local → +48 h (three segments, first/last partial)
  const min = localDayStart(NOW) + 5 * 3600
  const max = min + 2 * DAY
  const segs = daySegments(min, max)
  assert.equal(segs.length, 3)
  assert.equal(segs[0].start, min)
  assert.equal(segs[0].end, localDayStart(NOW) + DAY)
  assert.equal(segs[1].start, segs[0].end)
  assert.equal(segs[1].end, segs[0].end + DAY)
  assert.equal(segs[2].end, max)
  assert.equal(segs[0].dayStart, localDayStart(min))
  // the default 72 h window yields 3–4 segments covering it exactly
  const roll = computeRollingDomain(NOW)
  const rs = daySegments(roll.min, roll.max)
  assert.ok(rs.length === 3 || rs.length === 4, `segments: ${rs.length}`)
  assert.equal(rs[0].start, roll.min)
  assert.equal(rs[rs.length - 1].end, roll.max)
  for (let i = 1; i < rs.length; i++) assert.equal(rs[i].start, rs[i - 1].end)
})

test('taskVisible — window-consistent: any overlapping segment shows the row', () => {
  const { min, max } = computeRollingDomain(NOW)
  // running task: its live run span reaches "now" → visible
  assert.equal(taskVisible({ id: 't_a', status: 'running', created_at: NOW - 600 }, false, NOW, min, max), true)
  // old todo (created days ago, never run): the waiting span is clipped into
  // the window and renders as a dashed bar → visible
  const oldTodo = { id: 't_o', status: 'todo', created_at: NOW - 5 * DAY }
  assert.equal(taskVisible(oldTodo, false, NOW, min, max), true)
  // …but gone once the window no longer touches its waiting span (future-only)
  assert.equal(taskVisible(oldTodo, false, NOW, NOW + 3600, NOW + 5 * 3600), false)
  const doneOld = { id: 't_d1', status: 'done', completed_at: NOW - 5 * DAY }
  const doneNow = { id: 't_d2', status: 'done', completed_at: NOW - 3600 }
  // done: hidden without the toggle …
  assert.equal(taskVisible(doneOld, false, NOW, min, max), false)
  assert.equal(taskVisible(doneNow, false, NOW, min, max), false)
  // … toggle on: only the one with activity inside the window
  assert.equal(taskVisible(doneOld, true, NOW, min, max), false)
  assert.equal(taskVisible(doneNow, true, NOW, min, max), true)
  // archived never returns, even with the toggle on
  assert.equal(taskVisible({ id: 't_ar', status: 'archived', archived: true, completed_at: NOW - 60 }, true, NOW, min, max), false)
})

test('dayStartsBetween — one local day start per day cell of the window', () => {
  const min = localDayStart(NOW)
  const max = min + 3 * DAY
  const starts = dayStartsBetween(min, max)
  assert.equal(starts.length, 3)
  assert.equal(starts[0], min)
  assert.equal(starts[1], min + DAY)
  assert.equal(starts[2], min + 2 * DAY)
  // mid-day window start: the containing day is included
  const midStarts = dayStartsBetween(min + 3600 * 5, max)
  assert.equal(midStarts[0], min)
})

test('barInWindow — bars outside the window are not drawn', () => {
  const min = localDayStart(NOW)
  const max = min + 3 * DAY
  assert.equal(barInWindow({ t0: min + 3600, t1: min + 7200 }, min, max), true)
  assert.equal(barInWindow({ t0: min - 3 * DAY, t1: min + 60 }, min, max), true) // crosses left edge
  assert.equal(barInWindow({ t0: min - 3 * DAY, t1: min - 60 }, min, max), false) // entirely before
  assert.equal(barInWindow({ t0: max + 60, t1: max + 3600 }, min, max), false) // entirely after
  assert.equal(barInWindow({ t0: min - 10, t1: min }, min, max), false) // touching left edge
  // zero-width spans (instant markers) count while inside the window
  assert.equal(barInWindow({ t0: min + 60, t1: min + 60 }, min, max), true)
  assert.equal(barInWindow({ t0: min - 60, t1: min - 60 }, min, max), false)
  assert.equal(barInWindow(null, min, max), false)
})

test('taskSegments — wait/run chain: exact spans, ends at now, fail & blocked tones', () => {
  // multi-run running task: wait → failed run → wait → live run (ends at NOW)
  const multi = {
    id: 't_m', status: 'running', created_at: NOW - 10800,
    runs: [
      { id: 1, started_at: NOW - 7200, ended_at: NOW - 7000, outcome: 'rate_limited' },
      { id: 2, started_at: NOW - 3600, ended_at: null, status: 'running' }
    ]
  }
  assert.deepEqual(
    taskSegments(multi, NOW).map(s => [s.kind, s.tone, s.t0, s.t1]),
    [
      ['wait', 'wait', NOW - 10800, NOW - 7200],
      ['run', 'fail', NOW - 7200, NOW - 7000],
      ['wait', 'wait', NOW - 7000, NOW - 3600],
      ['run', 'live', NOW - 3600, NOW]
    ]
  )
  assert.ok(taskSegments(multi, NOW).every(s => s.t1 <= NOW), 'no segment extends past "now"')

  // a short finished run keeps its EXACT span — no 2 h stretching
  const done = { id: 't_d', status: 'done', created_at: NOW - 10800, run_started_at: NOW - 7200, run_ended_at: NOW - 5400, completed_at: NOW - 5300 }
  assert.deepEqual(
    taskSegments(done, NOW).map(s => [s.kind, s.tone, s.t0, s.t1]),
    [
      ['wait', 'wait', NOW - 10800, NOW - 7200],
      ['run', 'run', NOW - 7200, NOW - 5400]
    ]
  )

  // still-open task after its last run: the waiting span continues to now
  const idle = { id: 't_i', status: 'ready', created_at: NOW - 7200, run_started_at: NOW - 7200, run_ended_at: NOW - 3600 }
  assert.deepEqual(taskSegments(idle, NOW).map(s => [s.kind, s.t1]), [['run', NOW - 3600], ['wait', NOW]])

  // blocked: the trailing waiting span carries the blocked tone
  const blocked = { id: 't_b', status: 'blocked', created_at: NOW - 7200, run_started_at: NOW - 7200, run_ended_at: NOW - 3600 }
  const bsegs = taskSegments(blocked, NOW)
  assert.equal(bsegs[bsegs.length - 1].tone, 'blocked')
  assert.equal(bsegs[bsegs.length - 1].ongoing, true)

  // hand-completed (no runs at all): waiting span + instant marker
  const hand = { id: 't_h', status: 'done', created_at: NOW - 3600, completed_at: NOW - 600 }
  assert.deepEqual(
    taskSegments(hand, NOW).map(s => [s.kind, s.instant === true, s.t0, s.t1]),
    [
      ['wait', false, NOW - 3600, NOW - 600],
      ['run', true, NOW - 600, NOW - 600]
    ]
  )
})

test('shortId / matchesSearch / statusTone basics', () => {
  assert.equal(shortId('t_abcdef123'), 'abcdef')
  assert.equal(matchesSearch({ title: 'Fix the parser' }, 'parser'), true)
  assert.equal(matchesSearch({ title: 'Fix the parser' }, 'nomatch'), false)
  assert.equal(matchesSearch({ title: 'x' }, ''), true)
  // v0.1.3 palette: red = failure only, amber = blocked, green = live, pink = review
  assert.equal(statusTone('running'), '#34d399')
  assert.equal(statusTone('blocked'), '#e0a13a')
  assert.equal(statusTone('review'), '#f472b6')
  assert.equal(statusTone('ready'), '#4d9fff')
  assert.equal(statusTone('done'), '#7c8798')
  assert.equal(statusTone('unknown-status'), 'var(--ui-text-secondary)')
})

test('buildRows — siblings ordered by recency desc; children stay under parents', () => {
  const tasks = [
    { id: 't_old', title: 'old', created_at: NOW - 5 * DAY },
    { id: 't_new', title: 'new', created_at: NOW - 60 },
    { id: 't_p', title: 'parent', created_at: NOW - 10 * DAY, children: ['t_c_old', 't_c_run'] },
    { id: 't_c_run', title: 'child running', status: 'running', created_at: NOW - DAY, parents: ['t_p'] },
    { id: 't_c_old', title: 'child old', created_at: NOW - 9 * DAY, parents: ['t_p'] }
  ]
  const rows = buildRows(tasks, NOW)
  assert.deepEqual(rows.map(r => [r.task.id, r.depth]), [
    ['t_p', 0], ['t_c_run', 1], ['t_c_old', 1],   // parent floats up via its running child
    ['t_new', 0], ['t_old', 0]
  ])
  // basics unchanged: a plain parent/child pair stays nested
  const flat = buildRows([
    { id: 't_a', title: 'parent', children: ['t_b'] },
    { id: 't_b', title: 'child', parents: ['t_a'] }
  ], NOW)
  assert.deepEqual(flat.map(r => [r.task.id, r.depth, r.isChild]), [['t_a', 0, false], ['t_b', 1, true]])
  // a running root outranks everything else
  const runFirst = buildRows([
    { id: 'x1', title: 'waiting', created_at: NOW - 10 },
    { id: 'x2', title: 'running', status: 'running', created_at: NOW - DAY }
  ], NOW)
  assert.deepEqual(runFirst.map(r => r.task.id), ['x2', 'x1'])
})

test('taskRecency — running now > last run > created (never-run)', () => {
  assert.equal(taskRecency({ status: 'running', created_at: NOW - DAY }, NOW), NOW)
  assert.equal(taskRecency({ status: 'ready', runs: [{ started_at: NOW - 7200, ended_at: NOW - 3600 }] }, NOW), NOW - 3600)
  assert.equal(taskRecency({ status: 'todo', created_at: NOW - 7200 }, NOW), NOW - 7200)
  assert.equal(taskRecency({ status: 'done', completed_at: NOW - 600 }, NOW), NOW - 600)
})

test('SEG_TONE sanity — one hue per segment meaning', () => {
  assert.equal(SEG_TONE.wait, '#8a9099')
  assert.equal(SEG_TONE.blocked, '#e0a13a')
  assert.equal(SEG_TONE.run, '#5b8def')
  assert.equal(SEG_TONE.fail, '#ef5350')
  assert.equal(SEG_TONE.live, '#34d399')
  assert.equal(DAY, 86400)
})

test('hourTickPlan — hour scale as you zoom; 15-min minors at the deep end', () => {
  const { min, max } = computeRollingDomain(NOW) // 72 h default window
  const fit = hourTickPlan(min, max, 1000 / (72 * 3600)) // ≈13.9 px/h
  assert.equal(fit.major.length, 0)
  assert.equal(fit.minor.length, 0)

  const z4 = hourTickPlan(min, max, (1000 * 4) / (72 * 3600)) // ≈55.6 px/h
  assert.ok(z4.major.length >= 35 && z4.major.length <= 37, `majors: ${z4.major.length}`) // every 2 h
  const gapPx = (z4.major[1] - z4.major[0]) * (1000 * 4) / (72 * 3600)
  assert.ok(gapPx >= 56, `major spacing < 56 px (${gapPx})`)

  const deep = hourTickPlan(min, max, 240 / 3600) // 240 px/h
  assert.ok(deep.major.length >= 71 && deep.major.length <= 72, `deep majors: ${deep.major.length}`) // every full hour
  assert.ok(deep.minor.length > 100) // :15/:30/:45
  for (const ts of deep.minor) assert.equal(new Date(ts * 1000).getMinutes() % 15, 0)
})
