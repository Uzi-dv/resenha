import datetime
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_db
from app.deps import user_simple
from app.gateway import hub
from app.models import DirectConversation, DirectMessage, DirectMessageReaction, User
from app.schemas import (
    MAX_REACTION_KINDS, DirectMessageResponse, MessageCreate, StartDMRequest, aggregate_reactions, is_valid_emoji,
)

router = APIRouter(prefix="/api/dm", tags=["dm"])

# Tudo que a serialização de uma DM precisa (sem lazy load no async)
DM_LOAD = (
    selectinload(DirectMessage.sender),
    selectinload(DirectMessage.reply_to).selectinload(DirectMessage.sender),
    selectinload(DirectMessage.reactions),
)


def _message_payload(message: DirectMessage) -> dict:
    return DirectMessageResponse.model_validate(message).model_dump(mode="json")


def _conversation_payload(conv: DirectConversation, me: int, last: Optional[DirectMessage]) -> dict:
    recipient = conv.user2 if conv.user1_id == me else conv.user1
    return {
        "id": conv.id,
        "user1_id": conv.user1_id,
        "user2_id": conv.user2_id,
        "created_at": conv.created_at.isoformat(),
        "updated_at": conv.updated_at.isoformat(),
        "recipient": user_simple(recipient),
        "last_message": _message_payload(last) if last else None,
    }


