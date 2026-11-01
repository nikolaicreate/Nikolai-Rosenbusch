"""Kommandozeile: kollektiv ask | run | report | stats | search"""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path

from .agents import DemoAgent, build_agents
from .knowledge import KnowledgeBase
from .orchestrator import Collective
from .prompts import eval_list


def load_dotenv(path: str = ".env") -> None:
    p = Path(path)
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                if v.strip():
                    os.environ.setdefault(k.strip(), v.strip())


def write_report(kb: KnowledgeBase, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Wissensbasis des Forschungskollektivs", "",
             "Status: **konsens** = mehrheitlich gestützt + DOI geprüft · **plausibel** = gestützt, aber unbelegt · "
             "**umstritten** · **widerlegt**", ""]
    for q in kb.db.execute("SELECT * FROM questions WHERE status='done' ORDER BY id"):
        lines += [f"## Frage #{q['id']}: {q['text']}", ""]
        syn = kb.db.execute("SELECT * FROM syntheses WHERE question_id=? ORDER BY id DESC LIMIT 1", (q["id"],)).fetchone()
        if syn:
            lines += [f"**Synthese ({syn['moderator']}):**", "", syn["text"], ""]
            problems = eval_list(syn["open_problems"])
            if problems:
                lines += ["**Offene Probleme:**"] + [f"- {p}" for p in problems] + [""]
        lines.append("| # | Status | Evidenz | These | Autor | DOI (geprüft) |")
        lines.append("|---|---|---|---|---|---|")
        for c in kb.db.execute("SELECT * FROM claims WHERE question_id=? ORDER BY id", (q["id"],)):
            dois = ", ".join(f"[{d}](https://doi.org/{d})" for d in eval_list(c["verified_dois"])) or "–"
            text = c["text"].replace("|", "\\|").replace("\n", " ")
            lines.append(f"| {c['id']} | {c['status']} | {c['evidence_type']} | {text} | {c['author']} | {dois} |")
        lines.append("")
    out.write_text("\n".join(lines), encoding="utf-8")


def main(argv: list[str] | None = None) -> None:
    load_dotenv()
    ap = argparse.ArgumentParser(prog="kollektiv", description="Grok + Claude + ChatGPT als Forschungsgemeinschaft")
    ap.add_argument("--db", default="research.db", help="Pfad zur Wissensbasis (SQLite)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("ask", help="Forschungsfrage auf die Agenda setzen")
    a.add_argument("question")
    a.add_argument("--priority", type=float, default=1.0)

    r = sub.add_parser("run", help="Forschungszyklen ausführen")
    r.add_argument("--cycles", type=int, default=1, help="Anzahl Zyklen (Standard 1)")
    r.add_argument("--forever", action="store_true", help="Endlos, bis Agenda leer, Budget erreicht oder Strg+C")
    r.add_argument("--token-budget", type=int, help="Höchstens so viele Tokens in diesem Lauf (dringend empfohlen)")
    r.add_argument("--pause", type=float, default=5.0, help="Sekunden zwischen Zyklen")
    r.add_argument("--max-depth", type=int, default=4, help="Maximale Tiefe abgeleiteter Fragen")
    r.add_argument("--offline-doi", action="store_true", help="DOIs nicht online prüfen (alles gilt als unbelegt)")
    r.add_argument("--demo", action="store_true", help="Offline-Demo ohne API-Schlüssel")

    rep = sub.add_parser("report", help="Wissensbasis als Markdown exportieren")
    rep.add_argument("--out", default="knowledge/REPORT.md")

    w = sub.add_parser("web", help="Web-App starten")
    w.add_argument("--host", default="127.0.0.1", help="Standard nur lokal – jeder Start kostet API-Geld")
    w.add_argument("--port", type=int, default=8765)

    sub.add_parser("stats", help="Kennzahlen anzeigen")
    s = sub.add_parser("search", help="Thesen durchsuchen")
    s.add_argument("term")

    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    kb = KnowledgeBase(args.db)

    if args.cmd == "ask":
        qid = kb.add_question(args.question, args.priority)
        print(f"Frage #{qid} aufgenommen." if qid else "Diese Frage steht schon auf der Agenda.")
    elif args.cmd == "run":
        agents = [DemoAgent(n) for n in ("Claude", "ChatGPT", "Grok")] if args.demo else build_agents()
        print("Forschende:", ", ".join(a.name for a in agents) or "keine")
        if len(agents) < 2:
            raise SystemExit("Fehler: Mindestens zwei API-Schlüssel nötig "
                             "(ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY) – oder --demo verwenden.")
        coll = Collective(agents, kb, max_depth=args.max_depth, offline_doi=args.offline_doi or args.demo)
        before = kb.total_tokens()
        n = coll.run(None if args.forever else args.cycles, args.token_budget, args.pause)
        print(f"{n} Zyklus/Zyklen abgeschlossen. Tokens in diesem Lauf: {kb.total_tokens() - before}")
    elif args.cmd == "report":
        write_report(kb, Path(args.out))
        print(f"Bericht geschrieben: {args.out}")
    elif args.cmd == "web":
        from .web import serve
        if args.host not in ("127.0.0.1", "localhost", "::1"):
            print("WARNUNG: Server ist im Netzwerk erreichbar und hat keine Anmeldung – "
                  "jeder dort kann kostenpflichtige Läufe starten.")
        httpd = serve(args.db, args.host, args.port)
        print(f"Forschungskollektiv läuft auf http://{args.host}:{args.port}  (Strg+C beendet)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    elif args.cmd == "stats":
        print(json.dumps(kb.stats(), indent=2, ensure_ascii=False))
    elif args.cmd == "search":
        for c in kb.search(args.term):
            print(f"#{c['id']} [{c['status']}/{c['evidence_type']}] {c['author']}: {c['text']}")

    # WAL-Inhalt in die Hauptdatei schreiben, damit research.db allein vollständig ist (wichtig für Git).
    kb.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    kb.db.close()


if __name__ == "__main__":
    main()
