import secrets
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_db
from app.deps import require_member, user_simple
from app.gateway import hub
from app.models import Channel, MemberRole, Message, Server, ServerInvite, ServerMember, ServerRole, User
from app.permissions import (
    DEFAULT_EVERYONE_PERMISSIONS, KICK_MEMBERS, MANAGE_CHANNELS, MANAGE_ROLES, MANAGE_SERVER, MOVE_MEMBERS, OWNER_POSITION,
    member_role_ids, require_permission, server_roles, top_position_of,
)
from app.schemas import (
    ChannelCreate, ChannelResponse, ChannelUpdate, MemberRolesUpdate, RoleCreate, RoleOrder, RoleUpdate,
    ServerCreate, ServerJoin, ServerOrder, ServerResponse, ServerUpdate,
)
from app.routers.message_routes import delete_message_extras

router = APIRouter(prefix="/api/servers", tags=["servers"])


def _role_payload(role: ServerRole) -> dict:
    return {
        "id": role.id,
        "name": role.name,
        "color": role.color or "",
        "position": role.position,
        "hoist": bool(role.hoist),
        "permissions": role.permissions or 0,
        "is_default": bool(role.is_default),
    }


def _member_payload(member: ServerMember, role_ids=()) -> dict:
    return {
        "id": member.id,
        "server_id": member.server_id,
        "user_id": member.user_id,
        "role": member.role,
        "role_ids": list(role_ids),
        "joined_at": member.joined_at.isoformat() if member.joined_at else None,
        "user": user_simple(member.user),
    }


def _channel_payload(channel: Channel) -> dict:
    return ChannelResponse.model_validate(channel).model_dump(mode="json")


async def _server_detail(db: AsyncSession, server_id: int) -> dict:
    server = (await db.execute(
        select(Server)
        .options(selectinload(Server.channels), selectinload(Server.members).selectinload(ServerMember.user))
        .where(Server.id == server_id)
    )).scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Servidor não encontrado.")
    data = ServerResponse.model_validate(server).model_dump(mode="json")
    data["channels"] = [_channel_payload(c) for c in server.channels]
    roles_of = await member_role_ids(db, server.id)
    data["members"] = [_member_payload(m, roles_of.get(m.user_id, ())) for m in server.members]
    data["roles"] = [_role_payload(r) for r in await server_roles(db, server.id)]
    data["voice_states"] = hub.voice_states_for_server(server.id)
    return data


