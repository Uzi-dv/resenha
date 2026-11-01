from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import JWT_SECRET, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from app.database import get_db
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str:
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    return jwt.encode({"sub": str(user_id), "exp": expire, "iat": now}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token_claims(token: str) -> Optional[Tuple[int, int]]:
    """(user_id, emitido_em) do token, ou None se inválido/expirado. Tokens antigos não têm "iat" (0)."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"]), int(payload.get("iat", 0))
    except Exception:
        return None


def decode_token(token: str) -> Optional[int]:
    """Retorna o user_id do token, ou None se inválido/expirado."""
    claims = decode_token_claims(token)
    return claims[0] if claims else None


def tokens_valid_after(user: User) -> int:
    """Tokens emitidos antes deste instante (troca de senha) não valem mais."""
    changed = user.password_changed_at
    return int(changed.replace(tzinfo=timezone.utc).timestamp()) if changed else 0


async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> User:
    user_id, issued_at = decode_token_claims(token) or (None, 0)
    user = await db.get(User, user_id) if user_id is not None else None
    if user is None or issued_at < tokens_valid_after(user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciais inválidas ou sessão expirada.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.banned:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sua conta foi suspensa por um administrador.")
    return user


async def get_superadmin(user: User = Depends(get_current_user)) -> User:
    if not user.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Apenas o super admin pode fazer isso.")
    return user
