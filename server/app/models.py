import datetime
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


def utcnow():
    return datetime.datetime.utcnow()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    avatar_url = Column(String(500), default="")
    banner_url = Column(String(500), default="")
    bio = Column(String(255), default="Olá! Estou usando o Resenha.")
    custom_status = Column(String(100), default="")
    # Status *escolhido* pelo usuário: online, idle, dnd, invisible.
    # O status efetivo (offline quando desconectado) é calculado pelo gateway.
    presence = Column(String(20), default="online")
    created_at = Column(DateTime, default=utcnow)
    # Super admin: moderação em todo o Resenha (definido por scripts/superadmin.py, nunca pela API)
    is_superadmin = Column(Boolean, default=False)
    banned = Column(Boolean, default=False)  # conta suspensa: não entra nem conecta
    # Contas anteriores aos e-mails ficam confirmadas (a migração usa DEFAULT 1); novas começam em False
    email_verified = Column(Boolean, default=False)
    # Tokens emitidos antes disto deixam de valer (troca de senha encerra as outras sessões)
    password_changed_at = Column(DateTime, nullable=True)

    servers_owned = relationship("Server", back_populates="owner", cascade="all, delete-orphan")
    memberships = relationship("ServerMember", back_populates="user", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="author", cascade="all, delete-orphan")


class EmailCode(Base):
    """Código de 6 dígitos enviado por e-mail (confirmar cadastro ou redefinir senha). Guardado só o hash."""
    __tablename__ = "email_codes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    purpose = Column(String(10), nullable=False)  # verify, reset
    code_hash = Column(String(64), nullable=False)
    attempts = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime, nullable=False)


class Server(Base):
    __tablename__ = "servers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    icon_url = Column(String(500), default="")
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    invite_code = Column(String(20), unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=utcnow)

    owner = relationship("User", back_populates="servers_owned")
    members = relationship("ServerMember", back_populates="server", cascade="all, delete-orphan")
    channels = relationship(
        "Channel", back_populates="server", cascade="all, delete-orphan",
        order_by="(Channel.position, Channel.id)",
    )


class ServerInvite(Base):
    """Convite em link (seu-dominio.com/convite/<code>). O Server.invite_code antigo continua valendo como permanente."""
    __tablename__ = "server_invites"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(16), unique=True, index=True, nullable=False)
    server_id = Column(Integer, ForeignKey("servers.id"), nullable=False, index=True)
    inviter_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    max_age = Column(Integer, default=0)  # segundos escolhidos ao criar (0 = nunca expira)
    expires_at = Column(DateTime, nullable=True)  # None = nunca
    max_uses = Column(Integer, default=0)  # 0 = sem limite
    uses = Column(Integer, default=0)
    revoked_at = Column(DateTime, nullable=True)


class AppMeta(Base):
    """Marcadores de migrações de dados que só podem rodar uma vez."""
    __tablename__ = "app_meta"

    key = Column(String(64), primary_key=True)
    value = Column(String(255), default="")


