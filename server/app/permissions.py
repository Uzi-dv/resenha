"""
Cargos e permissões por servidor, no modelo do Discord.

- Cada servidor tem o cargo padrão @everyone (posição 0, vale para todos) e cargos próprios.
- A permissão efetiva é a soma das permissões dos cargos da pessoa (+ @everyone).
- O dono (e o super admin) tem tudo. Administrador também tem tudo, mas respeita a hierarquia:
  ninguém mexe em cargos ou pessoas na mesma posição ou acima do seu cargo mais alto.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway import hub
from app.models import AppMeta, MemberRole, Server, ServerMember, ServerRole

ADMINISTRATOR = 1 << 0
MANAGE_SERVER = 1 << 1
MANAGE_ROLES = 1 << 2
MANAGE_CHANNELS = 1 << 3
KICK_MEMBERS = 1 << 4
MANAGE_MESSAGES = 1 << 5
MOVE_MEMBERS = 1 << 6  # tirar pessoas da call deste servidor
CREATE_INVITE = 1 << 7  # gerar links de convite (ligada no @everyone por padrão, como no Discord)
ALL_PERMISSIONS = (1 << 8) - 1
DEFAULT_EVERYONE_PERMISSIONS = CREATE_INVITE

PERMISSION_NAMES = {
    ADMINISTRATOR: "Administrador",
    MANAGE_SERVER: "Gerenciar servidor",
    MANAGE_ROLES: "Gerenciar cargos",
    MANAGE_CHANNELS: "Gerenciar canais",
    KICK_MEMBERS: "Expulsar membros",
    MANAGE_MESSAGES: "Gerenciar mensagens",
    MOVE_MEMBERS: "Desconectar da call",
    CREATE_INVITE: "Criar convites",
}

OWNER_POSITION = 10 ** 9


@dataclass
class Access:
    member: ServerMember
    permissions: int
    top_position: int  # posição do cargo mais alto (dono: infinito)
    is_owner: bool

    def has(self, perm: int) -> bool:
        return bool(self.permissions & (ADMINISTRATOR | perm))


async def server_roles(db: AsyncSession, server_id: int) -> List[ServerRole]:
    return list((await db.execute(
        select(ServerRole).where(ServerRole.server_id == server_id).order_by(ServerRole.position.desc(), ServerRole.id)
    )).scalars().all())


async def member_role_ids(db: AsyncSession, server_id: int) -> Dict[int, List[int]]:
    rows = (await db.execute(
        select(MemberRole.user_id, MemberRole.role_id).where(MemberRole.server_id == server_id)
    )).all()
    out: Dict[int, List[int]] = {}
    for user_id, role_id in rows:
        out.setdefault(user_id, []).append(role_id)
    return out


async def get_access(db: AsyncSession, server_id: int, user_id: int) -> Access:
    member = (await db.execute(
        select(ServerMember).where(ServerMember.server_id == server_id, ServerMember.user_id == user_id)
    )).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="Você não é membro deste servidor.")
    server = await db.get(Server, server_id)
    if server.owner_id == user_id or hub.is_superadmin(user_id):
        return Access(member, ALL_PERMISSIONS, OWNER_POSITION, server.owner_id == user_id)

    roles = {r.id: r for r in await server_roles(db, server_id)}
    mine = (await member_role_ids(db, server_id)).get(user_id, [])
    perms, top = 0, 0
    for role in roles.values():
        if role.is_default or role.id in mine:
            perms |= role.permissions or 0
            if not role.is_default:
                top = max(top, role.position)
    return Access(member, perms, top, False)


async def require_permission(db: AsyncSession, server_id: int, user_id: int, perm: int, message: Optional[str] = None) -> Access:
    access = await get_access(db, server_id, user_id)
    if not access.has(perm):
        raise HTTPException(status_code=403, detail=message or f"Você precisa da permissão \"{PERMISSION_NAMES[perm]}\".")
    return access


async def top_position_of(db: AsyncSession, server_id: int, user_id: int) -> int:
    server = await db.get(Server, server_id)
    if server.owner_id == user_id:
        return OWNER_POSITION
    roles = {r.id: r for r in await server_roles(db, server_id)}
    mine = (await member_role_ids(db, server_id)).get(user_id, [])
    return max((roles[r].position for r in mine if r in roles and not roles[r].is_default), default=0)


async def ensure_default_roles(db: AsyncSession) -> None:
    """Cria o @everyone dos servidores antigos e converte os antigos "admin" num cargo Admin."""
    servers = (await db.execute(select(Server))).scalars().all()
    changed = False
    for server in servers:
        roles = await server_roles(db, server.id)
        if not any(r.is_default for r in roles):
            db.add(ServerRole(server_id=server.id, name="@everyone", position=0,
                              permissions=DEFAULT_EVERYONE_PERMISSIONS, is_default=True))
            changed = True
        admins = (await db.execute(
            select(ServerMember).where(ServerMember.server_id == server.id, ServerMember.role == "admin")
        )).scalars().all()
        if admins:
            await db.flush()
            admin_role = ServerRole(
                server_id=server.id, name="Admin", color="#e67e22", position=max((r.position for r in roles), default=0) + 1,
                hoist=True, permissions=ADMINISTRATOR,
            )
            db.add(admin_role)
            await db.flush()
            for m in admins:
                db.add(MemberRole(server_id=server.id, user_id=m.user_id, role_id=admin_role.id))
                m.role = "member"
            changed = True
    # v2.11: "Criar convites" passa a vir ligada no @everyone. Roda uma vez só, para não religar
    # em quem desligou de propósito depois.
    if not await db.get(AppMeta, "everyone_create_invite"):
        await db.flush()
        for role in (await db.execute(select(ServerRole).where(ServerRole.is_default.is_(True)))).scalars():
            role.permissions = (role.permissions or 0) | CREATE_INVITE
        db.add(AppMeta(key="everyone_create_invite", value="1"))
        changed = True
    if changed:
        await db.commit()
