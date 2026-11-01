import os
import secrets
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Carrega variáveis do arquivo .env (sem dependências externas)."""
    env_file = ROOT_DIR / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _load_jwt_secret() -> str:
    """Usa JWT_SECRET do ambiente ou gera um segredo persistente local (nunca versionado)."""
    from_env = os.getenv("JWT_SECRET")
    if from_env:
        return from_env
    secret_file = ROOT_DIR / ".jwt_secret"
    if secret_file.exists():
        return secret_file.read_text(encoding="utf-8").strip()
    secret = secrets.token_urlsafe(48)
    secret_file.write_text(secret, encoding="utf-8")
    return secret


_load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./resenha.db")
JWT_SECRET = _load_jwt_secret()
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 dias

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024

# Cloudflare Realtime (SFU) — https://dash.cloudflare.com → Realtime → SFU
CF_REALTIME_APP_ID = os.getenv("CF_REALTIME_APP_ID", "")
CF_REALTIME_APP_TOKEN = os.getenv("CF_REALTIME_APP_TOKEN", "")
# Cloudflare TURN (opcional, ajuda redes que bloqueiam UDP)
CF_TURN_KEY_ID = os.getenv("CF_TURN_KEY_ID", "")
CF_TURN_KEY_TOKEN = os.getenv("CF_TURN_KEY_TOKEN", "")

# Endereço público usado nos links de convite (não o do ngrok, que muda e é feio)
PUBLIC_URL = os.getenv("PUBLIC_URL", "http://localhost:8000").rstrip("/")

# Gateway
HEARTBEAT_TIMEOUT_SECONDS = 45
# Tempo que um usuário permanece na call após a queda do WebSocket (a mídia continua pelo SFU)
VOICE_RECONNECT_GRACE_SECONDS = int(os.getenv("VOICE_RECONNECT_GRACE_SECONDS", "20"))

# E-mails (Resend): confirmação de cadastro e recuperação de senha. Sem chave, ficam desligados.
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_API_BASE = os.getenv("RESEND_API_BASE", "https://api.resend.com")
EMAIL_FROM = os.getenv("EMAIL_FROM", "")  # ex.: Resenha <nao-responda@mail.seu-dominio.com>
