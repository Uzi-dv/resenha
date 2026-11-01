"""
Gateway em tempo real do Resenha.

Responsabilidades:
- Conexões WebSocket com fila de envio própria (um cliente lento nunca trava os outros).
- Presença efetiva (online/idle/dnd/offline) calculada a partir das conexões ativas.
- Estado de voz autoritativo: quem está em qual canal, mute/deafen e quais tracks
  cada um publica no SFU da Cloudflare, além dos codecs de vídeo em hardware de cada
  cliente e de quem assiste cada transmissão (o publicador escolhe o codec com isso).
- Eventos são enviados apenas para quem compartilha um servidor com o usuário.

Protocolo (JSON):
  cliente → servidor: {"op": "<nome>", ...campos}
  servidor → cliente: {"t": "<EVENTO>", "d": {...}}
"""
import asyncio
import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Dict, Iterable, Optional, Set

from sqlalchemy import select

from app.auth import tokens_valid_after
from app.config import VOICE_RECONNECT_GRACE_SECONDS
from app.database import AsyncSessionLocal
from app.models import Channel, DirectConversation, Server, ServerMember, User

logger = logging.getLogger("resenha.gateway")

HEARTBEAT_INTERVAL_MS = 15000
TYPING_THROTTLE_SECONDS = 2.5
# Codecs de vídeo que os clientes declaram ter em hardware (ordem de preferência no cliente)
VIDEO_CODECS = ("AV1", "H265", "H264")
VIDEO_KINDS = ("screen", "camera")
MAX_WATCHING = 32


def _codec_list(value) -> list:
    if not isinstance(value, list):
        return []
    return [c for c in VIDEO_CODECS if c in value]


def encode_event(event: str, data) -> str:
    return json.dumps({"t": event, "d": data}, default=str, separators=(",", ":"))


class Connection:
    """Uma conexão WebSocket. Envios são enfileirados e escritos por uma task dedicada."""

    MAX_PENDING = 2000

    def __init__(self, websocket, user_id: int):
        self.id = secrets.token_hex(8)
        self.websocket = websocket
        self.user_id = user_id
        self.typing_at: Dict[str, float] = {}
        self._queue: asyncio.Queue = asyncio.Queue()
        self._closed = False
        self._sender: Optional[asyncio.Task] = None

    @property
    def closed(self) -> bool:
        return self._closed

    def start(self):
        self._sender = asyncio.create_task(self._send_loop())

    def send_raw(self, payload: str):
        if self._closed:
            return
        if self._queue.qsize() >= self.MAX_PENDING:
            logger.warning("Conexão %s (user %s) lenta demais; desconectando.", self.id, self.user_id)
            self.close()
            return
        self._queue.put_nowait(payload)

    def send(self, event: str, data):
        self.send_raw(encode_event(event, data))

    def close(self, code: int = 1000):
        if not self._closed:
            self._closed = True
            self.close_code = code
            self._queue.put_nowait(None)

    async def _send_loop(self):
        try:
            while True:
                payload = await self._queue.get()
                if payload is None:
                    break
                await self.websocket.send_text(payload)
        except Exception as exc:  # conexão caiu durante o envio
            logger.debug("Falha ao enviar para %s: %s", self.id, exc)
        finally:
            self._closed = True
            try:
                await self.websocket.close(code=getattr(self, "close_code", 1000))
            except Exception:
                pass


@dataclass
class VoiceState:
    user_id: int
    server_id: int
    channel_id: int
    conn_id: str
    session_id: Optional[str] = None
    tracks: Dict[str, str] = field(default_factory=dict)  # kind -> trackName no SFU
    muted: bool = False
    deafened: bool = False
    joined_at: float = field(default_factory=time.time)
    # Codecs com codificação/decodificação em hardware; None = cliente antigo (não informou)
    encode: Optional[list] = None
    decode: Optional[list] = None
    watching: Set[int] = field(default_factory=set)  # de quem estou assistindo a transmissão
    video_codecs: Dict[str, str] = field(default_factory=dict)  # kind -> codec em uso (screen/camera)


