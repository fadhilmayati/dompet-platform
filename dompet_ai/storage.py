"""Lightweight persistence layer for Dompet AI sessions."""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Sequence

from .orchestrator import Transaction


@dataclass
class AnalysisRecord:
    """Represents a stored analysis result for a single agent."""

    run_id: str
    agent_key: str
    content: str
    context: str
    run_at: datetime


class SessionStore:
    """SQLite-backed storage for transactions and agent outputs."""

    def __init__(self, db_path: str | Path = "dompet_ai.sqlite") -> None:
        self.db_path = Path(db_path)
        self._lock = threading.Lock()
        self._connection = sqlite3.connect(self.db_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._initialise()

    def _initialise(self) -> None:
        with self._connection:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount REAL NOT NULL,
                    source TEXT NOT NULL DEFAULT 'api',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(user_id, date, description, amount)
                )
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    agent_key TEXT NOT NULL,
                    content TEXT NOT NULL,
                    context TEXT NOT NULL,
                    run_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
                """
            )
            self._connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_transactions_user_date
                ON transactions (user_id, date DESC)
                """
            )
            self._connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_analyses_user_run
                ON analyses (user_id, run_at DESC)
                """
            )

    def add_transactions(
        self, user_id: str, transactions: Sequence[Transaction], source: str = "api"
    ) -> int:
        """Persist a batch of transactions for a user."""

        if not transactions:
            return 0

        rows = [
            (user_id, tx.date, tx.description, tx.amount, source)
            for tx in transactions
        ]

        with self._lock:
            cursor = self._connection.executemany(
                """
                INSERT OR IGNORE INTO transactions (
                    user_id, date, description, amount, source
                ) VALUES (?, ?, ?, ?, ?)
                """,
                rows,
            )
            self._connection.commit()
        return cursor.rowcount

    def fetch_recent_transactions(
        self, user_id: str, limit: int = 50
    ) -> List[Transaction]:
        """Return the most recent transactions for a user."""

        cursor = self._connection.execute(
            """
            SELECT date, description, amount
            FROM transactions
            WHERE user_id = ?
            ORDER BY date DESC, id DESC
            LIMIT ?
            """,
            (user_id, limit),
        )
        return [
            Transaction(
                date=row["date"], description=row["description"], amount=row["amount"]
            )
            for row in cursor.fetchall()
        ]

    def record_analysis(
        self, user_id: str, run_id: str, agent_key: str, content: str, context: str
    ) -> None:
        """Persist an analysis output for later retrieval."""

        with self._lock:
            self._connection.execute(
                """
                INSERT INTO analyses (user_id, run_id, agent_key, content, context)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, run_id, agent_key, content, context),
            )
            self._connection.commit()

    def latest_analysis(self, user_id: str) -> List[AnalysisRecord]:
        """Return the most recent analysis run for the user."""

        cursor = self._connection.execute(
            """
            SELECT run_id, run_at
            FROM analyses
            WHERE user_id = ?
            ORDER BY run_at DESC
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return []

        run_id = row["run_id"]
        cursor = self._connection.execute(
            """
            SELECT run_id, agent_key, content, context, run_at
            FROM analyses
            WHERE user_id = ? AND run_id = ?
            ORDER BY agent_key ASC
            """,
            (user_id, run_id),
        )
        records: List[AnalysisRecord] = []
        for record in cursor.fetchall():
            records.append(
                AnalysisRecord(
                    run_id=record["run_id"],
                    agent_key=record["agent_key"],
                    content=record["content"],
                    context=record["context"],
                    run_at=datetime.fromisoformat(record["run_at"]),
                )
            )
        return records

    def analysis_history(self, user_id: str, limit: int = 5) -> List[List[AnalysisRecord]]:
        """Return a limited number of past analysis runs grouped by run ID."""

        cursor = self._connection.execute(
            """
            SELECT run_id, MIN(run_at) as first_seen
            FROM analyses
            WHERE user_id = ?
            GROUP BY run_id
            ORDER BY first_seen DESC
            LIMIT ?
            """,
            (user_id, limit),
        )

        runs: List[List[AnalysisRecord]] = []
        for row in cursor.fetchall():
            run_id = row["run_id"]
            per_run = self._connection.execute(
                """
                SELECT agent_key, content, context, run_at
                FROM analyses
                WHERE user_id = ? AND run_id = ?
                ORDER BY agent_key ASC
                """,
                (user_id, run_id),
            )
            run_records = [
                AnalysisRecord(
                    run_id=run_id,
                    agent_key=record["agent_key"],
                    content=record["content"],
                    context=record["context"],
                    run_at=datetime.fromisoformat(record["run_at"]),
                )
                for record in per_run.fetchall()
            ]
            runs.append(run_records)
        return runs

    def close(self) -> None:
        self._connection.close()


__all__ = ["SessionStore", "AnalysisRecord"]
