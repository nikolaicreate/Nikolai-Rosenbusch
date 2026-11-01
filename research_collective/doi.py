"""DOI-Prüfung: Eine These gilt nur als 'belegt', wenn ihre DOI tatsächlich auflösbar ist."""
from __future__ import annotations

import re

import httpx

from .knowledge import KnowledgeBase

DOI_RE = re.compile(r"^10\.\d{4,9}/\S+$")


def clean(doi: str) -> str:
    doi = doi.strip().removeprefix("https://doi.org/").removeprefix("http://dx.doi.org/").removeprefix("doi:")
    return doi.strip().rstrip(".,;")


def doi_exists(doi: str, kb: KnowledgeBase, offline: bool = False) -> bool:
    """Fragt die offizielle Handle-API von doi.org ab (deckt Crossref, DataCite usw. ab)."""
    doi = clean(doi)
    if not DOI_RE.match(doi):
        return False
    cached = kb.doi_cached(doi)
    if cached is not None:
        return cached
    if offline:
        return False
    try:
        r = httpx.get(f"https://doi.org/api/handles/{doi}", timeout=15)
        exists = r.status_code == 200 and r.json().get("responseCode") == 1
    except (httpx.HTTPError, ValueError):
        return False  # Netzfehler nicht cachen – beim nächsten Mal erneut prüfen
    kb.cache_doi(doi, exists)
    return exists


def verify_all(dois: list[str], kb: KnowledgeBase, offline: bool = False) -> list[str]:
    return [clean(d) for d in dois if doi_exists(d, kb, offline)]
