"""
Página do convite (seu-dominio.com/convite/<código>).

O HTML já sai preenchido (título, Open Graph e o cartão), assim o link fica bonito no WhatsApp/Discord
e a página funciona mesmo antes do JS. O invite.js cuida de tentar abrir o app (resenha://) e de
atualizar os contadores.
"""
import html
import json
import re
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import PUBLIC_URL
from app.routers import invite_routes

PAGE_DIR = Path(__file__).resolve().parent / "static" / "invite"
DESCRIPTION = "Voz, chat e transmissão de tela com os seus amigos."


def _absolute(url: str) -> str:
    if not url or url.startswith(("http://", "https://")):
        return url
    return PUBLIC_URL + (url if url.startswith("/") else "/" + url)


def _initials(name: str) -> str:
    words = [w for w in name.split() if w]
    return "".join(w[0] for w in words[:2]).upper() or "?"


def _counts(online: int, members: int) -> str:
    return f"{online} online · {members} {'membro' if members == 1 else 'membros'}"


async def render(db: AsyncSession, code: str) -> HTMLResponse:
    template = (PAGE_DIR / "index.html").read_text(encoding="utf-8")
    try:
        data = await invite_routes.preview(db, code)
    except HTTPException:
        data = None

    e = html.escape
    if data:
        server = data["server"]
        inviter = data["inviter"]["username"] if data["inviter"] else None
        title = f"Convite para {server['name']}"
        description = f"{inviter} te convidou para entrar no {server['name']} no Resenha. {DESCRIPTION}" if inviter \
            else f"Você foi convidado para entrar no {server['name']} no Resenha. {DESCRIPTION}"
        icon = _absolute(server["icon_url"])
        values = {
            "TITLE": e(title),
            "DESCRIPTION": e(description),
            "OG_IMAGE": f'<meta property="og:image" content="{e(icon)}">' if icon else "",
            "STATE": "valid",
            "LEAD": e(f"{inviter} te convidou para") if inviter else "Você foi convidado para",
            "SERVER_NAME": e(server["name"]),
            "ICON": f'<img src="{e(icon)}" alt="">' if icon else f'<span class="initials">{e(_initials(server["name"]))}</span>',
            "COUNTS": e(_counts(data["online"], data["members"])),
        }
    else:
        values = {
            "TITLE": "Convite inválido · Resenha",
            "DESCRIPTION": e(DESCRIPTION),
            "OG_IMAGE": "",
            "STATE": "invalid",
            "LEAD": "",
            "SERVER_NAME": "",
            "ICON": "",
            "COUNTS": "",
        }
    safe_code = code if invite_routes.CODE_RE.match(code) else ""
    values["URL"] = e(invite_routes.invite_url(safe_code))
    values["CODE"] = e(safe_code)
    # JSON dentro de <script>: escapa "<" para ninguém fechar a tag pelo nome do servidor
    values["DATA"] = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")

    # Uma passada só: um nome de servidor como "{{COUNTS}}" não é substituído de novo
    page = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: values.get(m.group(1), ""), template)
    return HTMLResponse(page, status_code=200 if data else 404, headers={"Cache-Control": "no-cache"})