class Hub:
    def __init__(self):
        self.conns: Dict[str, Connection] = {}
        self.user_conns: Dict[int, Set[str]] = {}
        self.users: Dict[int, dict] = {}
        self.server_members: Dict[int, Set[int]] = {}
        self.user_servers: Dict[int, Set[int]] = {}
        self.channels: Dict[int, dict] = {}
        self.voice: Dict[int, VoiceState] = {}
        self._grace_tasks: Dict[int, asyncio.Task] = {}
        self._dm_participants: Dict[int, tuple] = {}
        self.dm_partners: Dict[int, Set[int]] = {}

    # ------------------------------------------------------------------ carga
    async def load(self):
        async with AsyncSessionLocal() as db:
            for user in (await db.execute(select(User))).scalars():
                self.upsert_user(user)
            for (server_id,) in (await db.execute(select(Server.id))).all():
                self.server_members.setdefault(server_id, set())
            for server_id, user_id in (await db.execute(select(ServerMember.server_id, ServerMember.user_id))).all():
                self.add_member(server_id, user_id)
            for ch in (await db.execute(select(Channel))).scalars():
                self.set_channel(ch.id, ch.server_id, ch.type)
            for conv_id, u1, u2 in (await db.execute(
                select(DirectConversation.id, DirectConversation.user1_id, DirectConversation.user2_id)
            )).all():
                self.add_dm_pair(conv_id, u1, u2)
        logger.info(
            "Gateway carregado: %d usuários, %d servidores, %d canais.",
            len(self.users), len(self.server_members), len(self.channels),
        )

    # --------------------------------------------------------------- usuários
    def upsert_user(self, user: User):
        self.users[user.id] = {
            "id": user.id,
            "username": user.username,
            "avatar_url": user.avatar_url or "",
            "banner_url": user.banner_url or "",
            "custom_status": user.custom_status or "",
            "presence_pref": user.presence if user.presence in ("online", "idle", "dnd", "invisible") else "online",
            "superadmin": bool(user.is_superadmin),
            "banned": bool(user.banned),
            "tokens_after": tokens_valid_after(user),
        }

    def presence_of(self, user_id: int) -> str:
        if not self.user_conns.get(user_id):
            return "offline"
        pref = self.users.get(user_id, {}).get("presence_pref", "online")
        return "offline" if pref == "invisible" else pref

    def public_user(self, user_id: int) -> dict:
        data = dict(self.users.get(user_id) or {"id": user_id, "username": "Desconhecido", "avatar_url": ""})
        for private in ("presence_pref", "superadmin", "banned", "tokens_after"):
            data.pop(private, None)
        data["presence"] = self.presence_of(user_id)
        return data

    def broadcast_user_update(self, user_id: int, presence_changed: bool = False):
        self.send_to_users(self.audience(user_id), "USER_UPDATE", self.public_user(user_id))
        if presence_changed:
            self._broadcast_presence(user_id)
        # Mantém nome/avatar atualizados para quem está na call
        st = self.voice.get(user_id)
        if st:
            self.send_to_server(st.server_id, "VOICE_STATE_UPDATE", self.voice_public(st))

    # ------------------------------------------------------------- membership
    def add_member(self, server_id: int, user_id: int):
        self.server_members.setdefault(server_id, set()).add(user_id)
        self.user_servers.setdefault(user_id, set()).add(server_id)

    def remove_member(self, server_id: int, user_id: int):
        self.server_members.get(server_id, set()).discard(user_id)
        self.user_servers.get(user_id, set()).discard(server_id)
        st = self.voice.get(user_id)
        if st and st.server_id == server_id:
            self._remove_voice(user_id, reason="removed")

    def remove_server(self, server_id: int) -> Set[int]:
        members = self.server_members.pop(server_id, set())
        for uid in members:
            self.user_servers.get(uid, set()).discard(server_id)
        for uid, st in list(self.voice.items()):
            if st.server_id == server_id:
                self._remove_voice(uid, reason="removed", broadcast=False)
        for cid in [cid for cid, ch in self.channels.items() if ch["server_id"] == server_id]:
            self.channels.pop(cid, None)
        return members

    def is_member(self, server_id: int, user_id: int) -> bool:
        return user_id in self.server_members.get(server_id, ())

    def add_dm_pair(self, conversation_id: int, user1_id: int, user2_id: int):
        self._dm_participants[conversation_id] = (user1_id, user2_id)
        self.dm_partners.setdefault(user1_id, set()).add(user2_id)
        self.dm_partners.setdefault(user2_id, set()).add(user1_id)

    def audience(self, user_id: int) -> Set[int]:
        """Quem enxerga o usuário: membros de servidores em comum e contatos de DM (inclui ele mesmo)."""
        result = {user_id} | self.dm_partners.get(user_id, set())
        for sid in self.user_servers.get(user_id, ()):
            result |= self.server_members.get(sid, set())
        return result

    def set_channel(self, channel_id: int, server_id: int, channel_type: str):
        self.channels[channel_id] = {"server_id": server_id, "type": channel_type}

    def remove_channel(self, channel_id: int):
        self.channels.pop(channel_id, None)
        for uid, st in list(self.voice.items()):
            if st.channel_id == channel_id:
                self._remove_voice(uid, reason="channel_deleted")

    # --------------------------------------------------------------- dispatch
    def send_to_users(self, user_ids: Iterable[int], event: str, data, exclude_user: Optional[int] = None):
        payload = encode_event(event, data)
        for uid in user_ids:
            if uid == exclude_user:
                continue
            for cid in self.user_conns.get(uid, ()):
                conn = self.conns.get(cid)
                if conn:
                    conn.send_raw(payload)

    def send_to_user(self, user_id: int, event: str, data):
        self.send_to_users((user_id,), event, data)

    def send_to_server(self, server_id: int, event: str, data, exclude_user: Optional[int] = None):
        self.send_to_users(self.server_members.get(server_id, set()), event, data, exclude_user)

    # ------------------------------------------------------------- conexões
    def connect(self, conn: Connection):
        uid = conn.user_id
        was_offline = self.presence_of(uid) == "offline"
        self.conns[conn.id] = conn
        self.user_conns.setdefault(uid, set()).add(conn.id)
        conn.start()
        conn.send("READY", self._ready_payload(conn))
        if was_offline and self.presence_of(uid) != "offline":
            self._broadcast_presence(uid)

    def disconnect(self, conn: Connection):
        conn.close()
        uid = conn.user_id
        if self.conns.pop(conn.id, None) is None:
            return
        conns = self.user_conns.get(uid, set())
        conns.discard(conn.id)
        if not conns:
            self.user_conns.pop(uid, None)
            self._broadcast_presence(uid)
        st = self.voice.get(uid)
        if st and st.conn_id == conn.id:
            self._schedule_voice_expiry(uid, conn.id)

    def _ready_payload(self, conn: Connection) -> dict:
        uid = conn.user_id
        servers = self.user_servers.get(uid, set())
        presences = {}
        for other in self.audience(uid):
            p = self.presence_of(other)
            if p != "offline":
                presences[other] = p
        return {
            "connection_id": conn.id,
            "user_id": uid,
            "heartbeat_interval": HEARTBEAT_INTERVAL_MS,
            "voice_states": [self.voice_public(st) for st in self.voice.values() if st.server_id in servers],
            "presences": presences,
        }

    def _broadcast_presence(self, user_id: int):
        self.send_to_users(
            self.audience(user_id), "PRESENCE_UPDATE",
            {"user_id": user_id, "presence": self.presence_of(user_id)},
        )

    # ------------------------------------------------------------------ voz
    def voice_public(self, st: VoiceState) -> dict:
        user = self.users.get(st.user_id, {})
        return {
            "user_id": st.user_id,
            "server_id": st.server_id,
            "channel_id": st.channel_id,
            "username": user.get("username", ""),
            "avatar_url": user.get("avatar_url", ""),
            "is_muted": st.muted,
            "is_deafened": st.deafened,
            "is_sharing_screen": bool(st.tracks.get("screen")),
            "has_camera": bool(st.tracks.get("camera")),
            "has_session": st.session_id is not None,
            "tracks": dict(st.tracks),
            "joined_at": st.joined_at,
            "encode": st.encode,
            "decode": st.decode,
            "watching": sorted(st.watching),
            "video_codecs": dict(st.video_codecs),
        }

    def _voice_ack(self, st: VoiceState) -> dict:
        # Só o próprio usuário recebe o session_id: se não bater com o do cliente, ele recria a mídia
        return {**self.voice_public(st), "session_id": st.session_id}

    def voice_states_for_server(self, server_id: int) -> list:
        return [self.voice_public(st) for st in self.voice.values() if st.server_id == server_id]

    @staticmethod
    def _apply_media_fields(st: VoiceState, msg: dict) -> bool:
        """Capacidades de hardware, quem estou assistindo e codecs em uso. Retorna se mudou algo."""
        changed = False
        for key in ("encode", "decode"):
            if key in msg:
                value = _codec_list(msg[key])
                if value != getattr(st, key):
                    setattr(st, key, value)
                    changed = True
        if "watching" in msg and isinstance(msg["watching"], list):
            watching = {int(u) for u in msg["watching"][:MAX_WATCHING]} - {st.user_id}
            if watching != st.watching:
                st.watching = watching
                changed = True
        if "video_codecs" in msg and isinstance(msg["video_codecs"], dict):
            codecs = {
                k: v for k, v in msg["video_codecs"].items()
                if k in VIDEO_KINDS and v in VIDEO_CODECS and st.tracks.get(k)
            }
            if codecs != st.video_codecs:
                st.video_codecs = codecs
                changed = True
        return changed

    def _voice_join(self, conn: Connection, channel_id: int, msg: Optional[dict] = None):
        uid = conn.user_id
        msg = msg or {}
        ch = self.channels.get(channel_id)
        if not ch or ch["type"] != "voice" or not self.is_member(ch["server_id"], uid):
            conn.send("VOICE_ERROR", {"message": "Canal de voz inválido ou sem permissão."})
            return
        self._cancel_voice_expiry(uid)

        st = self.voice.get(uid)
        if st and st.channel_id == channel_id:
            # Retomada após queda do WebSocket, ou outra instância assumindo a call
            if st.conn_id != conn.id:
                old = self.conns.get(st.conn_id)
                if old:
                    old.send("VOICE_DISCONNECTED", {"reason": "moved"})
                st.conn_id = conn.id
            changed = self._apply_media_fields(st, msg)
            conn.send("VOICE_JOINED", self._voice_ack(st))
            if changed:
                self.send_to_server(st.server_id, "VOICE_STATE_UPDATE", self.voice_public(st))
            return

        if st:
            old = self.conns.get(st.conn_id) if st.conn_id != conn.id else None
            if old:
                old.send("VOICE_DISCONNECTED", {"reason": "moved"})
            self._remove_voice(uid)

        st = VoiceState(user_id=uid, server_id=ch["server_id"], channel_id=channel_id, conn_id=conn.id)
        self._apply_media_fields(st, msg)
        self.voice[uid] = st
        conn.send("VOICE_JOINED", self._voice_ack(st))
        self.send_to_server(st.server_id, "VOICE_STATE_UPDATE", self.voice_public(st))

    def _voice_leave(self, conn: Connection):
        st = self.voice.get(conn.user_id)
        if st and st.conn_id == conn.id:
            self._cancel_voice_expiry(conn.user_id)
            self._remove_voice(conn.user_id)

    def _voice_update(self, conn: Connection, msg: dict):
        st = self.voice.get(conn.user_id)
        if not st or st.conn_id != conn.id:
            return
        changed = False
        for key, attr in (("muted", "muted"), ("deafened", "deafened")):
            if key in msg and bool(msg[key]) != getattr(st, attr):
                setattr(st, attr, bool(msg[key]))
                changed = True
        if self._apply_media_fields(st, msg):
            changed = True
        if changed:
            self.send_to_server(st.server_id, "VOICE_STATE_UPDATE", self.voice_public(st))

    def _remove_voice(self, user_id: int, reason: Optional[str] = None, broadcast: bool = True):
        st = self.voice.pop(user_id, None)
        if not st:
            return
        if reason:
            conn = self.conns.get(st.conn_id)
            if conn:
                conn.send("VOICE_DISCONNECTED", {"reason": reason})
        if broadcast:
            self.send_to_server(st.server_id, "VOICE_STATE_UPDATE", {
                "user_id": user_id, "server_id": st.server_id, "channel_id": None,
            })

    def _schedule_voice_expiry(self, user_id: int, conn_id: str):
        self._cancel_voice_expiry(user_id)

        async def expire():
            try:
                await asyncio.sleep(VOICE_RECONNECT_GRACE_SECONDS)
                st = self.voice.get(user_id)
                if st and st.conn_id == conn_id:
                    logger.info("Usuário %s não reconectou a tempo; removido da call.", user_id)
                    self._remove_voice(user_id)
            finally:
                if self._grace_tasks.get(user_id) is task:
                    self._grace_tasks.pop(user_id, None)

        task = asyncio.create_task(expire())
        self._grace_tasks[user_id] = task

    def _cancel_voice_expiry(self, user_id: int):
        task = self._grace_tasks.pop(user_id, None)
        if task:
            task.cancel()

    # Chamados pelo proxy RTC ------------------------------------------------
    # ------------------------------------------------------------ moderação
    def is_superadmin(self, user_id: int) -> bool:
        return bool(self.users.get(user_id, {}).get("superadmin"))

    def admin_disconnect_voice(self, user_id: int) -> bool:
        """Tira alguém da call (o app da pessoa recebe VOICE_DISCONNECTED e sai)."""
        if user_id not in self.voice:
            return False
        self._cancel_voice_expiry(user_id)
        self._remove_voice(user_id, reason="admin")
        return True

    def revoke_sessions(self, user_id: int, reason: str) -> int:
        """Encerra todas as conexões da pessoa; o app faz logout (código 4001) e mostra o motivo."""
        conn_ids = list(self.user_conns.get(user_id, ()))
        for cid in conn_ids:
            conn = self.conns.get(cid)
            if conn:
                conn.send("SESSION_REVOKED", {"reason": reason})
                conn.close(code=4001)
        if user_id in self.voice:
            self._cancel_voice_expiry(user_id)
            self._remove_voice(user_id)
        return len(conn_ids)

    def remove_user(self, user_id: int) -> Set[int]:
        """Conta excluída: some de todos os caches. Retorna quem enxergava a pessoa (para avisar)."""
        audience = self.audience(user_id) - {user_id}
        for sid in list(self.user_servers.get(user_id, ())):
            self.remove_member(sid, user_id)
        self.user_servers.pop(user_id, None)
        for partner in self.dm_partners.pop(user_id, set()):
            self.dm_partners.get(partner, set()).discard(user_id)
        for conv_id, pair in list(self._dm_participants.items()):
            if user_id in pair:
                self._dm_participants.pop(conv_id, None)
        self.users.pop(user_id, None)
        return audience

    def voice_state_of(self, user_id: int) -> Optional[VoiceState]:
        return self.voice.get(user_id)

    def set_voice_session(self, user_id: int, session_id: str):
        st = self.voice.get(user_id)
        if not st:
            return
        had_tracks = bool(st.tracks)
        st.session_id = session_id
        st.tracks = {}
        st.video_codecs = {}
        if had_tracks:
            self.send_to_server(st.server_id, "VOICE_STATE_UPDATE", self.voice_public(st))

    def set_voice_tracks(self, user_id: int, updates: Dict[str, Optional[str]]):
        st = self.voice.get(user_id)
        if not st:
            return
        for kind, name in updates.items():
            if name:
                st.tracks[kind] = name
            else:
                st.tracks.pop(kind, None)
                st.video_codecs.pop(kind, None)
        self.send_to_server(st.server_id, "VOICE_STATE_UPDATE", self.voice_public(st))

    # --------------------------------------------------------------- digitação
    def _typing(self, conn: Connection, channel_id: int):
        ch = self.channels.get(channel_id)
        if not ch or ch["type"] != "text" or not self.is_member(ch["server_id"], conn.user_id):
            return
        if not self._throttle(conn, f"c{channel_id}"):
            return
        self.send_to_server(ch["server_id"], "TYPING_START", {
            "channel_id": channel_id,
            "server_id": ch["server_id"],
            "user_id": conn.user_id,
            "username": self.users.get(conn.user_id, {}).get("username", ""),
        }, exclude_user=conn.user_id)

    async def _dm_typing(self, conn: Connection, conversation_id: int):
        participants = self._dm_participants.get(conversation_id)
        if participants is None:
            async with AsyncSessionLocal() as db:
                conv = await db.get(DirectConversation, conversation_id)
                if not conv:
                    return
                participants = (conv.user1_id, conv.user2_id)
                self._dm_participants[conversation_id] = participants
        if conn.user_id not in participants or not self._throttle(conn, f"d{conversation_id}"):
            return
        other = participants[1] if participants[0] == conn.user_id else participants[0]
        self.send_to_user(other, "DM_TYPING_START", {
            "conversation_id": conversation_id,
            "user_id": conn.user_id,
            "username": self.users.get(conn.user_id, {}).get("username", ""),
        })

    @staticmethod
    def _throttle(conn: Connection, key: str) -> bool:
        now = time.monotonic()
        if now - conn.typing_at.get(key, 0) < TYPING_THROTTLE_SECONDS:
            return False
        conn.typing_at[key] = now
        return True

    # ------------------------------------------------------------- operações
    async def handle(self, conn: Connection, msg: dict):
        op = msg.get("op")
        try:
            if op == "heartbeat":
                conn.send("HEARTBEAT_ACK", {"t": msg.get("t")})
            elif op == "voice_join":
                self._voice_join(conn, int(msg["channel_id"]), msg)
            elif op == "voice_leave":
                self._voice_leave(conn)
            elif op == "voice_update":
                self._voice_update(conn, msg)
            elif op == "typing":
                self._typing(conn, int(msg["channel_id"]))
            elif op == "dm_typing":
                await self._dm_typing(conn, int(msg["conversation_id"]))
        except (KeyError, TypeError, ValueError) as exc:
            logger.debug("Operação inválida %r de %s: %s", op, conn.user_id, exc)

    async def shutdown(self):
        for task in list(self._grace_tasks.values()):
            task.cancel()
        for conn in list(self.conns.values()):
            conn.close()


hub = Hub()
