"""Persistente Wissensbasis (SQLite): Fragen, Thesen, Reviews, Synthesen, Verbrauch."""
from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY, text TEXT NOT NULL, parent_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open',          -- open | done | skipped
    priority REAL NOT NULL DEFAULT 0.5, depth INTEGER NOT NULL DEFAULT 0,
    source TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL, text TEXT NOT NULL,
    evidence_type TEXT NOT NULL,                  -- belegt | interpretiert | spekuliert | zu_pruefen
    dois TEXT NOT NULL DEFAULT '[]', verified_dois TEXT NOT NULL DEFAULT '[]',
    confidence REAL, author TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed',      -- proposed | konsens | plausibel | umstritten | widerlegt
    created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY, claim_id INTEGER NOT NULL, reviewer TEXT NOT NULL,
    verdict TEXT NOT NULL, critique TEXT, confidence REAL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS syntheses (
    id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL, moderator TEXT NOT NULL,
    text TEXT NOT NULL, open_problems TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY, agent TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
    created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS doi_cache (doi TEXT PRIMARY KEY, exists_ INTEGER NOT NULL, checked_at TEXT);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


@dataclass
class Question:
    id: int
    text: str
    depth: int
    priority: float


class KnowledgeBase:
    def __init__(self, path: str = "research.db"):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        try:
            self.db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts USING fts5(text, content='claims', content_rowid='id')")
            self.fts = True
        except sqlite3.OperationalError:
            self.fts = False
        self.db.commit()

    # ---------- Fragen ----------
    def add_question(self, text: str, priority: float = 0.5, parent_id: int | None = None,
                     depth: int = 0, source: str = "user") -> int | None:
        """Fügt eine Frage hinzu, außer es gibt sie (normalisiert) schon."""
        key = normalize(text)
        for row in self.db.execute("SELECT text FROM questions"):
            if normalize(row["text"]) == key:
                return None
        cur = self.db.execute(
            "INSERT INTO questions(text, parent_id, priority, depth, source, created_at) VALUES (?,?,?,?,?,?)",
            (text.strip(), parent_id, max(0.0, min(1.0, priority)), depth, source, now()))
        self.db.commit()
        return cur.lastrowid

    def next_question(self, max_depth: int) -> Question | None:
        row = self.db.execute(
            "SELECT * FROM questions WHERE status='open' AND depth<=? "
            "ORDER BY priority DESC, depth ASC, id ASC LIMIT 1", (max_depth,)).fetchone()
        return Question(row["id"], row["text"], row["depth"], row["priority"]) if row else None

    def close_question(self, qid: int, status: str = "done") -> None:
        self.db.execute("UPDATE questions SET status=? WHERE id=?", (status, qid))
        self.db.commit()

    # ---------- Thesen ----------
    def add_claim(self, question_id: int, text: str, evidence_type: str, dois: list[str],
                  verified: list[str], confidence: float | None, author: str) -> int:
        cur = self.db.execute(
            "INSERT INTO claims(question_id, text, evidence_type, dois, verified_dois, confidence, author, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (question_id, text, evidence_type, json.dumps(dois), json.dumps(verified), confidence, author, now()))
        if self.fts:
            self.db.execute("INSERT INTO claims_fts(rowid, text) VALUES (?,?)", (cur.lastrowid, text))
        self.db.commit()
        return cur.lastrowid

    def set_claim_status(self, claim_id: int, status: str) -> None:
        self.db.execute("UPDATE claims SET status=? WHERE id=?", (status, claim_id))
        self.db.commit()

    def related_claims(self, query: str, limit: int = 15) -> list[sqlite3.Row]:
        """Bisheriges Wissen zur Frage – damit das Kollektiv auf früheren Runden aufbaut."""
        words = [w for w in normalize(query).split() if len(w) > 3][:12]
        if not words:
            return []
        if self.fts:
            q = " OR ".join(f'"{w}"' for w in words)
            return self.db.execute(
                "SELECT c.* FROM claims_fts f JOIN claims c ON c.id=f.rowid WHERE claims_fts MATCH ? "
                "AND c.status!='widerlegt' ORDER BY rank LIMIT ?", (q, limit)).fetchall()
        like = " OR ".join("lower(text) LIKE ?" for _ in words)
        return self.db.execute(
            f"SELECT * FROM claims WHERE ({like}) AND status!='widerlegt' ORDER BY id DESC LIMIT ?",
            [f"%{w}%" for w in words] + [limit]).fetchall()

    def search(self, query: str, limit: int = 30) -> list[sqlite3.Row]:
        return self.db.execute(
            "SELECT * FROM claims WHERE lower(text) LIKE ? ORDER BY id DESC LIMIT ?",
            (f"%{query.lower()}%", limit)).fetchall()

    # ---------- Reviews, Synthesen, Verbrauch ----------
    def add_review(self, claim_id: int, reviewer: str, verdict: str, critique: str,
                   confidence: float | None) -> None:
        self.db.execute(
            "INSERT INTO reviews(claim_id, reviewer, verdict, critique, confidence, created_at) VALUES (?,?,?,?,?,?)",
            (claim_id, reviewer, verdict, critique, confidence, now()))
        self.db.commit()

    def reviews_for(self, claim_id: int) -> list[sqlite3.Row]:
        return self.db.execute("SELECT * FROM reviews WHERE claim_id=?", (claim_id,)).fetchall()

    def add_synthesis(self, question_id: int, moderator: str, text: str, open_problems: list[str]) -> None:
        self.db.execute(
            "INSERT INTO syntheses(question_id, moderator, text, open_problems, created_at) VALUES (?,?,?,?,?)",
            (question_id, moderator, text, json.dumps(open_problems, ensure_ascii=False), now()))
        self.db.commit()

    def log_usage(self, agent: str, input_tokens: int, output_tokens: int) -> None:
        self.db.execute("INSERT INTO usage(agent, input_tokens, output_tokens, created_at) VALUES (?,?,?,?)",
                        (agent, input_tokens, output_tokens, now()))
        self.db.commit()

    def total_tokens(self) -> int:
        row = self.db.execute("SELECT COALESCE(SUM(input_tokens+output_tokens),0) AS t FROM usage").fetchone()
        return int(row["t"])

    def doi_cached(self, doi: str) -> bool | None:
        row = self.db.execute("SELECT exists_ FROM doi_cache WHERE doi=?", (doi,)).fetchone()
        return None if row is None else bool(row["exists_"])

    def cache_doi(self, doi: str, exists: bool) -> None:
        self.db.execute("INSERT OR REPLACE INTO doi_cache(doi, exists_, checked_at) VALUES (?,?,?)",
                        (doi, int(exists), now()))
        self.db.commit()

    def stats(self) -> dict:
        q = lambda sql: self.db.execute(sql).fetchall()
        return {
            "fragen": {r[0]: r[1] for r in q("SELECT status, COUNT(*) FROM questions GROUP BY status")},
            "thesen": {r[0]: r[1] for r in q("SELECT status, COUNT(*) FROM claims GROUP BY status")},
            "evidenz": {r[0]: r[1] for r in q("SELECT evidence_type, COUNT(*) FROM claims GROUP BY evidence_type")},
            "reviews": q("SELECT COUNT(*) FROM reviews")[0][0],
            "tokens_pro_agent": {r[0]: r[1] for r in q(
                "SELECT agent, SUM(input_tokens+output_tokens) FROM usage GROUP BY agent")},
        }
