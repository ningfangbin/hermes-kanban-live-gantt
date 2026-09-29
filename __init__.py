"""Hermes Kanban Live Gantt — unified plugin package.

A day-scale Gantt timeline (today → +N days, non-done tasks only) for the
Hermes kanban boards. Local fork of hermes-kanban-gantt: the Python half
lives in ``dashboard/`` (FastAPI router mounted at
``/api/plugins/kanban-live-gantt/``) and the desktop renderer half in
``desktop/plugin.js`` (runtime ESM loaded by Hermes Desktop). Neither half
registers core agent tools, hooks, or middleware — the backend only reads
the shared kanban SQLite store — so there is no ``register()`` entry point
to probe; the capability probe correctly finds nothing to declare.
"""


def register(ctx) -> None:
    """No-op registration for the capability probe.

    This package's real surfaces are the dashboard API router (dashboard/)
    and the desktop renderer (desktop/) — neither registers core agent
    tools/hooks/middleware.
    """
    return None
