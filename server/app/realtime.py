"""
Proxy autenticado para o Cloudflare Realtime SFU.

O segredo do app Cloudflare nunca sai do servidor. Os clientes publicam/assinam
tracks por (user_id, tipo) e o servidor resolve para (sessionId, trackName) no SFU,
validando que ambos estão no mesmo canal de voz.

Fluxo no cliente (uma única RTCPeerConnection por call):
  1. POST /api/rtc/session                → cria a sessão no SFU
  2. POST /api/rtc/publish {offer,tracks} → envia mic / tela; retorna answer
  3. POST /api/rtc/subscribe {tracks}     → SFU devolve offer; cliente responde em
     PUT  /api/rtc/renegotiate {answer}
  4. POST /api/rtc/unpublish | unsubscribe {offer, ...} → fecha transceivers
"""
import asyncio
import os
import logging
import secrets
import time
from typing import Dict, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import CF_REALTIME_APP_ID, CF_REALTIME_APP_TOKEN, CF_TURN_KEY_ID, CF_TURN_KEY_TOKEN
from app.gateway import hub
from app.models import User
from app.schemas import (
    PublishRequest, RenegotiateRequest, SubscribeRequest, UnpublishRequest, UnsubscribeRequest,
)

logger = logging.getLogger("resenha.rtc")

router = APIRouter(prefix="/api/rtc", tags=["rtc"])

CF_BASE = os.getenv("CF_REALTIME_API_BASE", "https://rtc.live.cloudflare.com/v1")
FALLBACK_ICE = [{"urls": ["stun:stun.cloudflare.com:3478"]}]


class CloudflareError(Exception):
    pass


