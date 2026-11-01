"""SFU falso que imita a API HTTPS do Cloudflare Realtime para testes."""
import itertools
import re
import secrets
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
sessions = {}  # sid -> {"tracks": {name: mid}}
mid_counter = itertools.count(10)
published = {}  # (sid, trackName) -> True


def auth(req: Request):
    if req.headers.get("authorization") != "Bearer secret-token":
        raise HTTPException(401, "bad token")


@app.post("/v1/apps/{app_id}/sessions/new")
async def new_session(app_id: str, req: Request):
    auth(req)
    sid = secrets.token_hex(8)
    sessions[sid] = {}
    return {"sessionId": sid}


@app.post("/v1/apps/{app_id}/sessions/{sid}/tracks/new")
async def tracks_new(app_id: str, sid: str, req: Request):
    auth(req)
    body = await req.json()
    if sid not in sessions:
        return {"errorCode": "session_not_found", "errorDescription": "no session"}
    tracks = body["tracks"]
    if tracks[0]["location"] == "local":
        assert body["sessionDescription"]["type"] == "offer"
        for t in tracks:
            published[(sid, t["trackName"])] = True
        return {
            "requiresImmediateRenegotiation": False,
            "tracks": [{"trackName": t["trackName"], "mid": t["mid"]} for t in tracks],
            "sessionDescription": {"type": "answer", "sdp": "v=0 fake-answer"},
        }
    out = []
    for t in tracks:
        if (t["sessionId"], t["trackName"]) not in published:
            out.append({**t, "errorCode": "not_found", "errorDescription": "Track not found"})
        else:
            out.append({"sessionId": t["sessionId"], "trackName": t["trackName"], "mid": str(next(mid_counter))})
    return {
        "requiresImmediateRenegotiation": True,
        "tracks": out,
        "sessionDescription": {"type": "offer", "sdp": "v=0 fake-offer"},
    }


@app.put("/v1/apps/{app_id}/sessions/{sid}/renegotiate")
async def renegotiate(app_id: str, sid: str, req: Request):
    auth(req)
    body = await req.json()
    assert body["sessionDescription"]["type"] == "answer"
    return {}


@app.put("/v1/apps/{app_id}/sessions/{sid}/tracks/close")
async def close(app_id: str, sid: str, req: Request):
    auth(req)
    body = await req.json()
    return {
        "requiresImmediateRenegotiation": False,
        "tracks": [{"mid": t["mid"]} for t in body["tracks"]],
        "sessionDescription": {"type": "answer", "sdp": "v=0 fake-close-answer"},
    }


# --- Resend falsa: guarda os e-mails para o teste ler o código ---------------------------------
emails = []  # {"to", "template", "variables", "idempotency_key", "from"}
fail_next_email = {"on": False}


@app.post("/resend/emails")
async def resend_send(req: Request):
    if req.headers.get("authorization") != "Bearer re_teste":
        raise HTTPException(401, "bad key")
    if fail_next_email["on"]:
        fail_next_email["on"] = False
        raise HTTPException(422, "falha simulada")
    body = await req.json()
    key = req.headers.get("idempotency-key")
    for e in emails:
        if key and e["idempotency_key"] == key:
            return {"id": e["id"]}
    # O servidor manda o e-mail pronto (assunto, html, texto): reconstrói modelo e variáveis do texto
    text = body["text"]
    template = "confirmar-email" if "confirmar" in body["subject"] else "redefinir-senha"
    variables = {"USERNAME": re.search(r"Oi, (.+?)!", text).group(1), "CODE": re.search(r"^(\d{6})$", text, re.M).group(1)}
    email = {"id": secrets.token_hex(8), "to": body["to"][0], "template": template,
             "variables": variables, "idempotency_key": key, "from": body["from"]}
    emails.append(email)
    return {"id": email["id"]}


@app.get("/resend/test/emails")
async def resend_list(to: str = ""):
    return [e for e in emails if not to or e["to"] == to]


@app.post("/resend/test/fail-next")
async def resend_fail_next():
    fail_next_email["on"] = True
    return {"ok": True}


# --- GitHub falso: releases/latest para a página de download -----------------------------------
FAKE_DL = "https://github.com/exemplo/resenha-releases/releases/download/v9.9.9"


@app.get("/github/repos/{owner}/{repo}/releases/latest")
async def github_latest(owner: str, repo: str):
    def asset(name, size):
        return {"name": name, "size": size, "browser_download_url": f"{FAKE_DL}/{name}"}
    return {
        "tag_name": "v9.9.9",
        "published_at": "2026-10-24T12:00:00Z",
        "assets": [
            asset("latest.yml", 345),
            asset("Resenha-Portable-9.9.9.exe", 98000000),
            asset("Resenha-Setup-9.9.9.exe.blockmap", 100000),
            asset("Resenha-Setup-9.9.9.exe", 98469130),
            asset("resenha-web-9.9.9.zip", 400000),
        ],
    }
