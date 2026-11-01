import json
from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

PresenceChoice = Literal["online", "idle", "dnd", "invisible"]


def clean_username(v: str) -> str:
    v = " ".join(v.split())  # tira espaços nas pontas e colapsa espaços repetidos
    if len(v) < 2:
        raise ValueError("O nome de usuário precisa ter pelo menos 2 caracteres.")
    if len(v) > 32:
        raise ValueError("O nome de usuário pode ter no máximo 32 caracteres.")
    if any(not ch.isprintable() for ch in v):
        raise ValueError("O nome de usuário tem caracteres inválidos.")
    return v


# --- USUÁRIOS ---
class UserRegister(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    avatar_url: Optional[str] = ""
    banner_url: Optional[str] = ""

    @field_validator("username")
    @classmethod
    def valid_username(cls, v: str) -> str:
        return clean_username(v)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class EmailOnly(BaseModel):
    email: EmailStr


class VerifyEmail(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ResetPassword(VerifyEmail):
    password: str = Field(min_length=6, max_length=128)


class VerificationRequired(BaseModel):
    """Resposta de cadastro/login quando falta confirmar o e-mail (o app pede o código)."""
    verification_required: bool = True
    email: str


class UserUpdate(BaseModel):
    username: Optional[str] = Field(default=None, max_length=64)
    bio: Optional[str] = Field(default=None, max_length=255)
    custom_status: Optional[str] = Field(default=None, max_length=100)
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    banner_url: Optional[str] = Field(default=None, max_length=500)
    presence: Optional[PresenceChoice] = None

    @field_validator("username")
    @classmethod
    def valid_username(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else clean_username(v)

    @field_validator("avatar_url", "banner_url")
    @classmethod
    def valid_image_url(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if v and not (v.startswith(("http://", "https://")) or v.startswith("/uploads/")):
            raise ValueError("Use um link http(s) ou envie uma imagem do computador.")
        return v


class UserSimple(BaseModel):
    """Dados públicos mínimos (autor de mensagem, membro, participante)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    avatar_url: Optional[str] = ""
    banner_url: Optional[str] = ""
    custom_status: Optional[str] = ""
    presence: Optional[str] = "offline"

    @model_validator(mode="after")
    def effective_presence(self):
        # Nunca expõe o status escolhido (ex.: "invisible"); usa o calculado pelo gateway
        from app.gateway import hub
        self.presence = hub.presence_of(self.id)
        return self


class UserPublic(UserSimple):
    bio: Optional[str] = ""
    created_at: datetime


class UserResponse(BaseModel):
    """Dados do próprio usuário autenticado (inclui e-mail e status escolhido)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    avatar_url: Optional[str] = ""
    banner_url: Optional[str] = ""
    bio: Optional[str] = ""
    custom_status: Optional[str] = ""
    presence: Optional[str] = "online"
    created_at: datetime
    is_superadmin: bool = False

    @field_validator("is_superadmin", mode="before")
    @classmethod
    def none_is_false(cls, v):
        return bool(v)


class AdminRename(BaseModel):
    username: str

    @field_validator("username")
    @classmethod
    def clean(cls, v: str) -> str:
        return clean_username(v)


class AdminBan(BaseModel):
    banned: bool


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


# --- MENSAGENS DIRETAS (DMs) ---
class StartDMRequest(BaseModel):
    target_user_id: Optional[int] = None
    username: Optional[str] = None


class MessageContent(BaseModel):
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A mensagem não pode estar vazia.")
        return v


# --- Anexos, respostas e reações (canais e DMs) ---
MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
MAX_ATTACHMENTS = 10


class Attachment(BaseModel):
    # Só arquivos enviados ao próprio servidor (/api/upload/attachment), nunca URLs externas
    url: str = Field(pattern=r"^/uploads/[0-9a-f]{32}\.(png|jpg|jpeg|webp|gif)$")
    name: str = Field(default="", max_length=200)
    size: int = Field(default=0, ge=0, le=MAX_ATTACHMENT_BYTES)
    width: Optional[int] = Field(default=None, ge=1, le=20000)
    height: Optional[int] = Field(default=None, ge=1, le=20000)


class MessageCreate(BaseModel):
    content: str = Field(default="", max_length=4000)
    reply_to_id: Optional[int] = None
    attachments: List[Attachment] = Field(default_factory=list, max_length=MAX_ATTACHMENTS)

    @field_validator("content")
    @classmethod
    def strip_content(cls, v: str) -> str:
        return v.strip()

    @model_validator(mode="after")
    def content_or_attachment(self):
        if not self.content and not self.attachments:
            raise ValueError("A mensagem não pode estar vazia.")
        return self


class ReplyPreview(BaseModel):
    id: int
    user_id: int
    author: "UserSimple"
    content: str
    has_attachments: bool = False


class ReactionOut(BaseModel):
    emoji: str
    count: int
    users: List[int]


def parse_attachments(v):
    if v is None or v == "":
        return []
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return []
    return v


def reply_preview(v, author_attr: str, user_attr: str):
    """Converte a mensagem respondida (ORM) num resumo curto; None se não houver/foi apagada."""
    if v is None or isinstance(v, (dict, ReplyPreview)):
        return v
    return ReplyPreview(
        id=v.id,
        user_id=getattr(v, user_attr),
        author=UserSimple.model_validate(getattr(v, author_attr)),
        content=(v.content or "")[:200],
        has_attachments=bool(parse_attachments(v.attachments)),
    )


MAX_REACTION_KINDS = 20


def is_valid_emoji(emoji: str) -> bool:
    """Aceita emojis Unicode (inclusive combinados, como 👍🏽 ou 👨‍👩‍👧). Recusa texto comum."""
    if not emoji or len(emoji) > 16:
        return False
    if any(c.isspace() or (c.isascii() and c not in "#*0123456789") for c in emoji):
        return False
    return any(ord(c) > 0x2000 for c in emoji)


def aggregate_reactions(v):
    """Linhas de reação (ORM) → [{emoji, count, users}] na ordem da primeira reação de cada emoji."""
    if not v:
        return []
    if isinstance(v[0], (dict, ReactionOut)):
        return v
    grouped = {}
    for r in v:
        grouped.setdefault(r.emoji, []).append(r.user_id)
    return [ReactionOut(emoji=e, count=len(users), users=users) for e, users in grouped.items()]


class DirectMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    sender_id: int
    content: str
    created_at: datetime
    edited_at: Optional[datetime] = None
    sender: UserSimple
    reply_to_id: Optional[int] = None
    reply_to: Optional[ReplyPreview] = None
    attachments: List[Attachment] = Field(default_factory=list)
    reactions: List[ReactionOut] = Field(default_factory=list)

    @field_validator("attachments", mode="before")
    @classmethod
    def attachments_from_json(cls, v):
        return parse_attachments(v)

    @field_validator("reactions", mode="before")
    @classmethod
    def reactions_from_orm(cls, v):
        return aggregate_reactions(v)

    @field_validator("reply_to", mode="before")
    @classmethod
    def reply_from_orm(cls, v):
        return reply_preview(v, "sender", "sender_id")


class DirectConversationResponse(BaseModel):
    id: int
    user1_id: int
    user2_id: int
    created_at: datetime
    updated_at: datetime
    recipient: UserSimple
    last_message: Optional[DirectMessageResponse] = None


# --- CANAIS ---
class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    type: Literal["text", "voice"] = "text"


class ChannelUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class ChannelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    server_id: int
    name: str
    type: str
    position: int
    created_at: datetime


# --- SERVIDORES ---
class ServerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    icon_url: Optional[str] = ""


class ServerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    icon_url: Optional[str] = Field(default=None, max_length=500)


class ServerJoin(BaseModel):
    invite_code: str


class InviteCreate(BaseModel):
    max_age: int = 604800  # segundos; 0 = nunca expira (padrão: 7 dias)
    max_uses: int = 0  # 0 = sem limite


class ServerOrder(BaseModel):
    server_ids: List[int] = Field(max_length=200)


class ServerMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    server_id: int
    user_id: int
    role: str
    joined_at: datetime
    user: UserSimple


class ServerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    icon_url: Optional[str] = ""
    owner_id: int
    invite_code: str
    created_at: datetime


HEX_COLOR = r"^(#[0-9a-fA-F]{6})?$"


class RoleCreate(BaseModel):
    name: str = Field(default="novo cargo", min_length=1, max_length=32)
    color: str = Field(default="", pattern=HEX_COLOR)
    hoist: bool = False
    permissions: int = Field(default=0, ge=0, le=(1 << 7) - 1)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v or v.lower() == "@everyone":
            raise ValueError("Escolha outro nome para o cargo.")
        return v


class RoleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=32)
    color: Optional[str] = Field(default=None, pattern=HEX_COLOR)
    hoist: Optional[bool] = None
    permissions: Optional[int] = Field(default=None, ge=0, le=(1 << 7) - 1)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v):
        if v is None:
            return v
        v = " ".join(v.split())
        if not v or v.lower() == "@everyone":
            raise ValueError("Escolha outro nome para o cargo.")
        return v


class RoleOrder(BaseModel):
    role_ids: List[int] = Field(max_length=250)  # do mais alto para o mais baixo (sem o @everyone)


class MemberRolesUpdate(BaseModel):
    role_ids: List[int] = Field(default_factory=list, max_length=250)


class ServerDetailResponse(ServerResponse):
    channels: List[ChannelResponse] = []
    members: List[ServerMemberResponse] = []
    voice_states: List[dict] = []


# --- ENQUETES ---
class PollOptionOut(BaseModel):
    id: int
    text: str
    votes: int
    voters: List[int]


class PollOut(BaseModel):
    id: int
    question: str
    multiple: bool
    closed: bool
    total_voters: int
    options: List[PollOptionOut]

    @classmethod
    def from_poll(cls, poll) -> "PollOut":
        voters_by_option = {}
        for vote in poll.votes:
            voters_by_option.setdefault(vote.option_id, []).append(vote.user_id)
        return cls(
            id=poll.id,
            question=poll.question,
            multiple=bool(poll.multiple),
            closed=bool(poll.closed),
            total_voters=len({v.user_id for v in poll.votes}),
            options=[
                PollOptionOut(id=o.id, text=o.text, votes=len(voters_by_option.get(o.id, [])),
                              voters=voters_by_option.get(o.id, []))
                for o in poll.options
            ],
        )


class PollCreate(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    options: List[str] = Field(min_length=2, max_length=10)
    multiple: bool = False

    @field_validator("question")
    @classmethod
    def clean_question(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A pergunta não pode ficar vazia.")
        return v

    @field_validator("options")
    @classmethod
    def clean_options(cls, v: List[str]) -> List[str]:
        cleaned = [o.strip() for o in v if o.strip()]
        if len(cleaned) < 2:
            raise ValueError("A enquete precisa de pelo menos 2 opções.")
        if any(len(o) > 100 for o in cleaned):
            raise ValueError("Cada opção pode ter no máximo 100 caracteres.")
        if len({o.lower() for o in cleaned}) != len(cleaned):
            raise ValueError("As opções não podem se repetir.")
        return cleaned


class PollVoteRequest(BaseModel):
    option_ids: List[int] = Field(default_factory=list, max_length=10)


# --- MENSAGENS ---
class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    channel_id: int
    user_id: int
    content: str
    created_at: datetime
    edited_at: Optional[datetime] = None
    author: UserSimple
    poll: Optional[PollOut] = None
    reply_to_id: Optional[int] = None
    reply_to: Optional[ReplyPreview] = None
    attachments: List[Attachment] = Field(default_factory=list)
    reactions: List[ReactionOut] = Field(default_factory=list)

    @field_validator("attachments", mode="before")
    @classmethod
    def attachments_from_json(cls, v):
        return parse_attachments(v)

    @field_validator("reactions", mode="before")
    @classmethod
    def reactions_from_orm(cls, v):
        return aggregate_reactions(v)

    @field_validator("reply_to", mode="before")
    @classmethod
    def reply_from_orm(cls, v):
        return reply_preview(v, "author", "user_id")

    @field_validator("poll", mode="before")
    @classmethod
    def poll_from_orm(cls, v):
        if v is None or isinstance(v, (dict, PollOut)):
            return v
        return PollOut.from_poll(v)


# --- RTC (Cloudflare Realtime proxy) ---
TrackKind = Literal["mic", "screen", "screen_audio", "camera"]


class SessionDescription(BaseModel):
    type: Literal["offer", "answer"]
    sdp: str


class PublishTrack(BaseModel):
    mid: str
    kind: TrackKind


class PublishRequest(BaseModel):
    offer: SessionDescription
    tracks: List[PublishTrack] = Field(min_length=1, max_length=4)


class UnpublishRequest(BaseModel):
    offer: SessionDescription
    tracks: List[PublishTrack] = Field(min_length=1, max_length=4)
    # True: a track já foi republicada (troca de codec); só fecha o transceiver antigo
    replaced: bool = False


class SubscribeTrack(BaseModel):
    user_id: int
    kind: TrackKind


class SubscribeRequest(BaseModel):
    tracks: List[SubscribeTrack] = Field(min_length=1, max_length=16)


class UnsubscribeRequest(BaseModel):
    offer: SessionDescription
    mids: List[str] = Field(min_length=1, max_length=32)


class RenegotiateRequest(BaseModel):
    answer: SessionDescription
