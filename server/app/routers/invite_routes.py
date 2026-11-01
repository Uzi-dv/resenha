"""
Convites em link: seu-dominio.com/convite/<código>.

- Cada convite tem validade (max_age) e limite de usos (max_uses), e pode ser revogado.
- O Server.invite_code antigo continua valendo como convite permanente do servidor
  (apps antigos e links já compartilhados não quebram).
- A prévia (GET /api/invites/{code}) é pública: a página do convite e o cartão nas mensagens usam.
"""
import datetime
import re
import secrets
import string
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.config import PUBLIC_URL
from app.database import get_db
from app.gateway import hub
from app.models import Server, ServerInvite, ServerMember, User, utcnow
from app.permissions import CREATE_INVITE, MANAGE_SERVER, get_access, require_permission
from app.routers.server_routes import _member_payload, _next_position, _server_detail
from app.schemas import InviteCreate

router = APIRouter(tags=["invites"])

ALPHABET = string.ascii_letters + string.digits
CODE_LENGTH = 8
CODE_RE = re.compile(r"^[A-Za-z0-9_-]{4,32}$")
MAX_AGES = (0, 1800, 3600, 21600, 43200, 86400, 604800)
MAX_USES = (0, 1, 5, 10, 25, 50, 100)
INVALID = "Este convite expirou ou não existe."


def invite_url(code: str) -> str:
    return f"{PUBLIC_URL}/convite/{code}"


def extract_code(raw: str) -> str:
    """Aceita o código puro ou um link (https://.../convite/<código>, resenha://convite/<código>, com ou sem ?/#)."""
    value = (raw or "").strip().split("?", 1)[0].split("#", 1)[0].rstrip("/")
    return value.rsplit("/", 1)[-1]


def is_valid(invite: ServerInvite, now: Optional[datetime.datetime] = None) -> bool:
    now = now or utcnow()
    if invite.revoked_at is not None:
        return False
    if invite.expires_at is not None and invite.expires_at <= now:
        return False
    if invite.max_uses and (invite.uses or 0) >= invite.max_uses:
        return False
    return True


async def resolve(db: AsyncSession, raw: str) -> Tuple[Server, Optional[ServerInvite]]:
    """Encontra o servidor de um convite válido (novo ou o código antigo do servidor). 404 se não vale."""
    code = extract_code(raw)
    if not CODE_RE.match(code):
        raise HTTPException(status_code=404, detail=INVALID)
    invite = (await db.execute(select(ServerInvite).where(ServerInvite.code == code))).scalar_one_or_none()
    if invite:
        server = await db.get(Server, invite.server_id)
        if not server or not is_valid(invite):
            raise HTTPException(status_code=404, detail=INVALID)
        return server, invite
    server = (await db.execute(select(Server).where(Server.invite_code == code))).scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail=INVALID)
    return server, None


async def accept(db: AsyncSession, server: Server, invite: Optional[ServerInvite], user: User) -> dict:
    """Coloca a pessoa no servidor. Quem já é membro não gasta um uso do convite."""
    existing = (await db.execute(
        select(ServerMember).where(ServerMember.server_id == server.id, ServerMember.user_id == user.id)
    )).scalar_one_or_none()
    if not existing:
        member = ServerMember(server_id=server.id, user_id=user.id, role="member",
                              position=await _next_position(db, user.id))
        db.add(member)
        if invite:
            invite.uses = (invite.uses or 0) + 1
        await db.commit()
        await db.refresh(member)
        member.user = user
        hub.add_member(server.id, user.id)
        hub.send_to_server(server.id, "MEMBER_ADD", _member_payload(member))
        if invite and invite.max_uses and invite.uses >= invite.max_uses:
            hub.send_to_server(server.id, "INVITE_UPDATE", {"server_id": server.id})
    return await _server_detail(db, server.id)


def _user_brief(user: Optional[User]) -> Optional[dict]:
    if not user:
        return None
    return {"id": user.id, "username": user.username, "avatar_url": user.avatar_url or ""}


def _iso(value: Optional[datetime.datetime]) -> Optional[str]:
    # Datas do banco são UTC sem fuso; o "Z" evita que o navegador leia como hora local
    return value.isoformat() + "Z" if value else None


def invite_payload(invite: ServerInvite, inviter: Optional[User]) -> dict:
    return {
        "code": invite.code,
        "url": invite_url(invite.code),
        "server_id": invite.server_id,
        "inviter": _user_brief(inviter),
        "uses": invite.uses or 0,
        "max_uses": invite.max_uses or 0,
        "max_age": invite.max_age or 0,
        "created_at": _iso(invite.created_at),
        "expires_at": _iso(invite.expires_at),
    }


