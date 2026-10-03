"""The connection, transactions and migrations every table's store builds on.

Access is synchronous sqlite3 behind a lock. Every call is a handful of
rows, so it stays off the event loop for microseconds, and the lock keeps
the Discord and web sides from interleaving statements on one connection.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

# The database's name before the assistant became luwin.
LEGACY_NAME = "maester.db"
# SQLite keeps recent writes in `-wal` until they are copied into the database,
# and an index of them in `-shm`, both named after the database, so they move
# with it. The database itself moves last: a move cut short leaves it under its
# old name, and the next open finishes the job.
_MOVE_ORDER = ("-wal", "-shm", "")


def stamp(when: datetime) -> str:
    """How times are stored: UTC, milliseconds, a trailing Z, so text order is time order."""
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def now() -> str:
    return stamp(datetime.now(UTC))


def adopt_legacy(path: str | Path) -> None:
    """Rename a `maester.db` beside `path` to `path`, once, so its rows carry over.

    Nothing happens when `path` already holds a database or there is no old file
    beside it. A zero-byte `path` holds none yet (SQLite writes its header on
    first use; a stray `sqlite3.connect` leaves exactly that), so it is replaced.
    """
    new = Path(path)
    old = new.with_name(LEGACY_NAME)
    if (new.exists() and new.stat().st_size > 0) or not old.exists():
        return
    for suffix in _MOVE_ORDER:
        source = old.with_name(old.name + suffix)
        if source.exists():
            source.rename(new.with_name(new.name + suffix))


class Database:
    """One SQLite file, migrated on open; each table's store mixes this in."""

    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            adopt_legacy(self.path)
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._lock = threading.RLock()
        self._in_tx = False
        self.migrate()

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
