"""
Página de download (seu-dominio.com/download) e o link que baixa sempre o instalador mais novo.

O nome do instalador muda a cada versão (Resenha-Setup-2.10.0.exe), então o atalho do GitHub
releases/latest/download/<arquivo> não serve. O servidor descobre o Setup mais recente pela API do
GitHub, guarda em memória por 10 minutos e redireciona. Se o GitHub falhar, continua usando o
último valor bom. O updater da versão web (web_app.update_once) também alimenta este cache.

Variáveis (opcionais, no .env):
    WEB_RELEASES_REPO   repositório das releases (ex.: seu-usuario/resenha-releases; vazio = sem página de download)
    GITHUB_API_BASE     endereço da API do GitHub (padrão: https://api.github.com; os testes usam um falso)
"""
import asyncio
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger("resenha.downloads")

RELEASES_REPO = os.getenv("WEB_RELEASES_REPO", "").strip()
GITHUB_API_BASE = os.getenv("GITHUB_API_BASE", "https://api.github.com").rstrip("/")
PAGE_DIR = Path(__file__).resolve().parent / "static" / "download"
FALLBACK_URL = f"https://github.com/{RELEASES_REPO}/releases/latest" if RELEASES_REPO else "/"
CACHE_SECONDS = 10 * 60
RETRY_SECONDS = 60  # depois de uma falha, não consulta o GitHub a cada visita
SETUP_RE = re.compile(r"^Resenha-Setup-(.+)\.exe$")
PORTABLE_RE = re.compile(r"^Resenha-Portable-(.+)\.exe$")

_info: Optional[dict] = None
_next_check = 0.0
_lock = asyncio.Lock()


def remember(release: dict) -> Optional[dict]:
    """Guarda o Setup e o Portable de uma resposta de releases/latest. Retorna o que ficou guardado."""
    global _info, _next_check
    assets = release.get("assets") or []
    setup = next((a for a in assets if SETUP_RE.match(a.get("name", ""))), None)
    if not setup:
        return _info  # release sem instalador (ainda subindo, por exemplo): fica com o anterior
    portable = next((a for a in assets if PORTABLE_RE.match(a.get("name", ""))), None)
    _info = {
        "version": SETUP_RE.match(setup["name"]).group(1),
        "setup_url": setup["browser_download_url"],
        "setup_size": setup.get("size"),
        "portable_url": portable["browser_download_url"] if portable else None,
        "published_at": release.get("published_at"),
    }
    _next_check = time.monotonic() + CACHE_SECONDS
    return _info


async def latest() -> Optional[dict]:
    """Informações do instalador mais novo (cache de 10 min). None se nunca deu para descobrir."""
    global _next_check
    if not RELEASES_REPO or time.monotonic() < _next_check:
        return _info
    async with _lock:
        if time.monotonic() < _next_check:  # outra visita já atualizou enquanto esperava
            return _info
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "Resenha-Server"}
        try:
            async with httpx.AsyncClient(timeout=10, headers=headers) as client:
                res = await client.get(f"{GITHUB_API_BASE}/repos/{RELEASES_REPO}/releases/latest")
                res.raise_for_status()
                remember(res.json())
        except Exception as exc:  # sem internet, GitHub fora, limite da API etc.
            logger.warning("Não foi possível consultar a última versão no GitHub: %s", exc)
        if time.monotonic() >= _next_check:  # falhou ou veio sem instalador
            _next_check = time.monotonic() + RETRY_SECONDS
    return _info
