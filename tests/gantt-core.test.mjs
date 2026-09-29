#!/usr/bin/env node
/**
 * Core unit tests for the kanban-day-gantt timeline logic.
 * Imports the BUILT module (desktop/gantt-core.js) so tests run against the
 * exact shipped code. Run: npm run build && node --test tests/gantt-core.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DAY, MIN_BAR, statusTone,
  barRange, taskBars, shortId, matchesSearch, buildRows,
  isActive, localDayStart, dayStartsBetween, computeRollingDomain, daySegments, taskVisible, barInWindow, hourTickPlan,
  slideWindow, slideWindowByPixels, resizeWindow, MIN_WINDOW, WINDOW_BACK, WINDOW_AHEAD } from '../desktop/gantt-core.js'

const NOW = 1_800_000_000 // fixed clock for the pure logic tests

test('isActive — done and archived never show in the day view', () => {
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

test('taskVisible — done needs the toggle AND window activity; archived never', () => {
  const { min, max } = computeRollingDomain(NOW)
  const active = { id: 't_a', status: 'running', created_at: NOW - 600 }
  assert.equal(taskVisible(active, false, NOW, min, max), true)
  const doneOld = { id: 't_d1', status: 'done', completed_at: NOW - 5 * DAY }
  const doneNow = { id: 't_d2', status: 'done', completed_at: NOW - 3600 }
  // default: hidden
  assert.equal(taskVisible(doneOld, false, NOW, min, max), false)
  assert.equal(taskVisible(doneNow, false, NOW, min, max), false)
  // toggle on: only the one with activity inside the window
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
  assert.equal(barInWindow(null, min, max), false)
})

test('barRange / taskBars — open task created before the window has no bar inside it', () => {
  const min = localDayStart(NOW)
  const max = min + 3 * DAY
  const oldTodo = { id: 't_old', status: 'todo', created_at: min - 3 * DAY }
  const bars = taskBars(oldTodo, NOW)
  assert.equal(bars.length, 1)
  assert.equal(barInWindow(bars[0], min, max), false) // the row shows "—"
  const todayTodo = { id: 't_new', status: 'todo', created_at: min + 600 }
  assert.equal(barInWindow(taskBars(todayTodo, NOW)[0], min, max), true)
})

test('taskBars — running task bar extends to now; multi-run tasks yield one bar per run', () => {
  const running = { id: 't_r', status: 'running', created_at: NOW - 3600, started_at: NOW - 3600 }
  const [bar] = taskBars(running, NOW)
  assert.equal(bar.kind, 'progress')
  assert.ok(bar.t1 >= NOW)

  const multi = {
    id: 't_m', status: 'running',
    runs: [
      { id: 1, started_at: NOW - 7200, ended_at: NOW - 7000, outcome: 'rate_limited' },
      { id: 2, started_at: NOW - 3600, ended_at: null, status: 'running' }
    ]
  }
  const bars = taskBars(multi, NOW)
  assert.equal(bars.length, 2)
  assert.equal(bars[1].kind, 'progress')
  assert.ok(bars[1].t1 >= NOW)
})

test('barRange — done with a real run uses the run window (min-bar clamped)', () => {
  const done = { id: 't_d', status: 'done', run_started_at: NOW - 10800, run_ended_at: NOW - 3600, completed_at: NOW - 3500 }
  const bar = barRange(done, NOW)
  assert.equal(bar.kind, 'done')
  assert.equal(bar.t0, NOW - 10800)
  assert.equal(bar.t1, NOW - 3600)
  // a short real run is stretched to the 2h minimum bar length
  const shortRun = { id: 't_s', status: 'done', run_started_at: NOW - 7200, run_ended_at: NOW - 5400, completed_at: NOW - 5300 }
  assert.equal(barRange(shortRun, NOW).t1, NOW - 7200 + 2 * 3600)
  // unknown duration → minimal anchored bar
  const hand = { id: 't_h', status: 'done', completed_at: NOW - 600 }
  assert.equal(barRange(hand, NOW).kind, 'done-instant')
})

test('shortId / matchesSearch / statusTone / buildRows basics', () => {
  assert.equal(shortId('t_abcdef123'), 'abcdef')
  assert.equal(matchesSearch({ title: 'Fix the parser' }, 'parser'), true)
  assert.equal(matchesSearch({ title: 'Fix the parser' }, 'nomatch'), false)
  assert.equal(matchesSearch({ title: 'x' }, ''), true)
  assert.equal(statusTone('running'), '#34d399')
  assert.equal(statusTone('unknown-status'), 'var(--ui-text-secondary)')

  const rows = buildRows([
    { id: 't_a', title: 'parent', children: ['t_b'] },
    { id: 't_b', title: 'child', parents: ['t_a'] }
  ])
  assert.deepEqual(rows.map(r => [r.task.id, r.depth, r.isChild]), [['t_a', 0, false], ['t_b', 1, true]])
})

test('MIN_BAR sanity', () => {
  assert.equal(MIN_BAR, 2 * 3600)
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