class ServerMember(Base):
    __tablename__ = "server_members"
    __table_args__ = (Index("ix_server_members_server_user", "server_id", "user_id"),)

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("servers.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String(20), default="member")  # owner, admin, member
    joined_at = Column(DateTime, default=utcnow)
    position = Column(Integer, default=0)  # ordem do servidor na barra lateral deste usuário

    server = relationship("Server", back_populates="members")
    user = relationship("User", back_populates="memberships")


class ServerRole(Base):
    """Cargo de um servidor. position maior = mais alto na hierarquia; @everyone é o padrão (posição 0)."""
    __tablename__ = "server_roles"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("servers.id"), nullable=False, index=True)
    name = Column(String(32), nullable=False)
    color = Column(String(9), default="")  # "#rrggbb" ou vazio (sem cor)
    position = Column(Integer, default=1)
    hoist = Column(Boolean, default=False)  # aparece separado na lista de membros
    permissions = Column(Integer, default=0)  # bits de app/permissions.py
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class MemberRole(Base):
    __tablename__ = "member_roles"
    __table_args__ = (UniqueConstraint("server_id", "user_id", "role_id", name="uq_member_role"),)

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("servers.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role_id = Column(Integer, ForeignKey("server_roles.id"), nullable=False, index=True)


class Channel(Base):
    __tablename__ = "channels"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("servers.id"), nullable=False)
    name = Column(String(50), nullable=False)
    type = Column(String(20), default="text")  # "text" ou "voice"
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)

    server = relationship("Server", back_populates="channels")
    messages = relationship("Message", back_populates="channel", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_channel_id_id", "channel_id", "id"),)

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    edited_at = Column(DateTime, nullable=True)
    # Sem FK de propósito: a original pode ser apagada e a resposta continua ("mensagem apagada")
    reply_to_id = Column(Integer, nullable=True)
    attachments = Column(Text, nullable=True)  # JSON: [{url, name, size, width, height}]

    channel = relationship("Channel", back_populates="messages")
    author = relationship("User", back_populates="messages")
    poll = relationship("Poll", back_populates="message", uselist=False)
    reply_to = relationship(
        "Message", primaryjoin="foreign(Message.reply_to_id) == remote(Message.id)", uselist=False, viewonly=True,
    )
    reactions = relationship("MessageReaction", order_by="MessageReaction.id", viewonly=True)


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_reaction"),)

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    emoji = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=utcnow)


class Poll(Base):
    __tablename__ = "polls"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=False, unique=True, index=True)
    question = Column(String(300), nullable=False)
    multiple = Column(Boolean, default=False)
    closed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)

    message = relationship("Message", back_populates="poll")
    options = relationship("PollOption", order_by="PollOption.position")
    votes = relationship("PollVote")


class PollOption(Base):
    __tablename__ = "poll_options"

    id = Column(Integer, primary_key=True, index=True)
    poll_id = Column(Integer, ForeignKey("polls.id"), nullable=False, index=True)
    text = Column(String(100), nullable=False)
    position = Column(Integer, default=0)


class PollVote(Base):
    __tablename__ = "poll_votes"
    __table_args__ = (UniqueConstraint("option_id", "user_id", name="uq_poll_vote_option_user"),)

    id = Column(Integer, primary_key=True, index=True)
    poll_id = Column(Integer, ForeignKey("polls.id"), nullable=False, index=True)
    option_id = Column(Integer, ForeignKey("poll_options.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)


class DirectConversation(Base):
    __tablename__ = "direct_conversations"

    id = Column(Integer, primary_key=True, index=True)
    user1_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    user2_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow)

    user1 = relationship("User", foreign_keys=[user1_id])
    user2 = relationship("User", foreign_keys=[user2_id])
    messages = relationship(
        "DirectMessage", back_populates="conversation", cascade="all, delete-orphan",
        order_by="DirectMessage.id",
    )


class DirectMessage(Base):
    __tablename__ = "direct_messages"
    __table_args__ = (Index("ix_direct_messages_conv_id_id", "conversation_id", "id"),)

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("direct_conversations.id"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    edited_at = Column(DateTime, nullable=True)
    reply_to_id = Column(Integer, nullable=True)
    attachments = Column(Text, nullable=True)

    conversation = relationship("DirectConversation", back_populates="messages")
    sender = relationship("User")
    reply_to = relationship(
        "DirectMessage", primaryjoin="foreign(DirectMessage.reply_to_id) == remote(DirectMessage.id)",
        uselist=False, viewonly=True,
    )
    reactions = relationship("DirectMessageReaction", order_by="DirectMessageReaction.id", viewonly=True)


class DirectMessageReaction(Base):
    __tablename__ = "direct_message_reactions"
    __table_args__ = (UniqueConstraint("message_id", "user_id", "emoji", name="uq_dm_reaction"),)

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("direct_messages.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    emoji = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=utcnow)
