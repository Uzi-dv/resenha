"""
Versão web do Resenha: o servidor entrega o app no navegador, no mesmo endereço da API.

O pacote vem pronto das releases do app (WEB_RELEASES_REPO, arquivo resenha-web-X.zip,
gerado pelo CI a cada versão). O servidor confere de tempos em tempos e baixa a versão nova
sozinho, então o site está sempre na mesma versão do app para Windows.

Variáveis (opcionais, no .env):
    WEB_DIR             pasta com o app web (padrão: web/ ao lado do código)
    WEB_AUTO_UPDATE     0 desliga o download automático (padrão: 1)
    WEB_RELEASES_REPO   repositório das releases (ex.: seu-usuario/resenha-releases; vazio = sem versão web automática)
    GITHUB_API_BASE     endereço da API do GitHub (padrão: https://api.github.com)
"""
import asyncio
import io
import logging
import os
import re
import shutil
import zipfile
from pathlib import Path
from typing import Optional

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import FileResponse

from app import downloads
from app.downloads import GITHUB_API_BASE, RELEASES_REPO

logger = logging.getLogger("resenha.web")

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = Path(os.getenv("WEB_DIR", ROOT / "web")).resolve()
AUTO_UPDATE = os.getenv("WEB_AUTO_UPDATE", "1") != "0"
CHECK_INTERVAL_SECONDS = 30 * 60
ASSET_RE = re.compile(r"^resenha-web-(.+)\.zip$")
MAX_BUNDLE_BYTES = 50 * 1024 * 1024


def installed_version() -> Optional[str]:
    try:
        return (WEB_DIR / "VERSION").read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def is_available() -> bool:
    return (WEB_DIR / "index.html").is_file()


def _extract(data: bytes, version: str) -> None:
    """Extrai numa pasta nova e troca de uma vez (quem está no site não pega metade de cada versão)."""
    staging = WEB_DIR.with_name(WEB_DIR.name + ".new")
    old = WEB_DIR.with_name(WEB_DIR.name + ".old")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for member in zf.infolist():
            target = (staging / member.filename).resolve()
            if not str(target).startswith(str(staging.resolve())):
                raise ValueError(f"Caminho suspeito no pacote: {member.filename}")
        zf.extractall(staging)
    if not (staging / "index.html").is_file():
        raise ValueError("Pacote web sem index.html")
    (staging / "VERSION").write_text(version, encoding="utf-8")
    shutil.rmtree(old, ignore_errors=True)
    if WEB_DIR.exists():
        WEB_DIR.rename(old)
    staging.rename(WEB_DIR)
    shutil.rmtree(old, ignore_errors=True)


async def update_once(force: bool = False) -> Optional[str]:
    """Baixa a versão web mais nova, se houver. Retorna a versão instalada agora (ou None)."""
    if not RELEASES_REPO:
        return None
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "Resenha-Server"}
    async with httpx.AsyncClient(timeout=60, follow_redirects=True, headers=headers) as client:
        res = await client.get(f"{GITHUB_API_BASE}/repos/{RELEASES_REPO}/releases/latest")
        res.raise_for_status()
        release = res.json()
        downloads.remember(release)  # aproveita a consulta para a página de download
        asset = next((a for a in release.get("assets", []) if ASSET_RE.match(a.get("name", ""))), None)
        if not asset:
            logger.info("Release %s ainda não tem pacote web.", release.get("tag_name"))
            return installed_version()
        version = ASSET_RE.match(asset["name"]).group(1)
        if not force and version == installed_version() and is_available():
            return version
        if asset.get("size", 0) > MAX_BUNDLE_BYTES:
            raise ValueError("Pacote web grande demais")
        logger.info("Baixando a versão web %s...", version)
        data = (await client.get(asset["browser_download_url"], headers={"Accept": "application/octet-stream"})).content
    await asyncio.to_thread(_extract, data, version)
    logger.info("Versão web %s instalada em %s", version, WEB_DIR)
    return version


async def updater_loop() -> None:
    if not AUTO_UPDATE:
        return
    while True:
        try:
            await update_once()
        except Exception as exc:  # sem internet, GitHub fora etc.: tenta de novo mais tarde
            logger.warning("Não foi possível atualizar a versão web: %s", exc)
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)


def wants_html(request: Request) -> bool:
    """Navegador abrindo o site (HTML) x app/healthcheck pedindo o status (JSON) no mesmo endereço."""
    accept = request.headers.get("accept", "")
    return "text/html" in accept


def serve_file(path: str) -> FileResponse:
    """Arquivo do app web ou, para qualquer outra rota, o index.html (app de página única)."""
    if not is_available():
        raise HTTPException(status_code=404, detail="Versão web ainda não instalada neste servidor.")
    target = (WEB_DIR / path).resolve() if path else WEB_DIR / "index.html"
    if not str(target).startswith(str(WEB_DIR)) or not target.is_file():
        target = WEB_DIR / "index.html"
    if target.name == "index.html":
        # Sempre busca o index novo (ele aponta para os arquivos da versão atual)
        return FileResponse(target, headers={"Cache-Control": "no-cache"})
    # Arquivos em assets/ têm hash no nome: podem ficar em cache "para sempre"
    cache = "public, max-age=31536000, immutable" if target.parent.name == "assets" else "public, max-age=3600"
    return FileResponse(target, headers={"Cache-Control": cache})
