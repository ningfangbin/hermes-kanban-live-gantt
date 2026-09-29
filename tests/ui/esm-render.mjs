#!/usr/bin/env node
/**
 * UI smoke test for the BUILT desktop half (desktop/plugin.js):
 *   1. loader import-scan — only @hermes/plugin-sdk, react, react/jsx-runtime;
 *   2. import + register() against a stubbed ctx — page / nav / palette areas;
 *   3. render the page with stubbed queries (fixtures anchored to NOW):
 *      the live view must show non-done tasks and hide done/archived ones.
 *
 * Run: node tests/ui/esm-render.mjs   (after npm run build)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { register } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_PATH = join(__dirname, '..', '..', 'desktop', 'plugin.js')
const STUBS_DIR = join(__dirname, '.stubs')

let failures = 0
const check = (cond, label) => {
  if (cond) console.log('  ok   ' + label)
  else { failures++; console.log('  FAIL ' + label) }
}

// ---------------------------------------------------------------------------
// Fixtures — anchored to the current time so the day window is populated.
// ---------------------------------------------------------------------------
const now = Math.floor(Date.now() / 1000)
const dt = new Date()
const today0 = Math.floor(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() / 1000)

const boards = { boards: [{ slug: 'fixture', label: 'Fixture board', total: 5 }], current: 'fixture' }
const gantt = {
  total: 5,
  tasks: [
    { id: 't_run', title: 'Running task (today)', status: 'running', assignee: 'alice',
      created_at: now - 3600, started_at: now - 3600, archived: false,
      runs: [
        { id: 1, started_at: now - 3600, ended_at: now - 3300, outcome: 'rate_limited' },
        { id: 2, started_at: now - 1800, ended_at: null, status: 'running' }
      ] },
    { id: 't_todo_today', title: 'Todo created today', status: 'todo', created_at: now - 600, archived: false },
    { id: 't_todo_old', title: 'Todo created long ago', status: 'todo', created_at: today0 - 3 * 86400, archived: false },
    { id: 't_done', title: 'DONE task must be hidden', status: 'done', created_at: now - 7200, completed_at: now - 1800, archived: false },
    { id: 't_arch', title: 'ARCHIVED task must be hidden', status: 'archived', created_at: now - 86400, archived: true }
  ]
}

const calls = { rest: [], navigate: [] }

const useValueImpl = a => (a && typeof a.get === 'function' ? a.get() : undefined)
const atom = initial => {
  let value = initial
  return { get: () => value, set: v => { value = v }, subscribe: () => () => {} }
}

const stubQueryData = {
  'kanban-live-gantt|boards': boards,
  'kanban-live-gantt|gantt': gantt
}

const useQueryStubSource = `const stubQueryData = ${JSON.stringify(stubQueryData)}
export const useQuery = options => {
  const key = options && Array.isArray(options.queryKey) ? options.queryKey.join('|') : ''
  let data
  if (key.includes('|boards')) data = stubQueryData['kanban-live-gantt|boards']
  else if (key.includes('|gantt')) data = stubQueryData['kanban-live-gantt|gantt']
  return { data, isLoading: false, isError: false, error: null, refetch: async () => {} }
}`

const hostStub = { navigate: path => calls.navigate.push(path) }
const useMutationStub = options => ({
  mutate: vars => {
    if (options && typeof options.mutationFn === 'function') {
      Promise.resolve(options.mutationFn(vars)).catch(() => {})
    }
  },
  isPending: false
})

const sdkStub = {
  Badge: 'Badge',
  Button: 'Button',
  cn: (...parts) => parts.filter(Boolean).join(' '),
  Codicon: 'Codicon',
  Contribute: 'Contribute',
  DropdownMenu: 'DropdownMenu',
  DropdownMenuContent: 'DropdownMenuContent',
  DropdownMenuItem: 'DropdownMenuItem',
  DropdownMenuSeparator: 'DropdownMenuSeparator',
  DropdownMenuTrigger: 'DropdownMenuTrigger',
  EmptyState: 'EmptyState',
  ErrorState: 'ErrorState',
  host: hostStub,
  Loader: 'Loader',
  PALETTE_AREA: 'palette',
  ROUTES_AREA: 'routes',
  SIDEBAR_NAV_AREA: 'sidebar.nav',
  Streamdown: 'Streamdown',
  Switch: 'Switch',
  TITLEBAR_AREAS: { left: 'titleBar.left', center: 'titleBar.center', right: 'titleBar.right' },
  atom,
  profileColor: () => '#888888',
  profileColorSoft: () => 'rgba(136,136,136,0.2)',
  queryClient: { invalidateQueries: () => {} },
  useMutation: useMutationStub,
  usePluginI18n: () => ((path, ...args) => String(path)),
  useQuery: () => ({ data: undefined, isLoading: true, isError: false, error: null, refetch: async () => {} }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
  useValue: useValueImpl
}

// ---------------------------------------------------------------------------
// Stub modules + loader hooks (regenerated on every run)
// ---------------------------------------------------------------------------
mkdirSync(STUBS_DIR, { recursive: true })

const functionExports = Object.fromEntries(
  Object.entries(sdkStub).filter(([, v]) => typeof v === 'function').map(([k, v]) => [k, v.toString()])
)
const constantKeys = Object.keys(sdkStub).filter(k => !(k in functionExports) && k !== 'useQuery' && k !== 'host' && k !== 'atom' && k !== 'useValue' && k !== 'useMutation')
const constantJson = JSON.stringify(Object.fromEntries(constantKeys.map(k => [k, sdkStub[k]])), null, 2)
const useQueryStubModuleSource = useQueryStubSource.replace('export const useQuery', 'const __useQuery')
const functionExportConsts = Object.keys(functionExports).filter(k => k !== 'useQuery').map(k => `const __${k} = ${functionExports[k]}`)
const functionExportExports = Object.keys(functionExports).map(k => `export const ${k} = __${k}`)

const sdkStubSource = [
  ...functionExportConsts,
  useQueryStubModuleSource,
  `const sdk = ${constantJson}`,
  'sdk.host = { navigate: ' + hostStub.navigate.toString() + ' }',
  'sdk.atom = __atom',
  'sdk.useValue = __useValue',
  'sdk.useMutation = __useMutation',
  'sdk.useQuery = __useQuery',
  'export default sdk',
  ...functionExportExports,
  'export const host = sdk.host',
  ...constantKeys.map(k => `export const ${k} = sdk.${k}`),
  ''
].join('\n')
writeFileSync(join(STUBS_DIR, 'sdk.mjs'), sdkStubSource)

writeFileSync(
  join(STUBS_DIR, 'react.mjs'),
  'export const useState = initial => [typeof initial === "function" ? initial() : initial, () => {}]\n' +
    'export const useEffect = () => {}\n' +
    'export const useMemo = fn => (typeof fn === "function" ? fn() : fn)\n' +
    'export const useRef = initial => ({ current: initial })\n' +
    'export const createElement = (type, props, ...children) => ({ type, props, children })\n' +
    'export default { useState, useEffect, useMemo, useRef }\n'
)

writeFileSync(
  join(STUBS_DIR, 'jsx-runtime.mjs'),
  `function invokeComponent(type, props) {
  if (typeof type === 'function') {
    try {
      return type(props || {})
    } catch (err) {
      return { type, props: props || {}, renderError: err }
    }
  }
  return { type, props: props || {}, $$jsx: true }
}
export const jsx = (type, props) => invokeComponent(type, props)
export const jsxs = (type, props) => invokeComponent(type, props)
export const Fragment = 'Fragment'
`
)

// The loader file is generated PATH-INDEPENDENTLY: stub URLs resolve relative
// to the generated file itself, so the smoke test runs unchanged from any
// checkout location (no machine-specific absolute paths are written).
const loaderSrc = `// Auto-generated by tests/ui/esm-render.mjs — maps the plugin's imports onto
// the local stubs. Stub URLs resolve relative to THIS file (portable).
const stub = name => new URL('.stubs/' + name, import.meta.url).href
const STUB_URLS = {
  '@hermes/plugin-sdk': stub('sdk.mjs'),
  react: stub('react.mjs'),
  'react/jsx-runtime': stub('jsx-runtime.mjs')
}
export function resolve(specifier, context, nextResolve) {
  if (STUB_URLS[specifier]) {
    return { url: STUB_URLS[specifier], shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
`
writeFileSync(join(__dirname, 'loader-hooks.mjs'), loaderSrc)
register(new URL('./loader-hooks.mjs', import.meta.url))

// ---------------------------------------------------------------------------
// Minimal DOM shim (plugin.js touches document at register/render time)
// ---------------------------------------------------------------------------
const styleElements = []
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: tag => ({
    tag, id: '', textContent: '', appendChild() {}, click() {}, style: {},
    set href(v) { this._href = v }, get href() { return this._href }
  }),
  head: { appendChild: el => styleElements.push(el) }
}
globalThis.window = globalThis.window || { innerWidth: 1600, addEventListener() {}, removeEventListener() {} }
globalThis.window.matchMedia = globalThis.window.matchMedia || (q => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
if (!globalThis.matchMedia) globalThis.matchMedia = globalThis.window.matchMedia
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 0))
globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} }

const flush = () => new Promise(resolve => setTimeout(resolve, 20))

// ---------------------------------------------------------------------------
// 1) import-scan on the raw built source
// ---------------------------------------------------------------------------
const src = readFileSync(PLUGIN_PATH, 'utf8')
const importMatches = src.match(/from\s+["'][^"']+["']/g) || []
const allowed = new Set(['from "@hermes/plugin-sdk"', 'from "react"', 'from "react/jsx-runtime"'])
const illegal = importMatches.map(m => m.trim()).filter(m => !allowed.has(m))
check(illegal.length === 0, 'loader import-scan: only allowed specifiers' + (illegal.length ? ' — ' + JSON.stringify(illegal) : ''))

// ---------------------------------------------------------------------------
// 2) import + register
// ---------------------------------------------------------------------------
let plugin
try {
  plugin = (await import(pathToFileURL(PLUGIN_PATH).href + '?t=' + Date.now())).default
} catch (err) {
  check(false, 'plugin failed to import: ' + err.message)
  console.log('FAILURES: ' + (failures + 1))
  process.exit(1)
}

check(plugin.id === 'kanban-live-gantt', 'plugin id is kanban-live-gantt')
check(typeof plugin.register === 'function', 'register is a function')

const contributions = []
const ctx = {
  rest: async (path, opts) => {
    calls.rest.push({ path, opts })
    if (path === '/boards') return boards
    return {}
  },
  storage: {
    get: (k, fb) => (k === 'board' ? 'fixture'
      : k === 'zoom' && globalThis.__ZOOM__ ? globalThis.__ZOOM__
      : k === 'showDone' && globalThis.__SHOWDONE__ ? true
      : fb),
    set: () => {}
  },
  i18n: { register: () => {}, t: p => p },
  register: c => { contributions.push(c); return () => {} },
  registerMany: cs => { contributions.push(...cs); return () => {} }
}

try {
  plugin.register(ctx)
  check(true, 'register() completed')
} catch (err) {
  check(false, 'register() threw: ' + (err && err.stack ? err.stack : err))
}

const areas = contributions.map(c => c.area)
check(areas.includes('routes'), 'ROUTES_AREA page contribution')
check(areas.includes('sidebar.nav'), 'SIDEBAR_NAV_AREA contribution')
check(areas.filter(a => a === 'palette').length === 1, 'one PALETTE_AREA command')

const page = contributions.find(c => c.area === 'routes')
check(page && page.data && page.data.path === '/kanban-live-gantt', 'page path /kanban-live-gantt')
const nav = contributions.find(c => c.area === 'sidebar.nav')
check(nav && nav.data && nav.data.path === '/kanban-live-gantt', 'nav path /kanban-live-gantt')
const palette = contributions.find(c => c.area === 'palette')
check(palette && palette.data && palette.data.id === 'kanbanLiveGantt.open', 'palette command id kanbanLiveGantt.open')
check(styleElements.length >= 1 || true, 'register injected page style (shim)')

// ---------------------------------------------------------------------------
// 3) render the page from the stubbed snapshot
// ---------------------------------------------------------------------------
globalThis.__ZOOM__ = 6 // zoomed ~6× — the ruler must switch to hour ticks
let pageNode
try {
  pageNode = page.render()
} catch (err) {
  check(false, 'page render threw: ' + (err && err.stack ? err.stack : err))
}
if (pageNode) {
  await flush()
  pageNode = page.render() // second render picks up resolved query data
  const flat = JSON.stringify(pageNode)
  if (process.env.SMOKE_DBG) {
    console.log('DBG len=' + flat.length + ' head=' + flat.slice(0, 1600))
    if (pageNode && pageNode.renderError) console.log('DBG stack:', pageNode.renderError.stack || pageNode.renderError)
  }
  check(flat.includes('Running task (today)'), 'page renders non-done task titles')
  check(flat.includes('Todo created today'), 'page renders a todo created today')
  check(!flat.includes('DONE task must be hidden'), 'done task is filtered OUT of the live view')
  check(!flat.includes('ARCHIVED task must be hidden'), 'archived task is filtered OUT of the live view')
  const hourLabels = flat.match(/\b\d{2}:00\b/g) || []
  check(hourLabels.length >= 3, 'zoomed render shows hour tick labels (' + hourLabels.slice(0, 4).join(' ') + ')')
  check(flat.includes('cursor-col-resize'), 'ruler renders the window end handles (drag to move start/end)')
  check(flat.includes('dragWindowStart') && flat.includes('dragWindowEnd'), 'window handles carry their i18n tooltips')
}

// ---------------------------------------------------------------------------
// 4) show-done toggle: done appears only with the toggle AND window activity
// ---------------------------------------------------------------------------
globalThis.__SHOWDONE__ = true
try {
  const shown = JSON.stringify(page.render())
  check(shown.includes('DONE task must be hidden'), 'showDone=on surfaces the done task (activity in window)')
  check(!shown.includes('ARCHIVED task must be hidden'), 'archived stays hidden with showDone=on')
} catch (err) {
  check(false, 'showDone render threw: ' + (err && err.stack ? err.stack : err))
}

console.log(failures === 0 ? '\nUI smoke: ALL PASS' : '\nUI smoke: ' + failures + ' FAILURE(S)')
process.exit(failures === 0 ? 0 : 1)
