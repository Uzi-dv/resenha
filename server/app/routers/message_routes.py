import datetime
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_db
from app.deps import require_channel_access
from app.gateway import hub
from app.models import Channel, Message, MessageReaction, Poll, PollOption, PollVote, User
from app.permissions import MANAGE_MESSAGES, get_access
from app.schemas import (
    MAX_REACTION_KINDS, MessageContent, MessageCreate, MessageResponse, PollCreate, PollVoteRequest,
    aggregate_reactions, is_valid_emoji,
)

router = APIRouter(prefix="/api", tags=["messages"])

# Tudo que a serialização de uma mensagem precisa, carregado de uma vez (sem lazy load no async)
MESSAGE_LOAD = (
    selectinload(Message.author),
    selectinload(Message.poll).selectinload(Poll.options),
    selectinload(Message.poll).selectinload(Poll.votes),
    selectinload(Message.reply_to).selectinload(Message.author),
    selectinload(Message.reactions),
)


def _payload(message: Message, server_id: int) -> dict:
    data = MessageResponse.model_validate(message).model_dump(mode="json")
    data["server_id"] = server_id
    return data


async def _load_message(db: AsyncSession, message_id: int) -> Message:
    return (await db.execute(select(Message).options(*MESSAGE_LOAD).where(Message.id == message_id))).scalar_one()


async def delete_message_extras(db: AsyncSession, message_ids) -> None:
    """Apaga o que pendura nas mensagens indicadas (lista ou subquery): reações e enquetes."""
    await db.execute(delete(MessageReaction).where(MessageReaction.message_id.in_(message_ids)))
    poll_ids = select(Poll.id).where(Poll.message_id.in_(message_ids))
    await db.execute(delete(PollVote).where(PollVote.poll_id.in_(poll_ids)))
    await db.execute(delete(PollOption).where(PollOption.poll_id.in_(poll_ids)))
    await db.execute(delete(Poll).where(Poll.message_id.in_(message_ids)))


async def _is_manager(db: AsyncSession, server_id: int, user_id: int) -> bool:
    """Pode apagar mensagens dos outros e encerrar enquetes: permissão "Gerenciar mensagens"."""
    try:
        return (await get_access(db, server_id, user_id)).has(MANAGE_MESSAGES)
    except HTTPException:
        return False