@router.get("", response_model=List[ServerResponse])
async def get_user_servers(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    servers = (await db.execute(
        select(Server)
        .join(ServerMember, Server.id == ServerMember.server_id)
        .where(ServerMember.user_id == current_user.id)
        .order_by(ServerMember.position, ServerMember.joined_at, Server.id)
    )).scalars().all()
    return [ServerResponse.model_validate(s) for s in servers]


async def _next_position(db: AsyncSession, user_id: int) -> int:
    current = (await db.execute(
        select(func.max(ServerMember.position)).where(ServerMember.user_id == user_id)
    )).scalar()
    return (current or 0) + 1


@router.put("/order")
async def reorder_servers(order: ServerOrder, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Salva a ordem dos servidores na barra lateral do usuário (vale em qualquer PC)."""
    memberships = (await db.execute(
        select(ServerMember).where(ServerMember.user_id == current_user.id)
    )).scalars().all()
    rank = {sid: i for i, sid in enumerate(order.server_ids)}
    for m in memberships:
        m.position = rank.get(m.server_id, len(rank) + m.position)
    await db.commit()
    return {"ok": True}


@router.post("")
async def create_server(server_in: ServerCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    server = Server(
        name=server_in.name.strip(),
        icon_url=(server_in.icon_url or "").strip(),
        owner_id=current_user.id,
        invite_code=secrets.token_urlsafe(8),
    )
    db.add(server)
    await db.flush()
    db.add(ServerRole(server_id=server.id, name="@everyone", position=0,
                      permissions=DEFAULT_EVERYONE_PERMISSIONS, is_default=True))
    db.add(ServerMember(server_id=server.id, user_id=current_user.id, role="owner",
                        position=await _next_position(db, current_user.id)))
    db.add_all([
        Channel(server_id=server.id, name="geral", type="text", position=0),
        Channel(server_id=server.id, name="Sala de Voz Geral", type="voice", position=1),
    ])
    await db.commit()

    hub.add_member(server.id, current_user.id)
    for ch in (await db.execute(select(Channel).where(Channel.server_id == server.id))).scalars():
        hub.set_channel(ch.id, ch.server_id, ch.type)
    return await _server_detail(db, server.id)


@router.post("/join")
async def join_server(join_in: ServerJoin, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Rota dos apps antigos: aceita o código antigo do servidor, os convites novos e links /convite/<código>."""
    from app.routers import invite_routes  # import tardio: invite_routes depende deste módulo
    try:
        server, invite = await invite_routes.resolve(db, join_in.invite_code)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Código de convite inválido ou expirado.")
    return await invite_routes.accept(db, server, invite, current_user)


@router.get("/{server_id}")
async def get_server_detail(server_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_member(db, server_id, current_user.id)
    return await _server_detail(db, server_id)


@router.patch("/{server_id}", response_model=ServerResponse)
async def update_server(
    server_id: int, update: ServerUpdate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await require_permission(db, server_id, current_user.id, MANAGE_SERVER)
    server = await db.get(Server, server_id)
    for key, value in update.model_dump(exclude_none=True).items():
        setattr(server, key, value.strip())
    await db.commit()
    payload = ServerResponse.model_validate(server)
    hub.send_to_server(server_id, "SERVER_UPDATE", payload.model_dump(mode="json"))
    return payload


@router.post("/{server_id}/invite", response_model=ServerResponse)
async def regenerate_invite(server_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_permission(db, server_id, current_user.id, MANAGE_SERVER)
    server = await db.get(Server, server_id)
    server.invite_code = secrets.token_urlsafe(8)
    await db.commit()
    payload = ServerResponse.model_validate(server)
    hub.send_to_server(server_id, "SERVER_UPDATE", payload.model_dump(mode="json"))
    return payload


@router.delete("/{server_id}")
async def delete_server(server_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Servidor não encontrado.")
    if server.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Apenas o dono pode excluir o servidor.")
    await purge_server(db, server_id)
    return {"ok": True}


async def purge_server(db: AsyncSession, server_id: int) -> None:
    """Apaga o servidor com canais, mensagens e membros, e avisa quem estava nele."""
    channel_ids = select(Channel.id).where(Channel.server_id == server_id)
    await delete_message_extras(db, select(Message.id).where(Message.channel_id.in_(channel_ids)))
    await db.execute(delete(Message).where(Message.channel_id.in_(channel_ids)))
    await db.execute(delete(Channel).where(Channel.server_id == server_id))
    await db.execute(delete(ServerMember).where(ServerMember.server_id == server_id))
    await db.execute(delete(MemberRole).where(MemberRole.server_id == server_id))
    await db.execute(delete(ServerRole).where(ServerRole.server_id == server_id))
    await db.execute(delete(ServerInvite).where(ServerInvite.server_id == server_id))
    await db.execute(delete(Server).where(Server.id == server_id))
    await db.commit()
    members = hub.remove_server(server_id)
    hub.send_to_users(members, "SERVER_DELETE", {"server_id": server_id})


@router.delete("/{server_id}/members/@me")
async def leave_server(server_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    member = await require_member(db, server_id, current_user.id)
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="O dono não pode sair do próprio servidor. Exclua-o ou transfira a posse.")
    await db.execute(delete(MemberRole).where(MemberRole.server_id == server_id, MemberRole.user_id == current_user.id))
    await db.delete(member)
    await db.commit()
    hub.remove_member(server_id, current_user.id)
    hub.send_to_server(server_id, "MEMBER_REMOVE", {"server_id": server_id, "user_id": current_user.id})
    hub.send_to_user(current_user.id, "SERVER_DELETE", {"server_id": server_id})
    return {"ok": True}


@router.delete("/{server_id}/members/{user_id}")
async def kick_member(
    server_id: int, user_id: int,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    access = await require_permission(db, server_id, current_user.id, KICK_MEMBERS)
    target = await require_member(db, server_id, user_id)
    if target.role == "owner":
        raise HTTPException(status_code=403, detail="Não é possível expulsar o dono.")
    if await top_position_of(db, server_id, user_id) >= access.top_position:
        raise HTTPException(status_code=403, detail="Você não pode expulsar alguém com cargo igual ou acima do seu.")
    await db.execute(delete(MemberRole).where(MemberRole.server_id == server_id, MemberRole.user_id == user_id))
    await db.delete(target)
    await db.commit()
    hub.remove_member(server_id, user_id)
    hub.send_to_server(server_id, "MEMBER_REMOVE", {"server_id": server_id, "user_id": user_id})
    hub.send_to_user(user_id, "SERVER_DELETE", {"server_id": server_id})
    return {"ok": True}


@router.post("/{server_id}/channels", response_model=ChannelResponse)
async def create_channel(
    server_id: int, channel_in: ChannelCreate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await require_permission(db, server_id, current_user.id, MANAGE_CHANNELS)
    name = channel_in.name.strip()
    if channel_in.type == "text":
        name = name.lower().replace(" ", "-")
    max_pos = (await db.execute(
        select(func.max(Channel.position)).where(Channel.server_id == server_id)
    )).scalar() or 0
    channel = Channel(server_id=server_id, name=name, type=channel_in.type, position=max_pos + 1)
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    hub.set_channel(channel.id, server_id, channel.type)
    hub.send_to_server(server_id, "CHANNEL_CREATE", _channel_payload(channel))
    return channel


@router.patch("/{server_id}/channels/{channel_id}", response_model=ChannelResponse)
async def rename_channel(
    server_id: int, channel_id: int, update: ChannelUpdate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await require_permission(db, server_id, current_user.id, MANAGE_CHANNELS)
    channel = await db.get(Channel, channel_id)
    if not channel or channel.server_id != server_id:
        raise HTTPException(status_code=404, detail="Canal não encontrado.")
    name = update.name.strip()
    channel.name = name.lower().replace(" ", "-") if channel.type == "text" else name
    await db.commit()
    hub.send_to_server(server_id, "CHANNEL_UPDATE", _channel_payload(channel))
    return channel


@router.delete("/{server_id}/channels/{channel_id}")
async def delete_channel(
    server_id: int, channel_id: int,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await require_permission(db, server_id, current_user.id, MANAGE_CHANNELS)
    channel = await db.get(Channel, channel_id)
    if not channel or channel.server_id != server_id:
        raise HTTPException(status_code=404, detail="Canal não encontrado.")
    await delete_message_extras(db, select(Message.id).where(Message.channel_id == channel_id))
    await db.execute(delete(Message).where(Message.channel_id == channel_id))
    await db.execute(delete(Channel).where(Channel.id == channel_id))
    await db.commit()
    hub.remove_channel(channel_id)
    hub.send_to_server(server_id, "CHANNEL_DELETE", {"server_id": server_id, "channel_id": channel_id})
    return {"ok": True}


# ------------------------------------------------------------------ cargos
async def _broadcast_roles(db: AsyncSession, server_id: int) -> list:
    roles = [_role_payload(r) for r in await server_roles(db, server_id)]
    hub.send_to_server(server_id, "ROLES_UPDATE", {"server_id": server_id, "roles": roles})
    return roles


async def _editable_role(db: AsyncSession, server_id: int, role_id: int, user_id: int):
    access = await require_permission(db, server_id, user_id, MANAGE_ROLES)
    role = await db.get(ServerRole, role_id)
    if not role or role.server_id != server_id:
        raise HTTPException(status_code=404, detail="Cargo não encontrado.")
    if not role.is_default and role.position >= access.top_position:
        raise HTTPException(status_code=403, detail="Você só pode mexer em cargos abaixo do seu cargo mais alto.")
    return access, role


@router.post("/{server_id}/roles")
async def create_role(
    server_id: int, role_in: RoleCreate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    access = await require_permission(db, server_id, current_user.id, MANAGE_ROLES)
    if role_in.permissions & ~access.permissions and access.top_position != OWNER_POSITION:
        raise HTTPException(status_code=403, detail="Você não pode dar permissões que não tem.")
    # O cargo novo entra logo acima do @everyone; os outros sobem uma posição
    for role in await server_roles(db, server_id):
        if not role.is_default:
            role.position += 1
    role = ServerRole(server_id=server_id, position=1, **role_in.model_dump())
    db.add(role)
    await db.commit()
    await db.refresh(role)
    await _broadcast_roles(db, server_id)
    return _role_payload(role)


@router.patch("/{server_id}/roles/{role_id}")
async def update_role(
    server_id: int, role_id: int, update: RoleUpdate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    access, role = await _editable_role(db, server_id, role_id, current_user.id)
    changes = update.model_dump(exclude_none=True)
    if role.is_default:
        changes = {k: v for k, v in changes.items() if k == "permissions"}  # o @everyone só muda permissões
    if "permissions" in changes and access.top_position != OWNER_POSITION:
        granted = changes["permissions"] & ~(role.permissions or 0)
        if granted & ~access.permissions:
            raise HTTPException(status_code=403, detail="Você não pode dar permissões que não tem.")
    for key, value in changes.items():
        setattr(role, key, value)
    await db.commit()
    await _broadcast_roles(db, server_id)
    return _role_payload(role)


@router.delete("/{server_id}/roles/{role_id}")
async def delete_role(
    server_id: int, role_id: int,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    _, role = await _editable_role(db, server_id, role_id, current_user.id)
    if role.is_default:
        raise HTTPException(status_code=400, detail="O cargo @everyone não pode ser excluído.")
    await db.execute(delete(MemberRole).where(MemberRole.role_id == role_id))
    await db.delete(role)
    # Reaproveita as posições para não deixar buracos
    remaining = [r for r in await server_roles(db, server_id) if not r.is_default and r.id != role_id]
    for i, r in enumerate(reversed(remaining)):
        r.position = i + 1
    await db.commit()
    await _broadcast_roles(db, server_id)
    return {"ok": True}


@router.put("/{server_id}/roles/order")
async def reorder_roles(
    server_id: int, order: RoleOrder,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    access = await require_permission(db, server_id, current_user.id, MANAGE_ROLES)
    roles = {r.id: r for r in await server_roles(db, server_id) if not r.is_default}
    if sorted(order.role_ids) != sorted(roles):
        raise HTTPException(status_code=400, detail="A lista precisa conter todos os cargos do servidor.")
    new_positions = {rid: len(order.role_ids) - i for i, rid in enumerate(order.role_ids)}
    # Fora o dono, ninguém mexe nos cargos do seu nível para cima
    for rid, role in roles.items():
        if role.position >= access.top_position and new_positions[rid] != role.position:
            raise HTTPException(status_code=403, detail="Você só pode reorganizar cargos abaixo do seu cargo mais alto.")
        if role.position < access.top_position and new_positions[rid] >= access.top_position:
            raise HTTPException(status_code=403, detail="Você não pode colocar um cargo acima do seu.")
    for rid, pos in new_positions.items():
        roles[rid].position = pos
    await db.commit()
    return {"roles": await _broadcast_roles(db, server_id)}


@router.put("/{server_id}/members/{user_id}/roles")
async def set_member_roles(
    server_id: int, user_id: int, body: MemberRolesUpdate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    access = await require_permission(db, server_id, current_user.id, MANAGE_ROLES)
    await require_member(db, server_id, user_id)
    roles = {r.id: r for r in await server_roles(db, server_id) if not r.is_default}
    wanted = set(body.role_ids)
    if wanted - set(roles):
        raise HTTPException(status_code=400, detail="Cargo inválido para este servidor.")
    current = set((await member_role_ids(db, server_id)).get(user_id, []))
    if user_id != current_user.id and await top_position_of(db, server_id, user_id) >= access.top_position:
        raise HTTPException(status_code=403, detail="Você não pode mudar os cargos de alguém com cargo igual ou acima do seu.")
    for rid in wanted ^ current:  # só os que mudam precisam estar abaixo de você
        if roles[rid].position >= access.top_position:
            raise HTTPException(status_code=403, detail=f"O cargo \"{roles[rid].name}\" está acima do seu.")
    await db.execute(delete(MemberRole).where(MemberRole.server_id == server_id, MemberRole.user_id == user_id))
    db.add_all([MemberRole(server_id=server_id, user_id=user_id, role_id=rid) for rid in wanted])
    await db.commit()
    ids = sorted(wanted, key=lambda r: -roles[r].position)
    hub.send_to_server(server_id, "MEMBER_ROLES_UPDATE", {"server_id": server_id, "user_id": user_id, "role_ids": ids})
    return {"role_ids": ids}


@router.post("/{server_id}/members/{user_id}/disconnect-voice")
async def disconnect_member_voice(
    server_id: int, user_id: int,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    access = await require_permission(db, server_id, current_user.id, MOVE_MEMBERS)
    st = hub.voice_state_of(user_id)
    if not st or st.server_id != server_id:
        raise HTTPException(status_code=400, detail="Essa pessoa não está numa call deste servidor.")
    if user_id != current_user.id and await top_position_of(db, server_id, user_id) >= access.top_position:
        raise HTTPException(status_code=403, detail="Você não pode desconectar alguém com cargo igual ou acima do seu.")
    hub.admin_disconnect_voice(user_id)
    return {"ok": True}