async def _get_conversation(db: AsyncSession, conversation_id: int, user: User) -> DirectConversation:
    conv = await db.get(DirectConversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversa não encontrada.")
    if user.id not in (conv.user1_id, conv.user2_id):
        raise HTTPException(status_code=403, detail="Você não tem acesso a esta conversa.")
    return conv


@router.get("/conversations")
async def list_conversations(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    convs = (await db.execute(
        select(DirectConversation)
        .where((DirectConversation.user1_id == current_user.id) | (DirectConversation.user2_id == current_user.id))
        .options(selectinload(DirectConversation.user1), selectinload(DirectConversation.user2))
        .order_by(DirectConversation.updated_at.desc())
    )).scalars().all()
    if not convs:
        return []

    last_ids = (
        select(func.max(DirectMessage.id))
        .where(DirectMessage.conversation_id.in_([c.id for c in convs]))
        .group_by(DirectMessage.conversation_id)
    )
    last_messages = (await db.execute(
        select(DirectMessage).options(*DM_LOAD).where(DirectMessage.id.in_(last_ids))
    )).scalars().all()
    by_conv = {m.conversation_id: m for m in last_messages}
    return [_conversation_payload(c, current_user.id, by_conv.get(c.id)) for c in convs]


@router.post("/conversations")
async def start_or_get_conversation(
    req: StartDMRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    target = None
    if req.target_user_id:
        target = await db.get(User, req.target_user_id)
    elif req.username:
        target = (await db.execute(
            select(User).where(func.lower(User.username) == req.username.strip().lower())
        )).scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="Usuário destinatário não encontrado.")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Você não pode iniciar uma mensagem direta consigo mesmo.")

    u1, u2 = sorted((current_user.id, target.id))
    query = (
        select(DirectConversation)
        .where(DirectConversation.user1_id == u1, DirectConversation.user2_id == u2)
        .options(selectinload(DirectConversation.user1), selectinload(DirectConversation.user2))
    )
    conv = (await db.execute(query)).scalar_one_or_none()
    if not conv:
        now = datetime.datetime.utcnow()
        db.add(DirectConversation(user1_id=u1, user2_id=u2, created_at=now, updated_at=now))
        await db.commit()
        conv = (await db.execute(query)).scalar_one()
        hub.add_dm_pair(conv.id, u1, u2)

    last = (await db.execute(
        select(DirectMessage).options(*DM_LOAD)
        .where(DirectMessage.conversation_id == conv.id).order_by(DirectMessage.id.desc()).limit(1)
    )).scalar_one_or_none()
    return _conversation_payload(conv, current_user.id, last)


@router.get("/conversations/{conversation_id}/messages", response_model=List[DirectMessageResponse])
async def get_messages(
    conversation_id: int,
    limit: int = Query(50, ge=1, le=100),
    before: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_conversation(db, conversation_id, current_user)
    stmt = (
        select(DirectMessage).options(*DM_LOAD)
        .where(DirectMessage.conversation_id == conversation_id)
    )
    if before is not None:
        stmt = stmt.where(DirectMessage.id < before)
    rows = (await db.execute(stmt.order_by(DirectMessage.id.desc()).limit(limit))).scalars().all()
    return list(reversed(rows))


@router.post("/conversations/{conversation_id}/messages", response_model=DirectMessageResponse)
async def send_message(
    conversation_id: int, msg_in: MessageCreate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    conv = await _get_conversation(db, conversation_id, current_user)
    if msg_in.reply_to_id is not None:
        original = await db.get(DirectMessage, msg_in.reply_to_id)
        if not original or original.conversation_id != conversation_id:
            raise HTTPException(status_code=400, detail="A mensagem respondida não está nesta conversa.")
    now = datetime.datetime.utcnow()
    message = DirectMessage(
        conversation_id=conversation_id, sender_id=current_user.id, content=msg_in.content, created_at=now,
        reply_to_id=msg_in.reply_to_id,
        attachments=json.dumps([a.model_dump() for a in msg_in.attachments]) if msg_in.attachments else None,
    )
    db.add(message)
    conv.updated_at = now
    await db.commit()
    message = (await db.execute(
        select(DirectMessage).options(*DM_LOAD).where(DirectMessage.id == message.id)
    )).scalar_one()

    payload = _message_payload(message)
    hub.send_to_users(
        {conv.user1_id, conv.user2_id}, "DM_MESSAGE_CREATE",
        {"conversation_id": conversation_id, "message": payload},
    )
    return message


# ----------------------------------------------------------------- reações
async def _dm_reaction_target(db: AsyncSession, conversation_id: int, message_id: int, user: User, emoji: str):
    if not is_valid_emoji(emoji):
        raise HTTPException(status_code=400, detail="Reação inválida.")
    conv = await _get_conversation(db, conversation_id, user)
    message = await db.get(DirectMessage, message_id)
    if not message or message.conversation_id != conversation_id:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada.")
    return conv


async def _broadcast_dm_reactions(db: AsyncSession, conv: DirectConversation, message_id: int) -> list:
    rows = (await db.execute(
        select(DirectMessageReaction).where(DirectMessageReaction.message_id == message_id)
        .order_by(DirectMessageReaction.id)
    )).scalars().all()
    reactions = [r.model_dump() for r in aggregate_reactions(rows)]
    hub.send_to_users({conv.user1_id, conv.user2_id}, "DM_MESSAGE_REACTIONS", {
        "conversation_id": conv.id, "message_id": message_id, "reactions": reactions,
    })
    return reactions


@router.put("/conversations/{conversation_id}/messages/{message_id}/reactions/{emoji}")
async def add_reaction(
    conversation_id: int, message_id: int, emoji: str,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    conv = await _dm_reaction_target(db, conversation_id, message_id, current_user, emoji)
    existing = (await db.execute(select(DirectMessageReaction.emoji, DirectMessageReaction.user_id).where(
        DirectMessageReaction.message_id == message_id))).all()
    kinds = {e for e, _ in existing}
    if not any(e == emoji and u == current_user.id for e, u in existing):
        if emoji not in kinds and len(kinds) >= MAX_REACTION_KINDS:
            raise HTTPException(status_code=400, detail=f"Limite de {MAX_REACTION_KINDS} reações diferentes por mensagem.")
        db.add(DirectMessageReaction(message_id=message_id, user_id=current_user.id, emoji=emoji))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
    return {"reactions": await _broadcast_dm_reactions(db, conv, message_id)}


@router.delete("/conversations/{conversation_id}/messages/{message_id}/reactions/{emoji}")
async def remove_reaction(
    conversation_id: int, message_id: int, emoji: str,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    conv = await _dm_reaction_target(db, conversation_id, message_id, current_user, emoji)
    await db.execute(delete(DirectMessageReaction).where(
        DirectMessageReaction.message_id == message_id, DirectMessageReaction.user_id == current_user.id,
        DirectMessageReaction.emoji == emoji,
    ))
    await db.commit()
    return {"reactions": await _broadcast_dm_reactions(db, conv, message_id)}
