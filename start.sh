#!/usr/bin/env bash
# Startet die lokale Vollversion (echte API-Anbindung an Claude, ChatGPT und Grok) mit einem Befehl.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
. .venv/bin/activate
pip install -q -e .
if [ ! -f .env ]; then cp .env.example .env; echo "Bitte API-Schlüssel in .env eintragen (mindestens zwei). Bis dahin läuft nur der Demo-Modus."; fi
( sleep 2; (command -v open >/dev/null && open http://127.0.0.1:8765) || (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:8765) || true ) &
exec kollektiv web
