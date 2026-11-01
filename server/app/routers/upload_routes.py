import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.auth import get_current_user
from app.config import MAX_UPLOAD_BYTES, UPLOAD_DIR
from app.models import User
from app.schemas import MAX_ATTACHMENT_BYTES

router = APIRouter(prefix="/api/upload", tags=["upload"])

# SVG fica de fora: pode carregar scripts quando aberto diretamente
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
CHUNK_SIZE = 256 * 1024


def _looks_like_image(head: bytes, ext: str) -> bool:
    """Confere a assinatura do arquivo: a extensão sozinha não garante que é uma imagem."""
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in (".jpg", ".jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == ".gif":
        return head.startswith((b"GIF87a", b"GIF89a"))
    if ext == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    return False


async def _save_image(file: UploadFile, max_bytes: int) -> dict:
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Formato não permitido. Use: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    written = 0
    try:
        with open(path, "wb") as out:
            while chunk := await file.read(CHUNK_SIZE):
                if written == 0 and not _looks_like_image(chunk[:16], ext):
                    raise HTTPException(status_code=400, detail="O arquivo não é uma imagem válida.")
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(status_code=413, detail=f"Arquivo maior que {max_bytes // (1024 * 1024)} MB.")
                out.write(chunk)
        if written == 0:
            raise HTTPException(status_code=400, detail="Arquivo vazio.")
    except BaseException:
        if os.path.exists(path):
            os.remove(path)
        raise
    return {"url": f"/uploads/{filename}", "filename": filename, "size": written}


@router.post("/image")
async def upload_image(file: UploadFile = File(...), _: User = Depends(get_current_user)):
    """Fotos de perfil, banners e ícones de servidor."""
    return await _save_image(file, MAX_UPLOAD_BYTES)


@router.post("/attachment")
async def upload_attachment(file: UploadFile = File(...), _: User = Depends(get_current_user)):
    """Imagens anexadas a mensagens (limite de 8 MB; o app comprime as maiores antes de enviar)."""
    return await _save_image(file, MAX_ATTACHMENT_BYTES)
