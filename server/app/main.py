import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.auth import decode_token_claims
from app.config import HEARTBEAT_TIMEOUT_SECONDS, UPLOAD_DIR
from app.database import AsyncSessionLocal, Base, engine
from app.permissions import ensure_default_roles
from app.gateway import Connection, hub
from app.realtime import cf
from app.routers import admin_routes, auth_routes, dm_routes, invite_routes, message_routes, server_routes, upload_routes
from app import downloads, invite_page, realtime, uso, web_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("resenha.main")

APP_VERSION = "2.11.0"

# Migrações leves e idempotentes para bancos criados por versões anteriores
MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN banner_url VARCHAR(500) DEFAULT ''",
    "ALTER TABLE messages ADD COLUMN edited_at DATETIME",
    "ALTER TABLE direct_messages ADD COLUMN edited_at DATETIME",
    "CREATE INDEX IF NOT EXISTS ix_messages_channel_id_id ON messages (channel_id, id)",
    "CREATE INDEX IF NOT EXISTS ix_direct_messages_conv_id_id ON direct_messages (conversation_id, id)",
    "CREATE INDEX IF NOT EXISTS ix_server_members_server_user ON server_members (server_id, user_id)",
    "ALTER TABLE server_members ADD COLUMN position INTEGER DEFAULT 0",
    # v2.4: respostas e anexos (as tabelas de reações saem do create_all)
    "ALTER TABLE messages ADD COLUMN reply_to_id INTEGER",
    "ALTER TABLE messages ADD COLUMN attachments TEXT",
    "ALTER TABLE direct_messages ADD COLUMN reply_to_id INTEGER",
    "ALTER TABLE direct_messages ADD COLUMN attachments TEXT",
    # v2.6: super admin e contas suspensas
    "ALTER TABLE users ADD COLUMN is_superadmin BOOLEAN DEFAULT 0",
    "ALTER TABLE users ADD COLUMN banned BOOLEAN DEFAULT 0",
    # v2.10: confirmação de e-mail (contas que já existiam ficam confirmadas) e troca de senha
    "ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT 1",
    "ALTER TABLE users ADD COLUMN password_changed_at DATETIME",
]


async def run_migrations():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    for statement in MIGRATIONS:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(statement))
        except Exception:
            pass  # coluna/índice já existe


@asynccontextmanager
async def lifespan(_: FastAPI):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    await run_migrations()
    async with AsyncSessionLocal() as db:
        await ensure_default_roles(db)
    await hub.load()
    web_task = asyncio.create_task(web_app.updater_loop())
    uso_task = asyncio.create_task(uso.uso.laco())
    if not cf.enabled:
        logger.warning(
            "Cloudflare Realtime NÃO configurado: chat funciona, mas voz/tela ficam indisponíveis. "
            "Defina CF_REALTIME_APP_ID e CF_REALTIME_APP_TOKEN no arquivo .env."
        )
    yield
    web_task.cancel()
    uso_task.cancel()
    uso.uso.salvar()
    await hub.shutdown()
    await cf.close()
    await engine.dispose()


app = FastAPI(title="Resenha API", version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/download/assets", StaticFiles(directory=downloads.PAGE_DIR / "assets"), name="download-assets")
app.mount("/convite/assets", StaticFiles(directory=invite_page.PAGE_DIR / "assets"), name="invite-assets")

app.include_router(auth_routes.router)
app.include_router(server_routes.router)
app.include_router(message_routes.router)
app.include_router(upload_routes.router)
app.include_router(dm_routes.router)
app.include_router(admin_routes.router)
app.include_router(invite_routes.router)
app.include_router(realtime.router)
app.include_router(uso.router)


@app.get("/api/status")
async def status():
    return {
        "status": "online",
        "app": "Resenha API",
        "version": APP_VERSION,
        "voice": cf.enabled,
        "online_connections": len(hub.conns),
        "web": web_app.installed_version(),
    }


@app.get("/")
async def root(request: Request):
    # Navegador recebe o app web; o app desktop e os testes recebem o status em JSON
    if web_app.wants_html(request) and web_app.is_available():
        return web_app.serve_file("")
    return await status()


# Página de download (seu-dominio.com/download). Precisa vir antes da rota coringa do app web.
@app.get("/download", include_in_schema=False)
async def download_page():
    return FileResponse(downloads.PAGE_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/download/", include_in_schema=False)
async def download_page_slash():
    return RedirectResponse("/download", status_code=301)


@app.get("/download/windows", include_in_schema=False)
async def download_windows():
    info = await downloads.latest()
    url = info["setup_url"] if info else downloads.FALLBACK_URL
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})


@app.get("/api/download")
async def download_info():
    info = await downloads.latest()
    if not info:
        raise HTTPException(status_code=503, detail="Não foi possível descobrir a versão mais recente.")
    return info


# Página do convite (seu-dominio.com/convite/<código>). Também precisa vir antes da rota coringa.
@app.get("/convite/{code}", include_in_schema=False)
async def invite_landing(code: str):
    async with AsyncSessionLocal() as db:
        return await invite_page.render(db, code)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    await websocket.accept()
    claims = decode_token_claims(token) if token else None
    user_id, issued_at = claims or (None, 0)
    info = hub.users.get(user_id) if user_id is not None else None
    if not info or info.get("banned") or issued_at < info.get("tokens_after", 0):
        # 4001 = sessão inválida; o cliente faz logout em vez de tentar reconectar
        await websocket.close(code=4001)
        return

    conn = Connection(websocket, user_id)
    hub.connect(conn)
    try:
        while True:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=HEARTBEAT_TIMEOUT_SECONDS)
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if isinstance(msg, dict):
                await hub.handle(conn, msg)
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception as exc:
        logger.debug("WebSocket de %s encerrado: %s", user_id, exc)
    finally:
        hub.disconnect(conn)


# Versão web: arquivos do app e, para qualquer outra rota, o index.html. Fica por último para
# não encobrir /api, /ws, /uploads e /download (registrados antes).
@app.get("/{path:path}", include_in_schema=False)
async def web_files(path: str):
    if path.startswith(("api/", "uploads/", "ws", "download/", "convite/", "painel")):
        raise HTTPException(status_code=404, detail="Não encontrado.")
    return web_app.serve_file(path)
