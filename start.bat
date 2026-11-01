@echo off
REM Startet die lokale Vollversion mit einem Doppelklick (Windows).
cd /d "%~dp0"
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
pip install -q -e .
if not exist .env (copy .env.example .env >nul & echo Bitte API-Schluessel in .env eintragen. Bis dahin laeuft nur der Demo-Modus.)
start "" http://127.0.0.1:8765
rc web
