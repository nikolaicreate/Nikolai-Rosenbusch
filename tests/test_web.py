import json
import threading
import time
import urllib.error
import urllib.request

import pytest

from research_collective.web import serve


@pytest.fixture
def server(tmp_path):
    httpd = serve(str(tmp_path / "w.db"), "127.0.0.1", 0)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def get(base, path):
    with urllib.request.urlopen(base + path) as r:
        return r.read().decode()


def post(base, path, body, header=True):
    req = urllib.request.Request(base + path, json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **({"X-Requested-With": "rc"} if header else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_index_served(server):
    assert "Forschungskollektiv" in get(server, "/")


def test_demo_run_end_to_end(server):
    status, r = post(server, "/api/ask", {"question": "Was ist Wissen?"})
    assert status == 200 and r["id"] == 1
    assert post(server, "/api/ask", {"question": "was ist wissen"})[1]["duplicate"] is True
    assert post(server, "/api/run", {"cycles": 2, "demo": True, "pause": 0})[0] == 200
    for _ in range(100):
        s = json.loads(get(server, "/api/state"))
        if not s["runner"]["running"] and s["runner"].get("completed") == 2:
            break
        time.sleep(0.05)
    assert s["stats"]["fragen"]["done"] == 2
    assert any("Zyklus" in l["text"] for l in s["log"])
    d = json.loads(get(server, "/api/question?id=1"))
    assert d["claims"] and d["syntheses"] and d["claims"][0]["reviews"]
    assert "Wissensbasis" in get(server, "/api/report.md")


def test_guards(server):
    assert post(server, "/api/ask", {"question": "Testfrage"}, header=False)[0] == 403
    assert post(server, "/api/ask", {"question": "x"})[0] == 400
    # Dauerbetrieb mit echten Modellen nur mit Budget
    assert post(server, "/api/run", {"forever": True})[0] == 400
    # Ohne API-Schlüssel kein echter Lauf
    status, r = post(server, "/api/run", {"cycles": 1})
    assert status == 409 and "API-Schlüssel" in r["error"]
