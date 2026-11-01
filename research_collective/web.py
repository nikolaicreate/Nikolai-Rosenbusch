"""Web-App: Steuerung und Live-Beobachtung des Forschungskollektivs (nur Python-Standardbibliothek).

Die API-Schlüssel bleiben auf dem Server. Standardmäßig lauscht der Server nur auf 127.0.0.1,
weil jeder Klick auf "Start" echte API-Kosten auslösen kann.
"""
from __future__ import annotations

import json
import logging
import threading
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .agents import DemoAgent, build_agents
from .knowledge import KnowledgeBase
from .orchestrator import Collective
from .prompts import eval_list

log = logging.getLogger("research_collective")


class LogBuffer(logging.Handler):
    def __init__(self, size: int = 300):
        super().__init__()
        self.lines: deque[dict] = deque(maxlen=size)
        self.seq = 0
        self.setFormatter(logging.Formatter("%(asctime)s %(message)s", "%H:%M:%S"))

    def emit(self, record: logging.LogRecord) -> None:
        self.seq += 1
        self.lines.append({"id": self.seq, "level": record.levelname, "text": self.format(record)})


class Runner:
    """Führt das Kollektiv in einem Hintergrund-Thread aus; höchstens ein Lauf gleichzeitig."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.thread: threading.Thread | None = None
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.info: dict = {"running": False}

    def start(self, cycles: int | None, token_budget: int | None, demo: bool, max_depth: int,
              pause: float) -> str | None:
        with self.lock:
            if self.thread and self.thread.is_alive():
                return "Es läuft bereits ein Forschungslauf."
            agents = [DemoAgent(n) for n in ("Claude", "ChatGPT", "Grok")] if demo else build_agents()
            if len(agents) < 2:
                return "Mindestens zwei API-Schlüssel nötig (ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY) – oder Demo-Modus aktivieren."
            self.stop_event = threading.Event()
            self.info = {"running": True, "demo": demo, "agents": [a.name for a in agents],
                         "cycles": cycles, "token_budget": token_budget, "completed": 0}
            self.thread = threading.Thread(
                target=self._run, args=(agents, cycles, token_budget, demo, max_depth, pause), daemon=True)
            self.thread.start()
            return None

    def _run(self, agents, cycles, token_budget, demo, max_depth, pause) -> None:
        kb = KnowledgeBase(self.db_path)  # eigene Verbindung für den Runner-Thread
        try:
            coll = Collective(agents, kb, max_depth=max_depth, offline_doi=demo)
            self.info["completed"] = coll.run(cycles, token_budget, pause, self.stop_event)
            log.info("Lauf beendet: %d Zyklus/Zyklen.", self.info["completed"])
        except Exception as exc:  # Fehler sichtbar machen statt den Thread still sterben zu lassen
            log.exception("Lauf abgebrochen: %s", exc)
        finally:
            self.info["running"] = False
            kb.db.close()

    def stop(self) -> None:
        self.stop_event.set()


def configured_agents() -> list[str]:
    import os
    return [n for n, k in (("Claude", "ANTHROPIC_API_KEY"), ("ChatGPT", "OPENAI_API_KEY"), ("Grok", "XAI_API_KEY"))
            if os.getenv(k)]


def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


def write_report_text(kb: KnowledgeBase) -> str:
    from .cli import write_report
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "REPORT.md"
        write_report(kb, out)
        return out.read_text(encoding="utf-8")


def make_handler(db_path: str, runner: Runner, logbuf: LogBuffer):
    index_html = resources.files("research_collective").joinpath("static/index.html").read_bytes()

    class Handler(BaseHTTPRequestHandler):
        server_version = "ResearchCollective/0.1"

        def log_message(self, fmt, *args):  # HTTP-Zugriffe nicht ins Forschungsprotokoll mischen
            pass

        # ---------- Antworten ----------
        def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, data, status: int = 200) -> None:
            self._send(status, json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8")

        def _error(self, msg: str, status: int = 400) -> None:
            self._json({"error": msg}, status)

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 100_000:
                raise ValueError("Anfrage zu groß")
            data = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(data, dict):
                raise ValueError("JSON-Objekt erwartet")
            return data

        # ---------- GET ----------
        def do_GET(self) -> None:
            url = urlparse(self.path)
            qs = parse_qs(url.query)
            if url.path in ("/", "/index.html"):
                return self._send(200, index_html, "text/html; charset=utf-8")
            kb = KnowledgeBase(db_path)
            try:
                if url.path == "/api/state":
                    since = int(qs.get("log_since", ["0"])[0])
                    return self._json({
                        "runner": runner.info, "configured_agents": configured_agents(),
                        "stats": kb.stats(), "total_tokens": kb.total_tokens(),
                        "log": [l for l in logbuf.lines if l["id"] > since]})
                if url.path == "/api/questions":
                    return self._json(rows(kb.db.execute(
                        "SELECT q.*, (SELECT COUNT(*) FROM claims c WHERE c.question_id=q.id) AS n_claims "
                        "FROM questions q ORDER BY CASE status WHEN 'open' THEN 1 WHEN 'done' THEN 0 ELSE 2 END, "
                        "CASE WHEN status='open' THEN -priority ELSE -id END")))
                if url.path == "/api/question":
                    qid = int(qs.get("id", ["0"])[0])
                    q = kb.db.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
                    if not q:
                        return self._error("Frage nicht gefunden", 404)
                    claims = rows(kb.db.execute("SELECT * FROM claims WHERE question_id=? ORDER BY id", (qid,)))
                    for c in claims:
                        c["dois"], c["verified_dois"] = eval_list(c["dois"]), eval_list(c["verified_dois"])
                        c["reviews"] = rows(kb.db.execute("SELECT * FROM reviews WHERE claim_id=? ORDER BY id", (c["id"],)))
                    syn = [dict(s, open_problems=eval_list(s["open_problems"])) for s in rows(kb.db.execute(
                        "SELECT * FROM syntheses WHERE question_id=? ORDER BY id DESC", (qid,)))]
                    children = rows(kb.db.execute("SELECT id, text, status FROM questions WHERE parent_id=?", (qid,)))
                    parent = kb.db.execute("SELECT id, text FROM questions WHERE id=?", (q["parent_id"],)).fetchone() if q["parent_id"] else None
                    return self._json({"question": dict(q), "claims": claims, "syntheses": syn,
                                       "children": children, "parent": dict(parent) if parent else None})
                if url.path == "/api/search":
                    term = qs.get("q", [""])[0]
                    return self._json(rows(kb.db.execute(
                        "SELECT c.*, q.text AS question FROM claims c JOIN questions q ON q.id=c.question_id "
                        "WHERE lower(c.text) LIKE ? ORDER BY c.id DESC LIMIT 50", (f"%{term.lower()}%",))))
                if url.path == "/api/report.md":
                    return self._send(200, write_report_text(kb).encode(), "text/markdown; charset=utf-8",
                                      {"Content-Disposition": 'attachment; filename="REPORT.md"'})
                return self._error("Nicht gefunden", 404)
            except ValueError as exc:
                return self._error(str(exc))
            finally:
                kb.db.close()

        # ---------- POST ----------
        def do_POST(self) -> None:
            # Schutz gegen Cross-Site-Anfragen fremder Webseiten an den lokalen Server
            if self.headers.get("X-Requested-With") != "rc":
                return self._error("Fehlender Header", 403)
            try:
                body = self._body()
            except (ValueError, json.JSONDecodeError) as exc:
                return self._error(f"Ungültige Anfrage: {exc}")
            path = urlparse(self.path).path
            if path == "/api/ask":
                text = str(body.get("question", "")).strip()
                if not 5 <= len(text) <= 2000:
                    return self._error("Frage muss 5–2000 Zeichen lang sein.")
                kb = KnowledgeBase(db_path)
                try:
                    qid = kb.add_question(text, float(body.get("priority", 1.0)))
                finally:
                    kb.db.close()
                return self._json({"id": qid, "duplicate": qid is None})
            if path == "/api/run":
                try:
                    cycles = None if body.get("forever") else max(1, int(body.get("cycles", 1)))
                    budget = int(body["token_budget"]) if body.get("token_budget") else None
                    depth = max(0, min(10, int(body.get("max_depth", 4))))
                    pause = max(0.0, float(body.get("pause", 2.0)))
                except (TypeError, ValueError):
                    return self._error("Ungültige Laufparameter.")
                demo = bool(body.get("demo"))
                if cycles is None and budget is None and not demo:
                    return self._error("Dauerbetrieb nur mit Token-Budget – sonst laufen die Kosten unbegrenzt.")
                err = runner.start(cycles, budget, demo, depth, pause)
                return self._error(err, 409) if err else self._json({"ok": True})
            if path == "/api/stop":
                runner.stop()
                return self._json({"ok": True})
            return self._error("Nicht gefunden", 404)

    return Handler


def serve(db_path: str = "research.db", host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    logbuf = LogBuffer()
    logging.getLogger("research_collective").addHandler(logbuf)
    logging.getLogger("research_collective").setLevel(logging.INFO)
    KnowledgeBase(db_path).db.close()  # Schema anlegen
    httpd = ThreadingHTTPServer((host, port), make_handler(db_path, Runner(db_path), logbuf))
    return httpd
