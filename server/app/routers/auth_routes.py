import datetime
import hashlib
import hmac
import secrets
from typing import Union

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import email as mail
from app.auth import create_access_token, get_current_user, hash_password, verify_password
from app.config import JWT_SECRET
from app.database import get_db
from app.gateway import hub
from app.models import EmailCode, User, utcnow
from app.schemas import (
    EmailOnly, ResetPassword, Token, UserLogin, UserPublic, UserRegister, UserResponse, UserUpdate,
    VerificationRequired, VerifyEmail,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

CODE_TTL = datetime.timedelta(minutes=15)
RESEND_COOLDOWN = datetime.timedelta(seconds=60)
MAX_CODES_PER_HOUR = 5
MAX_ATTEMPTS = 5
INVALID_CODE = "Código inválido ou expirado. Peça um novo."


def _token(user: User) -> Token:
    return Token(access_token=create_access_token(user.id), token_type="bearer", user=UserResponse.model_validate(user))


async def _user_by_email(db: AsyncSession, email: str):
    return (await db.execute(select(User).where(func.lower(User.email) == email.lower()))).scalars().first()


def _hash_code(user_id: int, purpose: str, code: str) -> str:
    return hmac.new(JWT_SECRET.encode(), f"{user_id}:{purpose}:{code}".encode(), hashlib.sha256).hexdigest()


async def _send_code(db: AsyncSession, user: User, purpose: str) -> None:
    """Gera e envia um código novo (purpose: verify ou reset). Dentro de 60 s do último envio
    não faz nada (o código anterior continua valendo); no máximo 5 por hora."""
    now = utcnow()
    recent = (await db.execute(
        select(EmailCode.created_at)
        .where(EmailCode.user_id == user.id, EmailCode.purpose == purpose,
               EmailCode.created_at > now - datetime.timedelta(hours=1))
        .order_by(EmailCode.created_at.desc())
    )).scalars().all()
    if recent and now - recent[0] < RESEND_COOLDOWN:
        return
    if len(recent) >= MAX_CODES_PER_HOUR:
        raise HTTPException(status_code=429, detail="Muitos códigos pedidos. Espere um pouco e tente de novo.")

    code = f"{secrets.randbelow(10**6):06d}"
    # Só o código mais novo vale; os antigos expiram (e os de mais de 1 h são apagados)
    await db.execute(delete(EmailCode).where(
        EmailCode.user_id == user.id, EmailCode.purpose == purpose,
        EmailCode.created_at <= now - datetime.timedelta(hours=1),
    ))
    await db.execute(update(EmailCode).where(EmailCode.user_id == user.id, EmailCode.purpose == purpose).values(expires_at=now))
    row = EmailCode(user_id=user.id, purpose=purpose, code_hash=_hash_code(user.id, purpose, code),
                    created_at=now, expires_at=now + CODE_TTL)
    db.add(row)
    await db.commit()

    template = mail.TEMPLATE_VERIFY if purpose == "verify" else mail.TEMPLATE_RESET
    try:
        await mail.send_template(user.email, template, {"USERNAME": user.username, "CODE": code},
                                 # Única por código (o SQLite reaproveita ids de linhas apagadas)
                                 f"resenha-{purpose}-{user.id}-{row.code_hash[:24]}")
    except mail.EmailError:
        # O e-mail não saiu: libera pedir de novo na hora
        await db.execute(delete(EmailCode).where(EmailCode.id == row.id))
        await db.commit()
        raise HTTPException(status_code=502, detail="Não foi possível enviar o e-mail agora. Tente de novo em instantes.")


async def _check_code(db: AsyncSession, user: User, purpose: str, code: str) -> None:
    """Confere o código mais recente: vale uma vez só e aceita poucas tentativas."""
    row = (await db.execute(
        select(EmailCode).where(EmailCode.user_id == user.id, EmailCode.purpose == purpose)
        .order_by(EmailCode.created_at.desc(), EmailCode.id.desc()).limit(1)
    )).scalars().first()
    if not row or row.expires_at <= utcnow() or row.attempts >= MAX_ATTEMPTS:
        raise HTTPException(status_code=400, detail=INVALID_CODE)
    if not hmac.compare_digest(row.code_hash, _hash_code(user.id, purpose, code)):
        row.attempts += 1
        await db.commit()
        left = MAX_ATTEMPTS - row.attempts
        if not left:
            raise HTTPException(status_code=400, detail=INVALID_CODE)
        raise HTTPException(status_code=400, detail=f"Código incorreto. Tentativas restantes: {left}.")
    await db.execute(delete(EmailCode).where(EmailCode.user_id == user.id, EmailCode.purpose == purpose))


@router.post("/register", response_model=Union[Token, VerificationRequired])
async def register(user_in: UserRegister, db: AsyncSession = Depends(get_db)):
    email = user_in.email.lower()
    name_owner = (await db.execute(
        select(User).where(func.lower(User.username) == user_in.username.lower())
    )).scalars().first()
    pending = await _user_by_email(db, email)
    if pending and pending.email_verified:
        raise HTTPException(status_code=400, detail="Este e-mail já está cadastrado.")
    if name_owner and name_owner is not pending:
        raise HTTPException(status_code=400, detail="Este nome de usuário já está em uso.")

    if pending:
        # Quem se cadastrou e não confirmou pode refazer o cadastro (nome e senha novos, código reenviado)
        user = pending
        user.username = user_in.username
        user.password_hash = hash_password(user_in.password)
    else:
        user = User(
            username=user_in.username,
            email=email,
            password_hash=hash_password(user_in.password),
            avatar_url=(user_in.avatar_url or "").strip() or f"https://api.dicebear.com/7.x/bottts/svg?seed={user_in.username}",
            banner_url=(user_in.banner_url or "").strip(),
            bio="Olá! Estou usando o Resenha.",
            custom_status="",
            presence="online",
            # Sem e-mail configurado no servidor, o cadastro entra direto (como antes)
            email_verified=not mail.enabled(),
        )
        db.add(user)
    await db.commit()
    await db.refresh(user)
    hub.upsert_user(user)

    if user.email_verified:
        return _token(user)
    await _send_code(db, user, "verify")
    return VerificationRequired(email=user.email)


@router.post("/login", response_model=Union[Token, VerificationRequired])
async def login(user_in: UserLogin, db: AsyncSession = Depends(get_db)):
    user = await _user_by_email(db, user_in.email)
    if not user or not verify_password(user_in.password, user.password_hash):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
    if user.banned:
        raise HTTPException(status_code=403, detail="Esta conta está suspensa. Fale com o administrador do Resenha.")
    if not user.email_verified and mail.enabled():
        await _send_code(db, user, "verify")
        return VerificationRequired(email=user.email)
    return _token(user)


@router.post("/verify-email", response_model=Token)
async def verify_email(body: VerifyEmail, db: AsyncSession = Depends(get_db)):
    user = await _user_by_email(db, body.email)
    if not user or user.email_verified:
        raise HTTPException(status_code=400, detail=INVALID_CODE)
    await _check_code(db, user, "verify", body.code)
    user.email_verified = True
    await db.commit()
    await db.refresh(user)
    hub.upsert_user(user)
    return _token(user)


@router.post("/resend-verification")
async def resend_verification(body: EmailOnly, db: AsyncSession = Depends(get_db)):
    user = await _user_by_email(db, body.email)
    if user and not user.email_verified and mail.enabled():
        await _send_code(db, user, "verify")
    return {"ok": True}


@router.post("/forgot-password")
async def forgot_password(body: EmailOnly, db: AsyncSession = Depends(get_db)):
    """Responde ok mesmo sem conta com esse e-mail (não revela quem está cadastrado)."""
    if not mail.enabled():
        raise HTTPException(status_code=503, detail="A recuperação de senha por e-mail não está ativa neste servidor.")
    user = await _user_by_email(db, body.email)
    if user and not user.banned:
        await _send_code(db, user, "reset")
    return {"ok": True}


@router.post("/reset-password", response_model=Token)
async def reset_password(body: ResetPassword, db: AsyncSession = Depends(get_db)):
    user = await _user_by_email(db, body.email)
    if not user or user.banned:
        raise HTTPException(status_code=400, detail=INVALID_CODE)
    await _check_code(db, user, "reset", body.code)
    user.password_hash = hash_password(body.password)
    user.password_changed_at = utcnow()
    user.email_verified = True  # recebeu o código, então o e-mail é mesmo dela
    await db.commit()
    await db.refresh(user)
    hub.upsert_user(user)
    # As outras sessões (outros PCs, quem roubou a senha) caem e precisam da senha nova
    hub.revoke_sessions(user.id, "Sua senha foi alterada. Entre de novo com a senha nova.")
    return _token(user)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@router.put("/profile", response_model=UserResponse)
async def update_profile(
    user_update: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    changes = user_update.model_dump(exclude_none=True)
    new_name = changes.get("username")
    if new_name == current_user.username:
        changes.pop("username")
    elif new_name:
        taken = (await db.execute(
            select(User.id).where(func.lower(User.username) == new_name.lower(), User.id != current_user.id)
        )).first()
        if taken:
            raise HTTPException(status_code=400, detail="Este nome de usuário já está em uso.")
    presence_changed = "presence" in changes and changes["presence"] != current_user.presence
    for key, value in changes.items():
        setattr(current_user, key, value.strip() if isinstance(value, str) else value)
    await db.commit()
    await db.refresh(current_user)

    hub.upsert_user(current_user)
    hub.broadcast_user_update(current_user.id, presence_changed=presence_changed)
    return UserResponse.model_validate(current_user)


@router.get("/users/{user_id}", response_model=UserPublic)
async def get_user_profile(
    user_id: int,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    return UserPublic.model_validate(user)