class CloudflareRealtime:
    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None
        self._session_locks: Dict[str, asyncio.Lock] = {}
        self._ice_cache: Optional[tuple] = None  # (expires_at, servers)

    @property
    def enabled(self) -> bool:
        return bool(CF_REALTIME_APP_ID and CF_REALTIME_APP_TOKEN)

    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=5.0),
                limits=httpx.Limits(max_keepalive_connections=20),
            )
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()

    def lock(self, session_id: str) -> asyncio.Lock:
        # O SFU exige que cada troca SDP termine antes da próxima mutação na sessão
        return self._session_locks.setdefault(session_id, asyncio.Lock())

    async def _call(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        url = f"{CF_BASE}/apps/{CF_REALTIME_APP_ID}{path}"
        headers = {"Authorization": f"Bearer {CF_REALTIME_APP_TOKEN}"}
        try:
            resp = await self.client().request(method, url, json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise CloudflareError(f"Falha de rede com a Cloudflare: {exc}") from exc
        data = resp.json() if resp.content else {}
        if resp.status_code >= 400 or data.get("errorCode"):
            raise CloudflareError(data.get("errorDescription") or f"Cloudflare HTTP {resp.status_code}")
        return data

    async def new_session(self) -> str:
        data = await self._call("POST", "/sessions/new")
        return data["sessionId"]

    async def tracks_new(self, session_id: str, body: dict) -> dict:
        return await self._call("POST", f"/sessions/{session_id}/tracks/new", body)

    async def renegotiate(self, session_id: str, body: dict) -> dict:
        return await self._call("PUT", f"/sessions/{session_id}/renegotiate", body)

    async def tracks_close(self, session_id: str, body: dict) -> dict:
        return await self._call("PUT", f"/sessions/{session_id}/tracks/close", body)

    async def ice_servers(self) -> list:
        if not (CF_TURN_KEY_ID and CF_TURN_KEY_TOKEN):
            return FALLBACK_ICE
        now = time.time()
        if self._ice_cache and self._ice_cache[0] > now:
            return self._ice_cache[1]
        try:
            resp = await self.client().post(
                f"{CF_BASE}/turn/keys/{CF_TURN_KEY_ID}/credentials/generate-ice-servers",
                headers={"Authorization": f"Bearer {CF_TURN_KEY_TOKEN}"},
                json={"ttl": 86400},
            )
            resp.raise_for_status()
            servers = resp.json()["iceServers"]
            self._ice_cache = (now + 12 * 3600, servers)
            return servers
        except Exception as exc:
            logger.warning("Não foi possível gerar credenciais TURN: %s", exc)
            return FALLBACK_ICE


cf = CloudflareRealtime()


def _require_enabled():
    if not cf.enabled:
        raise HTTPException(
            status_code=503,
            detail="Voz indisponível: o servidor não configurou o Cloudflare Realtime (veja o README do servidor).",
        )


def _require_session(user: User):
    st = hub.voice_state_of(user.id)
    if not st:
        raise HTTPException(status_code=409, detail="Você não está em um canal de voz.")
    if not st.session_id:
        raise HTTPException(status_code=409, detail="Sessão de mídia ainda não criada.")
    return st


def _bad_gateway(exc: Exception):
    logger.warning("Erro do Cloudflare Realtime: %s", exc)
    return HTTPException(status_code=502, detail=f"Servidor de mídia: {exc}")


@router.get("/config")
async def rtc_config(_: User = Depends(get_current_user)):
    return {"enabled": cf.enabled, "ice_servers": await cf.ice_servers() if cf.enabled else FALLBACK_ICE}


@router.post("/session")
async def create_session(user: User = Depends(get_current_user)):
    _require_enabled()
    if not hub.voice_state_of(user.id):
        raise HTTPException(status_code=409, detail="Entre em um canal de voz antes de conectar a mídia.")
    try:
        session_id = await cf.new_session()
    except CloudflareError as exc:
        raise _bad_gateway(exc)
    hub.set_voice_session(user.id, session_id)
    return {"session_id": session_id}


@router.post("/publish")
async def publish(req: PublishRequest, user: User = Depends(get_current_user)):
    _require_enabled()
    st = _require_session(user)
    session_id = st.session_id
    names = {t.mid: f"u{user.id}-{t.kind}-{secrets.token_hex(4)}" for t in req.tracks}
    body = {
        "sessionDescription": req.offer.model_dump(),
        "tracks": [{"location": "local", "mid": t.mid, "trackName": names[t.mid]} for t in req.tracks],
    }
    async with cf.lock(session_id):
        try:
            data = await cf.tracks_new(session_id, body)
        except CloudflareError as exc:
            raise _bad_gateway(exc)

    failed = {t.get("mid"): t.get("errorDescription") for t in data.get("tracks", []) if t.get("errorCode")}
    result, updates = [], {}
    for t in req.tracks:
        error = failed.get(t.mid)
        if not error:
            updates[t.kind] = names[t.mid]
        result.append({"mid": t.mid, "kind": t.kind, "error": error})
    # A sessão pode ter sido recriada enquanto a requisição estava em andamento
    current = hub.voice_state_of(user.id)
    if updates and current and current.session_id == session_id:
        hub.set_voice_tracks(user.id, updates)
    return {"answer": data.get("sessionDescription"), "tracks": result}


@router.post("/unpublish")
async def unpublish(req: UnpublishRequest, user: User = Depends(get_current_user)):
    _require_enabled()
    st = _require_session(user)
    if not req.replaced:
        hub.set_voice_tracks(user.id, {t.kind: None for t in req.tracks})
    body = {
        "sessionDescription": req.offer.model_dump(),
        "tracks": [{"mid": t.mid} for t in req.tracks],
        "force": False,
    }
    async with cf.lock(st.session_id):
        try:
            data = await cf.tracks_close(st.session_id, body)
        except CloudflareError as exc:
            raise _bad_gateway(exc)
    return {"answer": data.get("sessionDescription")}


@router.post("/subscribe")
async def subscribe(req: SubscribeRequest, user: User = Depends(get_current_user)):
    _require_enabled()
    st = _require_session(user)
    remote, results = [], []
    for t in req.tracks:
        target = hub.voice_state_of(t.user_id)
        track_name = target.tracks.get(t.kind) if target else None
        if (
            not target or target.user_id == user.id or target.channel_id != st.channel_id
            or not target.session_id or not track_name
        ):
            results.append({"user_id": t.user_id, "kind": t.kind, "error": "Track indisponível."})
            continue
        remote.append((t, target.session_id, track_name))

    if not remote:
        return {"offer": None, "requires_renegotiation": False, "tracks": results}

    body = {"tracks": [
        {"location": "remote", "sessionId": sid, "trackName": name} for (_, sid, name) in remote
    ]}
    async with cf.lock(st.session_id):
        try:
            data = await cf.tracks_new(st.session_id, body)
        except CloudflareError as exc:
            raise _bad_gateway(exc)

    by_name = {t.get("trackName"): t for t in data.get("tracks", [])}
    for (t, _, name) in remote:
        info = by_name.get(name, {})
        results.append({
            "user_id": t.user_id,
            "kind": t.kind,
            "track_name": name,
            "mid": info.get("mid"),
            "error": info.get("errorDescription") if info.get("errorCode") else (None if info.get("mid") else "Sem mid"),
        })
    return {
        "offer": data.get("sessionDescription"),
        "requires_renegotiation": bool(data.get("requiresImmediateRenegotiation")),
        "tracks": results,
    }


@router.put("/renegotiate")
async def renegotiate(req: RenegotiateRequest, user: User = Depends(get_current_user)):
    _require_enabled()
    st = _require_session(user)
    async with cf.lock(st.session_id):
        try:
            await cf.renegotiate(st.session_id, {"sessionDescription": req.answer.model_dump()})
        except CloudflareError as exc:
            raise _bad_gateway(exc)
    return {"ok": True}


@router.post("/unsubscribe")
async def unsubscribe(req: UnsubscribeRequest, user: User = Depends(get_current_user)):
    _require_enabled()
    st = _require_session(user)
    body = {
        "sessionDescription": req.offer.model_dump(),
        "tracks": [{"mid": mid} for mid in req.mids],
        "force": False,
    }
    async with cf.lock(st.session_id):
        try:
            data = await cf.tracks_close(st.session_id, body)
        except CloudflareError as exc:
            raise _bad_gateway(exc)
    return {"answer": data.get("sessionDescription")}
