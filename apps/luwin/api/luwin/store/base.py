"""The connection, transactions and migrations every table's store builds on.

Access is synchronous sqlite3 behind a lock. Every call is a handful of
rows, so it stays off the event loop for microseconds, and the lock keeps
the web app and the scheduled jobs from interleaving statements on one
connection.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

# Set by the initial migration ('luwn'). A database with migrations recorded
# but not this id was made before luwin's fresh start.
APPLICATION_ID = 0x6C75776E


class OldDatabase(RuntimeError):
    """A database from before luwin's fresh start, whose tables this code can't read."""


def stamp(when: datetime) -> str:
    """How times are stored: UTC, milliseconds, a trailing Z, so text order is time order."""
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def now() -> str:
    return stamp(datetime.now(UTC))


class Database:
    """One SQLite file, migrated on open; each table's store mixes this in."""

    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        self._in_tx = False
        try:
            self._refuse_old()
        except OldDatabase:
            self._conn.close()
            raise
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self.migrate()

    def _refuse_old(self) -> None:
        """Refuse a database whose migrations ran before luwin's fresh start."""
        has_versions = self._conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'"
        ).fetchone()
        if not has_versions or not self._conn.execute("SELECT 1 FROM schema_version").fetchone():
            return  # a new file
        if self._conn.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID:
            raise OldDatabase(
                f"{self.path} was made before luwin's fresh start, and luwin can't read it. "
                "Move it aside and luwin creates a new one (apps/luwin/docs/nas-deployment.md)."
            )

    def close(self) -> None:
        self._conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """One atomic unit. Store calls made inside it join it instead of committing alone."""
        with self._lock:
            outer = not self._in_tx
            if outer:
                self._conn.execute("BEGIN")
                self._in_tx = True
            try:
                yield self._conn
            except BaseException:
                if outer:
                    self._conn.execute("ROLLBACK")
                raise
            else:
                if outer:
                    self._conn.execute("COMMIT")
            finally:
                if outer:
                    self._in_tx = False

    def migrate(self) -> list[str]:
        """Apply every migration newer than the schema version; returns what ran."""
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)"
            )
            current = self._conn.execute(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version"
            ).fetchone()[0]
            applied = []
            for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                version = int(path.name.split("_", 1)[0])
                if version <= current:
                    continue
                # executescript commits any open transaction before it runs,
                # so the migration carries its own BEGIN/COMMIT: the schema
                # and the version row land together or not at all.
                self._conn.executescript(
                    "BEGIN;\n"
                    f"{path.read_text()}\n"
                    f"INSERT INTO schema_version (version) VALUES ({version});\n"
                    "COMMIT;"
                )
                applied.append(path.name)
            return applied
