from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway import hub
from app.models import Channel, ServerMember, User
from app.schemas import UserSimple


async def require_member(db: AsyncSession, server_id: int, user_id: int) -> ServerMember:
    member = (await db.execute(
        select(ServerMember).where(ServerMember.server_id == server_id, ServerMember.user_id == user_id)
    )).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="Você não é membro deste servidor.")
    return member


async def require_channel_access(db: AsyncSession, channel_id: int, user_id: int, channel_type: str = None) -> Channel:
    channel = await db.get(Channel, channel_id)
    if not channel or (channel_type and channel.type != channel_type):
        raise HTTPException(status_code=404, detail="Canal não encontrado.")
    if not hub.is_member(channel.server_id, user_id):
        raise HTTPException(status_code=403, detail="Você não tem acesso a este canal.")
    return channel


def user_simple(user: User) -> dict:
    """Serializa um usuário com a presença efetiva calculada pelo gateway."""
    return UserSimple.model_validate(user).model_dump(mode="json")
