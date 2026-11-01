from research_collective.agents import DemoAgent, parse_json
from research_collective.knowledge import KnowledgeBase
from research_collective.orchestrator import Collective, decide_status


def make(tmp_path):
    kb = KnowledgeBase(str(tmp_path / "t.db"))
    # DOI vorab als existent cachen, damit der Test offline läuft
    kb.cache_doi("10.1038/nature14539", True)
    agents = [DemoAgent(n) for n in ("Claude", "ChatGPT", "Grok")]
    return kb, Collective(agents, kb, max_depth=2, offline_doi=True)


def test_full_cycle_builds_knowledge(tmp_path):
    kb, coll = make(tmp_path)
    kb.add_question("Was ist Bewusstsein?", 1.0)
    assert coll.run(max_cycles=3) == 3
    s = kb.stats()
    assert s["fragen"]["done"] == 3
    assert s["reviews"] > 0
    # Geprüfte DOI bleibt "belegt"; nichts wird ohne DOI zu "konsens"
    for c in kb.db.execute("SELECT * FROM claims WHERE status='konsens'"):
        assert c["evidence_type"] == "belegt" and c["verified_dois"] != "[]"
    # Niemand begutachtet sich selbst
    bad = kb.db.execute("SELECT COUNT(*) FROM reviews r JOIN claims c ON c.id=r.claim_id WHERE r.reviewer=c.author").fetchone()[0]
    assert bad == 0


def test_unverified_doi_downgraded(tmp_path):
    kb, coll = make(tmp_path)
    kb.cache_doi("10.1038/nature14539", False)
    kb.add_question("Testfrage", 1.0)
    coll.run(max_cycles=1)
    assert kb.db.execute("SELECT COUNT(*) FROM claims WHERE evidence_type='belegt'").fetchone()[0] == 0
    assert kb.db.execute("SELECT COUNT(*) FROM claims WHERE evidence_type='zu_pruefen'").fetchone()[0] > 0


def test_budget_and_depth_stop(tmp_path):
    kb, coll = make(tmp_path)
    kb.add_question("Frage", 1.0)
    assert coll.run(max_cycles=None, token_budget=1) == 1  # Budget nach Zyklus 1 überschritten
    (tmp_path / "x").mkdir()
    kb2, coll2 = make(tmp_path / "x")
    kb2.add_question("Frage", 1.0)
    coll2.max_depth = 0
    assert coll2.run(max_cycles=None) == 1  # Folgefragen jenseits der Tiefe werden nicht angelegt


def test_decide_status():
    assert decide_status("belegt", ["10.1/x"], ["support", "support"]) == "konsens"
    assert decide_status("interpretiert", [], ["support", "support"]) == "plausibel"
    assert decide_status("belegt", ["10.1/x"], ["refute", "refute"]) == "widerlegt"
    assert decide_status("belegt", ["10.1/x"], ["support", "challenge", "refute"]) == "umstritten"


def test_parse_json_tolerant():
    assert parse_json('Hier: ```json\n{"a": 1}\n```') == {"a": 1}
