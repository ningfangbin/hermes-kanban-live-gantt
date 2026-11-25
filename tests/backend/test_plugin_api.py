"""Backend tests for dashboard/plugin_api.py — the read paths the Gantt pages use.

Stdlib ``unittest`` only (no pytest needed), but it needs FastAPI: run it with a
Python that can import fastapi (the Hermes venv on this machine):

    ~/01_Source/12_hermes-agent/venv/bin/python -m unittest discover -s tests/backend -v

What is pinned here (the 2026-11-25 "Gantt shows nothing" postmortem):

* an unreadable board in the aggregate (board=all) is REPORTED, never silently
  dropped — a silently dropped board renders as an empty timeline, which is
  indistinguishable from a board that holds no open work;
* /boards keeps listing a broken board with ``error`` plus archive state and
  open-task counts, so the switcher can explain itself;
* the snapshot cache serves repeats, never hides a write, and ``refresh=1``
  bypasses it.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

PLUGIN_DIR = Path(__file__).resolve().parents[2]  # <plugin>/tests/backend -> <plugin>
PLUGIN_API = PLUGIN_DIR / "dashboard" / "plugin_api.py"

SCHEMA = """
CREATE TABLE tasks (
    id TEXT PRIMARY KEY, title TEXT, body TEXT, status TEXT, assignee TEXT,
    priority INTEGER, created_at INTEGER, started_at INTEGER, completed_at INTEGER,
    result TEXT, block_kind TEXT, current_run_id TEXT,
    workflow_template_id TEXT, current_step_key TEXT
);
CREATE TABLE task_links (parent_id TEXT, child_id TEXT);
CREATE TABLE task_runs (
    id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, step_key TEXT, status TEXT,
    outcome TEXT, started_at INTEGER, ended_at INTEGER, error TEXT, summary TEXT
);
"""


def load_plugin_api() -> Any:
    assert PLUGIN_API.is_file(), f"missing {PLUGIN_API}"
    spec = importlib.util.spec_from_file_location("kanban_live_gantt_api", PLUGIN_API)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def make_board(root: Path, slug: str, tasks: list, *, archived: bool = False) -> Path:
    board_dir = root / slug
    board_dir.mkdir(parents=True)
    (board_dir / "board.json").write_text(
        json.dumps({"slug": slug, "name": f"{slug} board", "archived": archived}),
        encoding="utf-8",
    )
    _fill_db(board_dir / "kanban.db", tasks)
    return board_dir


def make_default_board(home: Path, tasks: list) -> Path:
    """The back-compat default board: its DB sits at <home>/kanban.db."""
    db = home / "kanban.db"
    _fill_db(db, tasks)
    return db


def _fill_db(db: Path, tasks: list) -> None:
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA)
    for task in tasks:
        conn.execute(
            "INSERT INTO tasks (id, title, status, assignee, priority, created_at, started_at, completed_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (task["id"], task.get("title", task["id"]), task["status"], task.get("assignee"),
             task.get("priority", 0), task.get("created_at", 1000),
             task.get("started_at"), task.get("completed_at")),
        )
        for run in task.get("runs", []):
            conn.execute(
                "INSERT INTO task_runs (task_id, profile, status, outcome, started_at, ended_at)"
                " VALUES (?,?,?,?,?,?)",
                (task["id"], "worker", "ok", run.get("outcome", "completed"),
                 run.get("started_at"), run.get("ended_at")),
            )
    conn.commit()
    conn.close()


class ApiTest(unittest.TestCase):
    """Throwaway boards + the standalone-server path resolution."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        root = Path(self._tmp.name) / "home" / "kanban" / "boards"
        root.mkdir(parents=True)
        make_board(root, "alpha", [
            {"id": "t_a1", "status": "running", "created_at": 1000, "runs": [{"started_at": 1100}]},
            {"id": "t_a2", "status": "done", "created_at": 900, "completed_at": 1200},
            {"id": "t_a3", "status": "archived", "created_at": 800, "completed_at": 850},
        ])
        make_board(root, "beta", [
            {"id": "t_b1", "status": "todo", "created_at": 700},
        ], archived=True)

        env = mock.patch.dict(os.environ, {
            "KANBAN_GANTT_BOARDS": str(root),
            "KANBAN_GANTT_CACHE_SECONDS": "5",
        })
        env.start()
        self.addCleanup(env.stop)

        self.api = load_plugin_api()
        # No hermes domain layer here: board paths resolve under the boards root.
        def no_domain_layer():
            raise ImportError("standalone: hermes_cli not importable")

        patcher = mock.patch.object(self.api, "_kb", no_domain_layer)
        patcher.start()
        self.addCleanup(patcher.stop)

        resolver = mock.patch.object(self.api, "_resolve_board", lambda slug=None: slug or "alpha")
        resolver.start()
        self.addCleanup(resolver.stop)

        self.api._cache_clear()
        self.addCleanup(self.api._cache_clear)

    def patch_connect_failure(self, failing: str, message: str = "database is locked") -> None:
        real_connect = self.api._connect

        def flaky(slug, *, ro):
            if slug == failing:
                raise sqlite3.OperationalError(message)
            return real_connect(slug, ro=ro)

        patcher = mock.patch.object(self.api, "_connect", flaky)
        patcher.start()
        self.addCleanup(patcher.stop)


