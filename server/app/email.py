"""
E-mails do Resenha (confirmação de cadastro e recuperação de senha) pela Resend.

Os textos ficam aqui mesmo (não dependem de modelos criados no painel da Resend). Sem
RESEND_API_KEY ou EMAIL_FROM os e-mails ficam desligados: o cadastro entra direto
(útil em testes e na rede local).

Usa a API REST com httpx (já é dependência e é assíncrono) no lugar do SDK oficial,
que é síncrono e travaria o servidor durante o envio.
"""
import asyncio
import html
import logging
from typing import Optional

import httpx

from app.config import EMAIL_FROM, RESEND_API_BASE, RESEND_API_KEY

logger = logging.getLogger("resenha.email")

TEMPLATE_VERIFY = "confirmar-email"
TEMPLATE_RESET = "redefinir-senha"

# Assunto e frase de cada e-mail; {name} é o nome de usuário
TEXTS = {
    TEMPLATE_VERIFY: ("Seu código para confirmar o e-mail", "Use este código para confirmar o seu e-mail no Resenha:"),
    TEMPLATE_RESET: ("Seu código para redefinir a senha", "Use este código para criar uma senha nova no Resenha:"),
}


def render(template: str, variables: dict) -> dict:
    """Assunto, HTML e texto puro do e-mail (o código vale 15 minutos)."""
    subject, line = TEXTS[template]
    name = html.escape(str(variables.get("USERNAME", "")))
    code = html.escape(str(variables.get("CODE", "")))
    footer = "O código vale por 15 minutos. Se não foi você que pediu, pode ignorar este e-mail."
    body = (
        '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1f1f1f">'
        f"<p>Oi, {name}!</p><p>{line}</p>"
        f'<p style="font-size:32px;font-weight:800;letter-spacing:6px;margin:24px 0">{code}</p>'
        f'<p style="color:#666;font-size:13px">{footer}</p></div>'
    )
    text = f"Oi, {variables.get('USERNAME', '')}!\n\n{line}\n\n{variables.get('CODE', '')}\n\n{footer}"
    return {"subject": subject, "html": body, "text": text}


class EmailError(Exception):
    pass


def enabled() -> bool:
    return bool(RESEND_API_KEY and EMAIL_FROM)


async def send_template(to: str, template: str, variables: dict, idempotency_key: str) -> Optional[str]:
    """Envia um e-mail; tenta de novo em falha de rede, 5xx e 429. Retorna o id do e-mail."""
    headers = {"Authorization": f"Bearer {RESEND_API_KEY}", "Idempotency-Key": idempotency_key}
    payload = {"from": EMAIL_FROM, "to": [to], **render(template, variables)}
    delay = 1.0
    async with httpx.AsyncClient(timeout=10) as client:
        for attempt in range(4):
            try:
                res = await client.post(f"{RESEND_API_BASE}/emails", json=payload, headers=headers)
            except httpx.HTTPError as exc:
                logger.warning("Resend inacessível (tentativa %d): %s", attempt + 1, exc)
            else:
                if res.status_code < 300:
                    email_id = res.json().get("id")
                    logger.info("E-mail %s enviado (id %s)", template, email_id)
                    return email_id
                if res.status_code != 429 and res.status_code < 500:
                    logger.error("Resend recusou o e-mail %s: %s %s", template, res.status_code, res.text[:300])
                    raise EmailError(res.text[:300])
                retry_after = res.headers.get("retry-after")
                if retry_after and retry_after.isdigit():
                    delay = max(delay, float(retry_after))
                logger.warning("Resend respondeu %s (tentativa %d)", res.status_code, attempt + 1)
            await asyncio.sleep(delay)
            delay *= 2
    raise EmailError("Não foi possível enviar o e-mail agora.")