def server_counts(server_id: int) -> Tuple[int, int]:
    members = hub.server_members.get(server_id, set())
    online = sum(1 for uid in members if hub.presence_of(uid) != "offline")
    return len(members), online


async def preview(db: AsyncSession, raw: str) -> dict:
    server, invite = await resolve(db, raw)
    inviter = await db.get(User, invite.inviter_id) if invite and invite.inviter_id else None
    members, online = server_counts(server.id)
    code = invite.code if invite else server.invite_code
    return {
        "code": code,
        "url": invite_url(code),
        "server": {"id": server.id, "name": server.name, "icon_url": server.icon_url or ""},
        "members": members,
        "online": online,
        "inviter": _user_brief(inviter),
        "expires_at": _iso(invite.expires_at) if invite else None,
    }


async def _new_code(db: AsyncSession) -> str:
    while True:
        code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
        taken = (await db.execute(select(ServerInvite.id).where(ServerInvite.code == code))).first()
        if not taken:
            return code


# ------------------------------------------------------------------ rotas
@router.post("/api/servers/{server_id}/invites")
async def create_invite(
    server_id: int, body: InviteCreate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await require_permission(db, server_id, current_user.id, CREATE_INVITE)
    if body.max_age not in MAX_AGES:
        raise HTTPException(status_code=400, detail="Validade inválida.")
    if body.max_uses not in MAX_USES:
        raise HTTPException(status_code=400, detail="Limite de usos inválido.")

    now = utcnow()
    # Reaproveita um convite igual da mesma pessoa: "Copiar link" não gera um código novo a cada clique.
    # Com validade, só se ainda faltar pelo menos metade do tempo (o link não morre logo depois de enviado).
    candidates = (await db.execute(
        select(ServerInvite).where(
            ServerInvite.server_id == server_id, ServerInvite.inviter_id == current_user.id,
            ServerInvite.max_age == body.max_age, ServerInvite.max_uses == body.max_uses,
            ServerInvite.revoked_at.is_(None),
        ).order_by(ServerInvite.id.desc())
    )).scalars().all()
    for invite in candidates:
        fresh = invite.expires_at is None or (invite.expires_at - now).total_seconds() >= body.max_age / 2
        if is_valid(invite, now) and fresh:
            return invite_payload(invite, current_user)

    invite = ServerInvite(
        code=await _new_code(db), server_id=server_id, inviter_id=current_user.id, created_at=now,
        max_age=body.max_age, max_uses=body.max_uses, uses=0,
        expires_at=now + datetime.timedelta(seconds=body.max_age) if body.max_age else None,
    )
    db.add(invite)
    await db.commit()
    hub.send_to_server(server_id, "INVITE_UPDATE", {"server_id": server_id})
    return invite_payload(invite, current_user)


@router.get("/api/servers/{server_id}/invites")
async def list_invites(server_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_permission(db, server_id, current_user.id, MANAGE_SERVER)
    invites = (await db.execute(
        select(ServerInvite).where(ServerInvite.server_id == server_id, ServerInvite.revoked_at.is_(None))
        .order_by(ServerInvite.created_at.desc())
    )).scalars().all()
    now = utcnow()
    valid = [i for i in invites if is_valid(i, now)]
    inviters = {u.id: u for u in (await db.execute(
        select(User).where(User.id.in_({i.inviter_id for i in valid if i.inviter_id}))
    )).scalars()}
    return [invite_payload(i, inviters.get(i.inviter_id)) for i in valid]


@router.delete("/api/invites/{code}")
async def revoke_invite(code: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    invite = (await db.execute(select(ServerInvite).where(ServerInvite.code == code))).scalar_one_or_none()
    if not invite or invite.revoked_at is not None:
        raise HTTPException(status_code=404, detail="Convite não encontrado.")
    if invite.inviter_id != current_user.id:
        access = await get_access(db, invite.server_id, current_user.id)
        if not access.has(MANAGE_SERVER):
            raise HTTPException(status_code=403, detail="Só quem criou o convite (ou quem gerencia o servidor) pode revogá-lo.")
    invite.revoked_at = utcnow()
    await db.commit()
    hub.send_to_server(invite.server_id, "INVITE_UPDATE", {"server_id": invite.server_id})
    return {"ok": True}


@router.get("/api/invites/{code}")
async def get_invite(code: str, db: AsyncSession = Depends(get_db)):
    return await preview(db, code)


@router.post("/api/invites/{code}/accept")
async def accept_invite(code: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    server, invite = await resolve(db, code)
    return await accept(db, server, invite, current_user)