class BoardsRouteTests(ApiTest):
    def test_counts_archive_state_and_errors(self) -> None:
        boards = {b["slug"]: b for b in self.api.list_boards()["boards"]}

        self.assertEqual(boards["alpha"]["tasks"], 3)
        self.assertEqual(boards["alpha"]["active"], 1)          # running only
        self.assertFalse(boards["alpha"]["archived"])
        self.assertTrue(boards["beta"]["archived"])
        self.assertEqual(boards["beta"]["active"], 1)

        self.patch_connect_failure("beta")
        broken = {b["slug"]: b for b in self.api.list_boards()["boards"]}
        self.assertIn("beta", broken, "an unreadable board must not vanish from the switcher")
        self.assertIn("database is locked", broken["beta"]["error"])
        self.assertEqual(broken["alpha"]["active"], 1)

    def test_default_board_is_listed_and_aggregated(self) -> None:
        """The back-compat `default` board (<home>/kanban.db) is the board the
        CLI calls "current" — it used to be invisible in every Gantt view."""
        root = Path(os.environ["KANBAN_GANTT_BOARDS"])     # <home>/kanban/boards
        make_default_board(root.parent.parent, [           # <home>/kanban.db
            {"id": "t_d1", "status": "todo", "created_at": 500},
        ])

        boards = {b["slug"]: b for b in self.api.list_boards()["boards"]}
        self.assertIn("default", boards)
        self.assertEqual(boards["default"]["active"], 1)
        self.assertNotIn("error", boards["default"])

        payload = self.api._read_gantt("all")
        self.assertIn("t_d1", [t["id"] for t in payload["tasks"]])
        self.assertEqual({b["slug"] for b in payload["boards"]},
                         {"default", "alpha", "beta"})
        self.assertEqual(payload["errors"], [])



class AggregateTests(ApiTest):
    def test_unreadable_board_is_reported_not_dropped(self) -> None:
        self.patch_connect_failure("alpha")   # the only board with open work
        payload = self.api._read_gantt("all")

        self.assertTrue(payload["errors"], "an unreadable board must be reported")
        self.assertEqual(payload["errors"][0]["board"], "alpha")
        self.assertIn("database is locked", payload["errors"][0]["error"])

        stats = {b["slug"]: b for b in payload["boards"]}
        self.assertFalse(stats["alpha"]["ok"])
        self.assertTrue(stats["beta"]["ok"])

        # readable boards are still served
        self.assertEqual([t["id"] for t in payload["tasks"]], ["t_b1"])
        # counts stay explicit so "everything failed" is legible instead of blank
        self.assertEqual(payload["counts"], {"tasks": 1, "active": 1})

    def test_clean_run_has_no_errors(self) -> None:
        payload = self.api._read_gantt("all")
        self.assertEqual(payload["errors"], [])
        self.assertEqual(payload["counts"], {"tasks": 4, "active": 2})
        self.assertEqual({b["slug"]: b["active"] for b in payload["boards"]},
                         {"alpha": 1, "beta": 1})

    def test_single_board_payload_carries_counts_and_empty_errors(self) -> None:
        payload = self.api._read_gantt("alpha")
        self.assertEqual(payload["errors"], [])
        self.assertEqual(payload["counts"], {"tasks": 3, "active": 1})
        self.assertEqual(payload["boards"],
                         [{"slug": "alpha", "ok": True, "tasks": 3, "active": 1}])
        runs = {t["id"]: t["runs"] for t in payload["tasks"]}
        self.assertTrue(runs["t_a1"])
        self.assertEqual(runs["t_a1"][0]["started_at"], 1100)


class CacheTests(ApiTest):
    def test_serves_snapshot_until_ttl_then_refreshes(self) -> None:
        calls: list[str] = []
        real_read = self.api._read_gantt

        def counting(slug):
            calls.append(slug)
            return real_read(slug)

        with mock.patch.object(self.api, "_read_gantt", counting):
            first = self.api.get_gantt("alpha", False)
            second = self.api.get_gantt("alpha", False)
            self.assertEqual(len(calls), 1,
                             "a repeat read inside the TTL must not re-read the board")
            self.assertEqual(second["generated_at"], first["generated_at"])

            self.api.get_gantt("alpha", True)          # refresh=1 bypasses
            self.assertEqual(len(calls), 2)

            with mock.patch.dict(os.environ, {"KANBAN_GANTT_CACHE_SECONDS": "0"}):
                self.api.get_gantt("alpha", False)
                self.api.get_gantt("alpha", False)
            self.assertEqual(len(calls), 4, "TTL 0 disables the cache entirely")

    def test_cache_clear_drops_snapshots(self) -> None:
        self.api._cache_put("alpha", {"stale": True})
        self.assertEqual(self.api._cache_get("alpha"), {"stale": True})
        self.api._cache_clear()
        self.assertIsNone(self.api._cache_get("alpha"))


class HttpTests(ApiTest):
    def test_routes_report_errors_and_keep_serving(self) -> None:
        from fastapi.testclient import TestClient

        self.patch_connect_failure("alpha", "disk I/O error")
        client = TestClient(self.api.create_app(allow_cors=False))

        boards = client.get("/boards")
        self.assertEqual(boards.status_code, 200)
        self.assertEqual({b["slug"] for b in boards.json()["boards"]}, {"alpha", "beta"})

        gantt = client.get("/gantt?board=all")
        self.assertEqual(gantt.status_code, 200)
        body = gantt.json()
        self.assertEqual(body["errors"][0]["board"], "alpha")
        self.assertIn("disk I/O error", body["errors"][0]["error"])

        healthy = client.get("/gantt?board=beta&refresh=1")
        self.assertEqual(healthy.status_code, 200)
        self.assertEqual(healthy.json()["errors"], [])


if __name__ == "__main__":
    unittest.main()
