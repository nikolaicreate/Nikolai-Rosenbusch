# Research Collective – Grok × Claude × ChatGPT

Drei Sprachmodelle bilden eine Forschungsgemeinschaft. Sie stellen Thesen auf, begutachten sich gegenseitig,
prüfen Belege und schreiben ihre Forschungsagenda selbst fort. Die Ergebnisse landen in einer dauerhaften
Wissensbasis (SQLite), auf der jede neue Runde aufbaut.

## Ein Forschungszyklus

```
 Agenda (Fragen-Warteschlange, nach Priorität)
        │
        ▼
 1. PROPOSE    alle Modelle parallel: 2–5 Thesen + Folgefragen
               (mit dem bisherigen Wissen der Datenbank als Kontext)
        │
 2. DOI-CHECK  jede DOI wird bei doi.org aufgelöst
               "belegt" ohne auflösbare DOI → herabgestuft auf "zu_pruefen"
        │
 3. REVIEW     über Kreuz: jedes Modell begutachtet nur fremde Thesen
               (support | challenge | refute)
        │
 4. STATUS     konsens   = Mehrheit stützt, kein Widerspruch, DOI geprüft
               plausibel = gestützt, aber unbelegt
               umstritten / widerlegt
        │
 5. SYNTHESE   die Moderation rotiert; benennt Dissens und offene Probleme
               und erzeugt neue Fragen → zurück auf die Agenda
```

Die Kernregel lautet: **Zustimmung allein erzeugt kein Wissen.** Den Status `konsens` bekommt eine These
nur, wenn eine echte, auflösbare DOI sie stützt. Das soll verhindern, dass sich drei Modelle mit ähnlichen
Trainingsdaten gegenseitig ihre gemeinsamen Irrtümer bestätigen.

## Sofort loslegen

**Ohne Installation (im Browser):** [Forschungskollektiv auf claude.ai](https://claude.ai/artifact/4GgzfuubKJASACR3nUir6r). Den Quelltext findest du in `webapp/forschungskollektiv.html`.
Claude antwortet automatisch über dein Claude-Konto. ChatGPT und Grok nehmen über Kopieren und Einfügen
aus ihren eigenen Web-Apps teil, oder Claude vertritt ihren Platz mit eigener Perspektive (deutlich gekennzeichnet).
Die Browser-Version kann DOIs nicht selbst nachschlagen: Du klickst sie an und bestätigst sie per Klick.

**Vollversion lokal mit echter API-Anbindung:** Doppelklick auf `start.command` (macOS) oder `start.bat` (Windows),
oder `./start.sh` unter Linux. Das Skript richtet alles ein und öffnet die Web-App im Browser.

## Installation

```bash
pip install -e ".[dev]"
cp .env.example .env    # mindestens zwei der drei API-Schlüssel eintragen
```

| Forscher | Schlüssel | Modell (überschreibbar) |
|---|---|---|
| Claude | `ANTHROPIC_API_KEY` | `CLAUDE_MODEL` (Standard `claude-opus-5-5`) |
| ChatGPT | `OPENAI_API_KEY` | `OPENAI_MODEL` (Standard `gpt-5`, aktuelle Namen bitte prüfen) |
| Grok | `XAI_API_KEY` | `XAI_MODEL` (Standard `grok-4`, aktuelle Namen bitte prüfen) |

## Web-App

```bash
rc web                  # → http://127.0.0.1:8765
```

Was die Oberfläche bietet:

- **Fragen auf die Agenda setzen** und dabei eine Priorität vergeben.
- **Forschungsläufe starten und stoppen**, entweder mit fester Zyklenzahl oder im Dauerbetrieb mit Token-Budget. Der Demo-Modus läuft offline und ohne Kosten.
- **Live-Kennzahlen:** Thesen nach Status, Zahl der Reviews, DOI-Fehler, Tokens pro Modell.
- **Detailansicht je Frage:** kritische Synthese, offene Probleme, Thesen mit Status und Evidenzklasse, geprüfte (✓) und nicht auflösbare (✗) DOIs, alle Reviews und den Baum der Folgefragen.
- **Volltextsuche**, Live-Protokoll, Download des Berichts als Markdown, Hell- und Dunkelmodus, Handy-tauglich.

Sicherheit: Die API-Schlüssel bleiben auf dem Server. Er lauscht standardmäßig nur auf `127.0.0.1`, weil er
keine Anmeldung hat und jeder Start echte API-Kosten verursacht. Dauerbetrieb mit echten Modellen
nimmt der Server nur mit Token-Budget an. Antworten der Modelle werden im Browser grundsätzlich escaped.

## Kommandozeile

```bash
rc run --demo --cycles 3 --pause 0         # Offline-Demo ohne Schlüssel und ohne Kosten
rc ask "Ist Kants Kategorienlehre mit der Kognitionswissenschaft vereinbar?"
rc run --cycles 5                          # fünf Zyklen
rc run --forever --token-budget 2000000    # nonstop, bis das Budget verbraucht ist
rc report                                  # → knowledge/REPORT.md
rc stats
rc search "Kant"
```

**Nonstop-Betrieb:** `--forever` läuft weiter, bis die Agenda leer ist, das Token-Budget erreicht ist oder
du mit Strg+C abbrichst. Nach jedem Schritt ist alles gespeichert, und ein neuer Start setzt dort fort.
Weil die Agenda mit jeder Synthese wächst, läuft der Betrieb praktisch endlos. Deshalb begrenzen
`--max-depth` (Standard 4) und die Abwertung tieferer Fragen das Abdriften ins Kleinteilige.
**Setze immer `--token-budget`**, denn drei Frontier-Modelle im Dauerbetrieb kosten echtes Geld.

## Grenzen (ehrlich)

- Eine auflösbare DOI beweist nur, dass das Paper **existiert**, nicht, dass es die These **stützt**.
  Die inhaltliche Passung prüfen nur die Reviewer-Modelle, und die können sich irren.
- Die drei Modelle sind keine unabhängigen Beobachter. Ihr Konsens ist schwächere Evidenz als
  drei unabhängige menschliche Labore.
- Die Modelle haben keinen Zugriff auf Experimente oder Primärdaten. Das System verdichtet und prüft
  vorhandenes Wissen, es erzeugt keine neuen Messungen.

## Tests

```bash
pytest -q
```
