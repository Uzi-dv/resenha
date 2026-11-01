"""Moderação do super admin: ver quem está onde, tirar da call, encerrar sessões, suspender, renomear e excluir contas."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_superadmin
from app.database import get_db
from app.gateway import hub
from app.models import (
    Channel, DirectConversation, DirectMessage, DirectMessageReaction, EmailCode, MemberRole, Message, MessageReaction,
    PollVote, Server, ServerInvite, ServerMember, User,
)
from app.routers.message_routes import delete_message_extras
from app.routers.server_routes import purge_server
from app.schemas import AdminBan, AdminRename, ServerResponse

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _voice_info(user_id: int, servers: dict, channels: dict):
    st = hub.voice_state_of(user_id)
    if not st:
        return None
    return {
        "server_id": st.server_id,
        "server_name": servers.get(st.server_id, ""),
        "channel_id": st.channel_id,
        "channel_name": channels.get(st.channel_id, ""),
        "muted": st.muted,
        "deafened": st.deafened,
        "sharing_screen": bool(st.tracks.get("screen")),
        "camera": bool(st.tracks.get("camera")),
    }


async def _target(db: AsyncSession, user_id: int, admin: User, action: str) -> User:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail=f"Você não pode {action} a si mesmo.")
    if user.is_superadmin:
        raise HTTPException(status_code=403, detail="Não é possível moderar outro super admin.")
    return user


@router.get("/users")
async def list_users(_: User = Depends(get_superadmin), db: AsyncSession = Depends(get_db)):
    users = (await db.execute(select(User).order_by(func.lower(User.username)))).scalars().all()
    servers = dict((await db.execute(select(Server.id, Server.name))).all())
    channels = dict((await db.execute(select(Channel.id, Channel.name))).all())
    counts = dict((await db.execute(
        select(ServerMember.user_id, func.count()).group_by(ServerMember.user_id)
    )).all())
    owned = dict((await db.execute(select(Server.owner_id, func.count()).group_by(Server.owner_id))).all())
    return [
        {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "avatar_url": u.avatar_url or "",
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "presence": hub.presence_of(u.id),
            "connections": len(hub.user_conns.get(u.id, ())),
            "is_superadmin": bool(u.is_superadmin),
            "banned": bool(u.banned),
            "email_verified": u.email_verified is not False,
            "servers": counts.get(u.id, 0),
            "owned_servers": owned.get(u.id, 0),
            "voice": _voice_info(u.id, servers, channels),
        }
        for u in users
    ]


@router.get("/servers")
async def list_servers(_: User = Depends(get_superadmin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Server, User.username).join(User, User.id == Server.owner_id).order_by(Server.id))).all()
    counts = dict((await db.execute(select(ServerMember.server_id, func.count()).group_by(ServerMember.server_id))).all())
    in_voice = {}
    for st in hub.voice.values():
        in_voice[st.server_id] = in_voice.get(st.server_id, 0) + 1
    return [
        {
            "id": s.id,
            "name": s.name,
            "icon_url": s.icon_url or "",
            "owner": owner,
            "members": counts.get(s.id, 0),
            "online": sum(1 for uid in hub.server_members.get(s.id, ()) if hub.presence_of(uid) != "offline"),
            "in_voice": in_voice.get(s.id, 0),
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s, owner in rows
    ]


@router.post("/users/{user_id}/disconnect-voice")
async def disconnect_voice(user_id: int, admin: User = Depends(get_superadmin), db: AsyncSession = Depends(get_db)):
    await _target(db, user_id, admin, "desconectar")
    if not hub.admin_disconnect_voice(user_id):
        raise HTTPException(status_code=400, detail="Essa pessoa não está em nenhuma call.")
    return {"ok": True}


@router.post("/users/{user_id}/revoke-sessions")
async def revoke_sessions(user_id: int, admin: User = Depends(get_superadmin), db: AsyncSession = Depends(get_db)):
    await _target(db, user_id, admin, "desconectar")
    closed = hub.revoke_sessions(user_id, "Sua sessão foi encerrada por um administrador. Entre de novo para continuar.")
    return {"ok": True, "closed": closed}


@router.post("/users/{user_id}/ban")
async def set_ban(user_id: int, body: AdminBan, admin: User = Depends(get_superadmin), db: AsyncSession = Depends(get_db)):
    user = await _target(db, user_id, admin, "suspender")
    user.banned = body.banned
    await db.commit()
    await db.refresh(user)
    hub.upsert_user(user)
    if body.banned:
        hub.revoke_sessions(user_id, "Sua conta foi suspensa por um administrador.")
    return {"ok": True, "banned": bool(user.banned)}


@router.patch("/users/{user_id}")
async def rename_user(user_id: int, body: AdminRename, admin: User = Depends(get_superadmin), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    taken = (await db.execute(
        select(User.id).where(func.lower(User.username) == body.username.lower(), User.id != user_id)
    )).first()
    if taken:
        raise HTTPException(status_code=400, detail="Este nome de usuário já está em uso.")
    user.username = body.username
    await db.commit()
    await db.refresh(user)
    hub.upsert_user(user)
    hub.broadcast_user_update(user_id)
    hub.send_to_user(user_id, "USER_UPDATE", hub.public_user(user_id))
    return {"ok": True, "username": user.username}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, admin: User = Depends(get_superadmin), db: AsyncSession = Depends(get_db)):
    """Exclui a conta de vez: mensagens, reações, DMs e participação em servidores.
    Servidores criados por ela passam para o membro mais antigo; sem ninguém, são apagados."""
    await _target(db, user_id, admin, "excluir")
    hub.revoke_sessions(user_id, "Sua conta foi excluída por um administrador.")

    transferred, emptied = [], []
    for server in (await db.execute(select(Server).where(Server.owner_id == user_id))).scalars().all():
        heir = (await db.execute(
            select(ServerMember)
            .where(ServerMember.server_id == server.id, ServerMember.user_id != user_id)
            .order_by(ServerMember.joined_at, ServerMember.id)
            .limit(1)
        )).scalar_one_or_none()
        if heir:
            server.owner_id = heir.user_id
            heir.role = "owner"
            transferred.append(server)
        else:
            emptied.append(server.id)
    for server_id in emptied:
        await purge_server(db, server_id)

    await delete_message_extras(db, select(Message.id).where(Message.user_id == user_id))
    await db.execute(delete(Message).where(Message.user_id == user_id))
    await db.execute(delete(MessageReaction).where(MessageReaction.user_id == user_id))
    await db.execute(delete(PollVote).where(PollVote.user_id == user_id))
    member_of = (await db.execute(select(ServerMember.server_id).where(ServerMember.user_id == user_id))).scalars().all()
    await db.execute(delete(MemberRole).where(MemberRole.user_id == user_id))
    await db.execute(delete(ServerMember).where(ServerMember.user_id == user_id))

    convs = select(DirectConversation.id).where(
        or_(DirectConversation.user1_id == user_id, DirectConversation.user2_id == user_id)
    )
    dm_ids = select(DirectMessage.id).where(DirectMessage.conversation_id.in_(convs))
    await db.execute(delete(DirectMessageReaction).where(
        or_(DirectMessageReaction.message_id.in_(dm_ids), DirectMessageReaction.user_id == user_id)
    ))
    await db.execute(delete(DirectMessage).where(DirectMessage.conversation_id.in_(convs)))
    await db.execute(delete(DirectConversation).where(
        or_(DirectConversation.user1_id == user_id, DirectConversation.user2_id == user_id)
    ))
    await db.execute(delete(EmailCode).where(EmailCode.user_id == user_id))
    await db.execute(delete(ServerInvite).where(ServerInvite.inviter_id == user_id))
    await db.execute(delete(User).where(User.id == user_id))
    await db.commit()

    audience = hub.remove_user(user_id)
    for server in transferred:
        hub.send_to_server(server.id, "SERVER_UPDATE", ServerResponse.model_validate(server).model_dump(mode="json"))
    for server_id in member_of:
        hub.send_to_server(server_id, "MEMBER_REMOVE", {"server_id": server_id, "user_id": user_id})
    # Quem já tinha o app aberto tira as mensagens e a DM dessa pessoa da tela
    hub.send_to_users(audience, "USER_DELETE", {"user_id": user_id})
    return {"ok": True, "transferred": len(transferred), "deleted_servers": len(emptied)}


@router.delete("/servers/{server_id}")
async def delete_server(server_id: int, _: User = Depends(get_superadmin), db: AsyncSession = Depends(get_db)):
    if not await db.get(Server, server_id):
        raise HTTPException(status_code=404, detail="Servidor não encontrado.")
    await purge_server(db, server_id)
    return {"ok": True}
