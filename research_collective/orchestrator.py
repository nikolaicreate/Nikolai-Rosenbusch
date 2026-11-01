"""Forschungszyklus: Vorschlag → Peer-Review über Kreuz → DOI-Prüfung → Synthese → neue Fragen."""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from . import prompts
from .agents import Agent, AgentError, parse_json
from .doi import verify_all
from .knowledge import KnowledgeBase, Question

log = logging.getLogger("research_collective")

VERDICTS = {"support", "challenge", "refute"}
EVIDENCE = {"belegt", "interpretiert", "spekuliert"}


def _conf(x) -> float | None:
    try:
        return max(0.0, min(1.0, float(x)))
    except (TypeError, ValueError):
        return None


def decide_status(evidence_type: str, verified: list[str], verdicts: list[str]) -> str:
    """Konsens nur mit geprüfter DOI – Zustimmung allein macht aus einer These kein Wissen."""
    n = len(verdicts)
    if n == 0:
        return "proposed"
    support, refute = verdicts.count("support"), verdicts.count("refute")
    if refute * 2 > n:
        return "widerlegt"
    if support * 2 > n and refute == 0:
        return "konsens" if evidence_type == "belegt" and verified else "plausibel"
    return "umstritten"


class Collective:
    def __init__(self, agents: list[Agent], kb: KnowledgeBase, max_depth: int = 4,
                 offline_doi: bool = False):
        if len(agents) < 2:
            raise ValueError("Mindestens zwei Agenten nötig – sonst gibt es kein Peer-Review.")
        self.agents, self.kb = agents, kb
        self.max_depth, self.offline_doi = max_depth, offline_doi
        self.cycle = 0

    # ---------- Hilfen ----------
    def _call(self, agent: Agent, task: str, user: str):
        """Läuft im Worker-Thread: nur API-Aufruf, kein Datenbankzugriff."""
        others = [a.name for a in self.agents if a is not agent]
        try:
            text, usage = agent.complete(prompts.system_prompt(agent.name, others, task), user)
        except AgentError as exc:
            return None, None, exc
        try:
            return parse_json(text), usage, None
        except AgentError as exc:
            return None, usage, exc

    def _record(self, agent: Agent, result) -> dict | None:
        out, usage, err = result
        if usage:
            self.kb.log_usage(agent.name, usage.input_tokens, usage.output_tokens)
        if err:
            log.warning("%s fällt diese Runde aus: %s", agent.name, err)
        return out

    def _ask(self, agent: Agent, task: str, user: str) -> dict | None:
        return self._record(agent, self._call(agent, task, user))

    def _parallel(self, jobs):
        if not jobs:
            return []
        with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            results = list(pool.map(lambda j: self._call(*j), jobs))
        return [(j[0], self._record(j[0], r)) for j, r in zip(jobs, results)]

    # ---------- Phasen ----------
    def propose(self, q: Question) -> list[int]:
        context = prompts.format_claims(self.kb.related_claims(q.text))
        user = f"Forschungsfrage (#{q.id}): {q.text}\n\nBisheriges Wissen des Kollektivs:\n{context}"
        claim_ids: list[int] = []
        for agent, out in self._parallel([(a, prompts.PROPOSE, user) for a in self.agents]):
            if not out:
                continue
            for c in out.get("claims", [])[:5]:
                text = str(c.get("text", "")).strip()
                if not text:
                    continue
                ev = c.get("evidence_type") if c.get("evidence_type") in EVIDENCE else "spekuliert"
                dois = [str(d) for d in c.get("dois", []) if d][:5]
                verified = verify_all(dois, self.kb, self.offline_doi)
                if ev == "belegt" and not verified:
                    ev = "zu_pruefen"  # behauptet belegt, DOI aber nicht auflösbar
                if len(verified) < len(dois):
                    log.warning("%s nannte %d nicht auflösbare DOI(s)", agent.name, len(dois) - len(verified))
                claim_ids.append(self.kb.add_claim(q.id, text, ev, dois, verified, _conf(c.get("confidence")), agent.name))
            for f in out.get("follow_up_questions", [])[:3]:
                self._enqueue(str(f), 0.3, q, agent.name)
        return claim_ids

    def review(self, q: Question, claim_ids: list[int]) -> None:
        rows = [self.kb.db.execute("SELECT * FROM claims WHERE id=?", (i,)).fetchone() for i in claim_ids]
        jobs = []
        for agent in self.agents:
            foreign = [r for r in rows if r["author"] != agent.name]
            if foreign:
                user = f"Forschungsfrage: {q.text}\n\nZu begutachtende Thesen:\n{prompts.format_claims(foreign)}"
                jobs.append((agent, prompts.REVIEW, user))
        allowed = {agent.name: {r["id"] for r in rows if r["author"] != agent.name} for agent in self.agents}
        for agent, out in self._parallel(jobs):
            for rv in (out or {}).get("reviews", []):
                try:
                    cid = int(rv.get("claim_id"))
                except (TypeError, ValueError):
                    continue
                if cid in allowed[agent.name] and rv.get("verdict") in VERDICTS:
                    self.kb.add_review(cid, agent.name, rv["verdict"], str(rv.get("critique", "")), _conf(rv.get("confidence")))
        for r in rows:
            verdicts = [v["verdict"] for v in self.kb.reviews_for(r["id"])]
            self.kb.set_claim_status(r["id"], decide_status(r["evidence_type"], prompts.eval_list(r["verified_dois"]), verdicts))

    def synthesize(self, q: Question, claim_ids: list[int]) -> None:
        moderator = self.agents[self.cycle % len(self.agents)]  # Moderation rotiert
        rows = [self.kb.db.execute("SELECT * FROM claims WHERE id=?", (i,)).fetchone() for i in claim_ids]
        reviews = {r["id"]: self.kb.reviews_for(r["id"]) for r in rows}
        user = f"Forschungsfrage: {q.text}\n\nThesen dieser Runde mit Reviews:\n{prompts.format_claims(rows, reviews)}"
        out = self._ask(moderator, prompts.SYNTHESIZE, user)
        if not out:
            return
        self.kb.add_synthesis(q.id, moderator.name, str(out.get("synthesis", "")),
                              [str(p) for p in out.get("open_problems", [])])
        for nq in out.get("next_questions", [])[:4]:
            if isinstance(nq, dict):
                self._enqueue(str(nq.get("text", "")), _conf(nq.get("priority")) or 0.5, q, moderator.name)

    def _enqueue(self, text: str, priority: float, parent: Question, source: str) -> None:
        if text.strip() and parent.depth + 1 <= self.max_depth:
            # Tiefere Fragen werden leicht abgewertet, damit die Agenda nicht ins Kleinteilige driftet.
            self.kb.add_question(text, priority * (0.9 ** (parent.depth + 1)), parent.id, parent.depth + 1, source)

    # ---------- Schleife ----------
    def run_cycle(self) -> bool:
        q = self.kb.next_question(self.max_depth)
        if q is None:
            return False
        self.cycle += 1
        log.info("Zyklus %d – Frage #%d (Tiefe %d): %s", self.cycle, q.id, q.depth, q.text)
        claim_ids = self.propose(q)
        if not claim_ids:
            log.warning("Keine Thesen erhalten – Frage wird zurückgestellt.")
            self.kb.close_question(q.id, "skipped")
            return True
        self.review(q, claim_ids)
        self.synthesize(q, claim_ids)
        self.kb.close_question(q.id)
        return True

    def run(self, max_cycles: int | None = None, token_budget: int | None = None, pause: float = 0.0,
            stop: threading.Event | None = None) -> int:
        stop = stop or threading.Event()
        done = 0
        start_tokens = self.kb.total_tokens()  # Budget gilt pro Lauf
        try:
            while (max_cycles is None or done < max_cycles) and not stop.is_set():
                if token_budget is not None and self.kb.total_tokens() - start_tokens >= token_budget:
                    log.info("Token-Budget dieses Laufs erreicht (%d) – Stopp.", token_budget)
                    break
                if not self.run_cycle():
                    log.info("Forschungsagenda leer – Stopp. Neue Fragen mit `kollektiv ask` hinzufügen.")
                    break
                done += 1
                if pause:
                    stop.wait(pause)
        except KeyboardInterrupt:
            log.info("Abgebrochen nach %d Zyklen – Wissen ist gespeichert.", done)
        return done
