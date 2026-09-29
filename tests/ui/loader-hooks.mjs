const STUB_URLS = {
  "@hermes/plugin-sdk": "file:///home/ningfangbin/.hermes/plugins/kanban-live-gantt/tests/ui/.stubs/sdk.mjs",
  "react": "file:///home/ningfangbin/.hermes/plugins/kanban-live-gantt/tests/ui/.stubs/react.mjs",
  "react/jsx-runtime": "file:///home/ningfangbin/.hermes/plugins/kanban-live-gantt/tests/ui/.stubs/jsx-runtime.mjs"
}
export function resolve(specifier, context, nextResolve) {
  if (STUB_URLS[specifier]) {
    return { url: STUB_URLS[specifier], shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