@router.get("/channels/{channel_id}/messages", response_model=List[MessageResponse])
async def get_channel_messages(
    channel_id: int,
    limit: int = Query(50, ge=1, le=100),
    before: Optional[int] = Query(None, description="Retorna mensagens com id menor que este"),
    after: Optional[int] = Query(None, description="Retorna mensagens com id maior que este"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_channel_access(db, channel_id, current_user.id, "text")
    stmt = select(Message).options(*MESSAGE_LOAD).where(Message.channel_id == channel_id)
    if after is not None:
        # Usado para recuperar o que chegou enquanto o cliente estava desconectado
        stmt = stmt.where(Message.id > after).order_by(Message.id.asc()).limit(limit)
        return list((await db.execute(stmt)).scalars().all())
    if before is not None:
        stmt = stmt.where(Message.id < before)
    # Pega as N mais recentes e devolve em ordem cronológica
    rows = (await db.execute(stmt.order_by(Message.id.desc()).limit(limit))).scalars().all()
    return list(reversed(rows))


@router.post("/channels/{channel_id}/messages", response_model=MessageResponse)
async def send_message(
    channel_id: int,
    msg_in: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await require_channel_access(db, channel_id, current_user.id, "text")
    if msg_in.reply_to_id is not None:
        original = await db.get(Message, msg_in.reply_to_id)
        if not original or original.channel_id != channel_id:
            raise HTTPException(status_code=400, detail="A mensagem respondida não está neste canal.")
    message = Message(
        channel_id=channel_id, user_id=current_user.id, content=msg_in.content, reply_to_id=msg_in.reply_to_id,
        attachments=json.dumps([a.model_dump() for a in msg_in.attachments]) if msg_in.attachments else None,
    )
    db.add(message)
    await db.commit()
    message = await _load_message(db, message.id)

    hub.send_to_server(channel.server_id, "MESSAGE_CREATE", _payload(message, channel.server_id))
    return message


async def _get_own_message(db: AsyncSession, channel_id: int, message_id: int, user: User, allow_manager: bool):
    channel = await require_channel_access(db, channel_id, user.id, "text")
    message = (await db.execute(
        select(Message).options(*MESSAGE_LOAD).where(Message.id == message_id, Message.channel_id == channel_id)
    )).scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada.")
    if message.user_id != user.id and not (allow_manager and await _is_manager(db, channel.server_id, user.id)):
        raise HTTPException(status_code=403, detail="Você não pode alterar esta mensagem.")
    return channel, message


@router.patch("/channels/{channel_id}/messages/{message_id}", response_model=MessageResponse)
async def edit_message(
    channel_id: int, message_id: int, msg_in: MessageContent,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    channel, message = await _get_own_message(db, channel_id, message_id, current_user, allow_manager=False)
    if message.poll is not None:
        raise HTTPException(status_code=400, detail="Enquetes não podem ser editadas.")
    message.content = msg_in.content
    message.edited_at = datetime.datetime.utcnow()
    await db.commit()
    message = await _load_message(db, message.id)
    hub.send_to_server(channel.server_id, "MESSAGE_UPDATE", _payload(message, channel.server_id))
    return message


@router.delete("/channels/{channel_id}/messages/{message_id}")
async def delete_message(
    channel_id: int, message_id: int,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    channel, message = await _get_own_message(db, channel_id, message_id, current_user, allow_manager=True)
    await delete_message_extras(db, [message.id])
    await db.execute(delete(Message).where(Message.id == message.id))
    await db.commit()
    hub.send_to_server(channel.server_id, "MESSAGE_DELETE", {
        "server_id": channel.server_id, "channel_id": channel_id, "message_id": message_id,
    })
    return {"ok": True}


# ----------------------------------------------------------------- reações
async def _reaction_target(db: AsyncSession, channel_id: int, message_id: int, user: User, emoji: str):
    if not is_valid_emoji(emoji):
        raise HTTPException(status_code=400, detail="Reação inválida.")
    channel = await require_channel_access(db, channel_id, user.id, "text")
    message = await db.get(Message, message_id)
    if not message or message.channel_id != channel_id:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada.")
    return channel


async def _broadcast_reactions(db: AsyncSession, channel: Channel, message_id: int) -> list:
    rows = (await db.execute(
        select(MessageReaction).where(MessageReaction.message_id == message_id).order_by(MessageReaction.id)
    )).scalars().all()
    reactions = [r.model_dump() for r in aggregate_reactions(rows)]
    hub.send_to_server(channel.server_id, "MESSAGE_REACTIONS", {
        "server_id": channel.server_id, "channel_id": channel.id, "message_id": message_id, "reactions": reactions,
    })
    return reactions


@router.put("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}")
async def add_reaction(
    channel_id: int, message_id: int, emoji: str,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    channel = await _reaction_target(db, channel_id, message_id, current_user, emoji)
    existing = (await db.execute(select(MessageReaction.emoji, MessageReaction.user_id).where(
        MessageReaction.message_id == message_id))).all()
    if any(e == emoji and u == current_user.id for e, u in existing):
        return {"reactions": await _broadcast_reactions(db, channel, message_id)}
    if emoji not in {e for e, _ in existing} and len({e for e, _ in existing}) >= MAX_REACTION_KINDS:
        raise HTTPException(status_code=400, detail=f"Limite de {MAX_REACTION_KINDS} reações diferentes por mensagem.")
    db.add(MessageReaction(message_id=message_id, user_id=current_user.id, emoji=emoji))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()  # clique duplo: a reação já existe
    return {"reactions": await _broadcast_reactions(db, channel, message_id)}


@router.delete("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}")
async def remove_reaction(
    channel_id: int, message_id: int, emoji: str,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    channel = await _reaction_target(db, channel_id, message_id, current_user, emoji)
    await db.execute(delete(MessageReaction).where(
        MessageReaction.message_id == message_id, MessageReaction.user_id == current_user.id,
        MessageReaction.emoji == emoji,
    ))
    await db.commit()
    return {"reactions": await _broadcast_reactions(db, channel, message_id)}


# ----------------------------------------------------------------- enquetes
@router.post("/channels/{channel_id}/polls", response_model=MessageResponse)
async def create_poll(
    channel_id: int, poll_in: PollCreate,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    channel = await require_channel_access(db, channel_id, current_user.id, "text")
    message = Message(channel_id=channel_id, user_id=current_user.id, content=poll_in.question)
    db.add(message)
    await db.flush()
    poll = Poll(message_id=message.id, question=poll_in.question, multiple=poll_in.multiple)
    db.add(poll)
    await db.flush()
    db.add_all([PollOption(poll_id=poll.id, text=text, position=i) for i, text in enumerate(poll_in.options)])
    await db.commit()
    message = await _load_message(db, message.id)
    hub.send_to_server(channel.server_id, "MESSAGE_CREATE", _payload(message, channel.server_id))
    return message


async def _poll_context(db: AsyncSession, poll_id: int, user: User):
    poll = (await db.execute(
        select(Poll).options(selectinload(Poll.options)).where(Poll.id == poll_id)
    )).scalar_one_or_none()
    if not poll:
        raise HTTPException(status_code=404, detail="Enquete não encontrada.")
    message = await db.get(Message, poll.message_id)
    channel = await db.get(Channel, message.channel_id)
    if not hub.is_member(channel.server_id, user.id):
        raise HTTPException(status_code=403, detail="Você não tem acesso a esta enquete.")
    return poll, message, channel


@router.post("/polls/{poll_id}/vote", response_model=MessageResponse)
async def vote_poll(
    poll_id: int, vote_in: PollVoteRequest,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    poll, message, channel = await _poll_context(db, poll_id, current_user)
    if poll.closed:
        raise HTTPException(status_code=400, detail="Esta enquete já foi encerrada.")
    chosen = list(dict.fromkeys(vote_in.option_ids))
    valid_ids = {o.id for o in poll.options}
    if any(oid not in valid_ids for oid in chosen):
        raise HTTPException(status_code=400, detail="Opção inválida para esta enquete.")
    if not poll.multiple and len(chosen) > 1:
        raise HTTPException(status_code=400, detail="Esta enquete aceita só uma opção.")

    # Substitui o voto anterior (lista vazia = retirar voto)
    await db.execute(delete(PollVote).where(PollVote.poll_id == poll.id, PollVote.user_id == current_user.id))
    db.add_all([PollVote(poll_id=poll.id, option_id=oid, user_id=current_user.id) for oid in chosen])
    await db.commit()

    message = await _load_message(db, message.id)
    hub.send_to_server(channel.server_id, "MESSAGE_UPDATE", _payload(message, channel.server_id))
    return message


@router.post("/polls/{poll_id}/close", response_model=MessageResponse)
async def close_poll(
    poll_id: int,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    poll, message, channel = await _poll_context(db, poll_id, current_user)
    if message.user_id != current_user.id and not await _is_manager(db, channel.server_id, current_user.id):
        raise HTTPException(status_code=403, detail="Só quem criou a enquete (ou um administrador) pode encerrá-la.")
    poll.closed = True
    await db.commit()
    message = await _load_message(db, message.id)
    hub.send_to_server(channel.server_id, "MESSAGE_UPDATE", _payload(message, channel.server_id))
    return message
