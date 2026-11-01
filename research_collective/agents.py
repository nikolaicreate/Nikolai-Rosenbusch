"""Adapter für die drei Forscher-Modelle (Claude, ChatGPT, Grok) plus Demo-Agent."""
from __future__ import annotations

import json
import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass


class AgentError(RuntimeError):
    """Ein Agent konnte in dieser Runde nicht antworten (Netz, Limit, Ablehnung)."""


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0


class Agent(ABC):
    name: str

    @abstractmethod
    def complete(self, system: str, user: str) -> tuple[str, Usage]:
        """Liefert (Antworttext, Tokenverbrauch). Der Text soll JSON enthalten."""


class ClaudeAgent(Agent):
    def __init__(self, model: str | None = None, effort: str | None = None):
        import anthropic

        self.name = "Claude"
        self.model = model or os.getenv("CLAUDE_MODEL", "claude-opus-5-5")
        self.effort = effort or os.getenv("CLAUDE_EFFORT", "high")
        self.client = anthropic.Anthropic()

    def complete(self, system: str, user: str) -> tuple[str, Usage]:
        import anthropic

        try:
            resp = self.client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                system=system,
                messages=[{"role": "user", "content": user}],
                thinking={"type": "adaptive"},
                output_config={"effort": self.effort},
                # Lehnt ein Sicherheitsklassifikator ab, springt serverseitig ein Ersatzmodell ein.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as exc:
            raise AgentError(f"Claude: {exc}") from exc
        if resp.stop_reason == "refusal":
            raise AgentError("Claude: Anfrage abgelehnt (refusal)")
        text = "".join(b.text for b in resp.content if b.type == "text")
        return text, Usage(resp.usage.input_tokens, resp.usage.output_tokens)


class OpenAICompatibleAgent(Agent):
    """ChatGPT (OpenAI) und Grok (xAI, OpenAI-kompatible API) teilen sich diesen Adapter."""

    def __init__(self, name: str, model: str, api_key: str, base_url: str | None = None):
        from openai import OpenAI

        self.name = name
        self.model = model
        self.client = OpenAI(api_key=api_key, base_url=base_url)

    def complete(self, system: str, user: str) -> tuple[str, Usage]:
        import openai

        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                response_format={"type": "json_object"},
            )
        except openai.APIError as exc:
            raise AgentError(f"{self.name}: {exc}") from exc
        text = resp.choices[0].message.content or ""
        u = resp.usage
        return text, Usage(getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0))


def build_agents() -> list[Agent]:
    """Baut alle Agenten, für die ein API-Schlüssel vorhanden ist."""
    agents: list[Agent] = []
    if os.getenv("ANTHROPIC_API_KEY"):
        agents.append(ClaudeAgent())
    if os.getenv("OPENAI_API_KEY"):
        agents.append(OpenAICompatibleAgent(
            "ChatGPT", os.getenv("OPENAI_MODEL", "gpt-5"), os.environ["OPENAI_API_KEY"]))
    if os.getenv("XAI_API_KEY"):
        agents.append(OpenAICompatibleAgent(
            "Grok", os.getenv("XAI_MODEL", "grok-4"), os.environ["XAI_API_KEY"],
            base_url="https://api.x.ai/v1"))
    return agents


class DemoAgent(Agent):
    """Offline-Agent ohne API: liefert deterministisches JSON, um den Ablauf zu testen."""

    def __init__(self, name: str):
        self.name = name
        self.calls = 0

    def complete(self, system: str, user: str) -> tuple[str, Usage]:
        self.calls += 1
        task = re.search(r"AUFGABE: (\w+)", system)
        task = task.group(1) if task else ""
        if task == "PROPOSE":
            out = {"claims": [
                {"text": f"{self.name}-These #{self.calls}: Beispielbefund.",
                 "evidence_type": "spekuliert", "dois": [], "confidence": 0.4},
                {"text": f"{self.name}-These #{self.calls}b: belegter Befund.",
                 "evidence_type": "belegt", "dois": ["10.1038/nature14539"], "confidence": 0.7},
            ], "follow_up_questions": [f"Folgefrage von {self.name} (Runde {self.calls})?"]}
        elif task == "REVIEW":
            ids = [int(i) for i in re.findall(r"\[#(\d+)\]", user)]
            out = {"reviews": [
                {"claim_id": i, "verdict": "support" if i % 2 == 0 else "challenge",
                 "critique": f"{self.name} prüft #{i}.", "confidence": 0.6} for i in ids]}
        else:
            out = {"synthesis": f"Synthese von {self.name}.",
                   "open_problems": ["Offenes Problem"],
                   "next_questions": [{"text": f"Neue Frage aus Synthese {self.name} #{self.calls}?",
                                       "priority": 0.5}]}
        return json.dumps(out, ensure_ascii=False), Usage(100, 100)


def parse_json(text: str) -> dict:
    """Robustes JSON-Parsing: akzeptiert auch Antworten mit Codeblöcken oder Vorrede."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    raise AgentError(f"Antwort war kein gültiges JSON: {text[:200]!r}")
