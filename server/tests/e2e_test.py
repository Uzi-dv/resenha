"""Teste ponta-a-ponta do servidor Resenha v2 (REST + gateway + proxy RTC)."""
import asyncio
import json
import secrets
import sys

import httpx
import websockets

BASE = "http://127.0.0.1:8765"
WS = "ws://127.0.0.1:8765/ws"
FAKE_MAIL = "http://127.0.0.1:8766/resend/test"
GRACE = 2
failures = []


def check(cond, label):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        failures.append(label)


async def sent_emails(http, to):
    return (await http.get(f"{FAKE_MAIL}/emails", params={"to": to})).json()


async def last_code(http, to, template=None):
    mails = [m for m in await sent_emails(http, to) if not template or m["template"] == template]
    return mails[-1]["variables"]["CODE"] if mails else None


class Client:
    def __init__(self, http, name):
        self.http = http
        self.name = name
        self.events = []
        self.ws = None
        self.reader = None

    async def register(self):
        suffix = secrets.token_hex(3)
        r = await self.http.post(f"{BASE}/api/auth/register", json={
            "username": f"{self.name}{suffix}", "email": f"{self.name}{suffix}@t.com", "password": "123456"})
        r.raise_for_status()
        d = r.json()
        if d.get("verification_required"):
            # Confirma o e-mail com o código que a Resend falsa recebeu
            code = await last_code(self.http, d["email"])
            r = await self.http.post(f"{BASE}/api/auth/verify-email", json={"email": d["email"], "code": code})
            r.raise_for_status()
            d = r.json()
        self.token, self.user = d["access_token"], d["user"]
        self.h = {"Authorization": f"Bearer {self.token}"}

    async def connect(self):
        self.events = []
        self.ws = await websockets.connect(f"{WS}?token={self.token}")
        self.reader = asyncio.create_task(self._read())
        return await self.wait("READY")

    async def _read(self):
        try:
            async for raw in self.ws:
                self.events.append(json.loads(raw))
        except Exception:
            pass

    async def send(self, **msg):
        await self.ws.send(json.dumps(msg))

    async def wait(self, t, pred=lambda d: True, timeout=3.0):
        loop = asyncio.get_event_loop()
        end = loop.time() + timeout
        while loop.time() < end:
            for i, e in enumerate(self.events):
                if e["t"] == t and pred(e["d"]):
                    self.events.pop(i)
                    return e["d"]
            await asyncio.sleep(0.02)
        return None

    def has(self, t, pred=lambda d: True):
        return any(e["t"] == t and pred(e["d"]) for e in self.events)

    async def close(self):
        await self.ws.close()
        self.reader.cancel()


async def main():
    async with httpx.AsyncClient(timeout=10) as http:
        a, b, c = Client(http, "ana"), Client(http, "bia"), Client(http, "caio")
        for x in (a, b, c):
            await x.register()

        print("Servidor e convite")
        srv = (await http.post(f"{BASE}/api/servers", json={"name": "Teste"}, headers=a.h)).json()
        voice_ch = next(ch for ch in srv["channels"] if ch["type"] == "voice")
        text_ch = next(ch for ch in srv["channels"] if ch["type"] == "text")
        for x in (b, c):
            r = await http.post(f"{BASE}/api/servers/join", json={"invite_code": srv["invite_code"]}, headers=x.h)
            check(r.status_code == 200, f"{x.name} entrou no servidor")

        print("Presença")
        ready_a = await a.connect()
        check(ready_a is not None, "A recebe READY")
        ready_b = await b.connect()
        check(str(a.user["id"]) in ready_b["presences"], "B vê A online no READY")
        check(await a.wait("PRESENCE_UPDATE", lambda d: d["user_id"] == b.user["id"] and d["presence"] == "online") is not None,
              "A recebe B online")
        detail = (await http.get(f"{BASE}/api/servers/{srv['id']}", headers=c.h)).json()
        pres = {m["user_id"]: m["user"]["presence"] for m in detail["members"]}
        check(pres[c.user["id"]] == "offline" and pres[a.user["id"]] == "online", "Detalhe do servidor traz presença efetiva")

        print("Voz")
        await a.send(op="voice_join", channel_id=voice_ch["id"])
        joined = await a.wait("VOICE_JOINED")
        check(joined and joined["channel_id"] == voice_ch["id"] and not joined["has_session"], "A recebe VOICE_JOINED")
        check(await b.wait("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d["channel_id"] == voice_ch["id"]) is not None,
              "B vê A entrar na call")
        detail = (await http.get(f"{BASE}/api/servers/{srv['id']}", headers=c.h)).json()
        check(any(v["user_id"] == a.user["id"] for v in detail["voice_states"]), "C (offline) vê A na call ao carregar o servidor")
        await c.connect()
        ready_c = c.events and None
        # READY de C já foi consumido em connect(); refaz checagem via novo connect
        await c.close()
        ready_c = await c.connect()
        check(any(v["user_id"] == a.user["id"] for v in ready_c["voice_states"]), "READY de C contém A na call")

        print("RTC proxy")
        r = await http.post(f"{BASE}/api/rtc/session", headers=c.h)
        check(r.status_code == 409, "C fora da call não cria sessão (409)")
        r = await http.post(f"{BASE}/api/rtc/session", headers=a.h)
        check(r.status_code == 200, f"A cria sessão ({r.status_code} {r.text[:80]})")
        r = await http.post(f"{BASE}/api/rtc/publish", headers=a.h, json={
            "offer": {"type": "offer", "sdp": "v=0"}, "tracks": [{"mid": "0", "kind": "mic"}]})
        pub = r.json()
        check(r.status_code == 200 and pub["answer"]["type"] == "answer" and not pub["tracks"][0]["error"], "A publica mic")
        print("v2.5: câmera")
        r = await http.post(f"{BASE}/api/rtc/publish", headers=a.h, json={
            "offer": {"type": "offer", "sdp": "v=0"}, "tracks": [{"mid": "9", "kind": "camera"}]})
        check(r.status_code == 200, "Publicar câmera é aceito")
        ev = await b.wait("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d.get("has_camera"))
        check(ev is not None, "Estado de voz avisa câmera ligada")
        await http.post(f"{BASE}/api/rtc/unpublish", headers=a.h, json={
            "offer": {"type": "offer", "sdp": "v=0"}, "tracks": [{"mid": "9", "kind": "camera"}]})
        ev = await b.wait("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d.get("has_camera") is False)
        check(ev is not None, "Estado de voz avisa câmera desligada")
        upd = await b.wait("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d.get("tracks", {}).get("mic"))
        check(upd is not None, "B recebe track de mic de A")

        await b.send(op="voice_join", channel_id=voice_ch["id"])
        await b.wait("VOICE_JOINED")
        await http.post(f"{BASE}/api/rtc/session", headers=b.h)
        r = await http.post(f"{BASE}/api/rtc/subscribe", headers=b.h, json={"tracks": [
            {"user_id": a.user["id"], "kind": "mic"}, {"user_id": a.user["id"], "kind": "screen"}]})
        sub = r.json()
        mic = next(t for t in sub["tracks"] if t["kind"] == "mic")
        scr = next(t for t in sub["tracks"] if t["kind"] == "screen")
        check(sub["requires_renegotiation"] and sub["offer"]["type"] == "offer" and mic["mid"] and not mic["error"],
              "B assina mic de A e recebe offer + mid")
        check(scr["error"], "Assinar tela inexistente retorna erro por track")
        r = await http.put(f"{BASE}/api/rtc/renegotiate", headers=b.h, json={"answer": {"type": "answer", "sdp": "v=0"}})
        check(r.status_code == 200, "B renegocia")
        r = await http.post(f"{BASE}/api/rtc/subscribe", headers=c.h, json={"tracks": [{"user_id": a.user["id"], "kind": "mic"}]})
        check(r.status_code == 409, "C fora da call não assina tracks")

        r = await http.post(f"{BASE}/api/rtc/publish", headers=a.h, json={
            "offer": {"type": "offer", "sdp": "v=0"}, "tracks": [{"mid": "1", "kind": "screen"}, {"mid": "2", "kind": "screen_audio"}]})
        upd = await b.wait("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d["is_sharing_screen"])
        check(upd is not None, "B vê A compartilhando tela")

        print("Codecs de vídeo")
        await a.send(op="voice_update", encode=["H264", "AV1", "VP8"], decode=["H264"],
                     video_codecs={"screen": "AV1", "camera": "AV1"})
        ev = await b.wait("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d.get("video_codecs", {}).get("screen") == "AV1")
        check(ev is not None and ev["encode"] == ["AV1", "H264"] and ev["decode"] == ["H264"] and "camera" not in ev["video_codecs"],
              "Capacidades e codec da tela aparecem (codecs desconhecidos e vídeos sem track são ignorados)")
        await b.send(op="voice_update", watching=[a.user["id"], b.user["id"]])
        ev = await a.wait("VOICE_STATE_UPDATE", lambda d: d["user_id"] == b.user["id"] and d.get("watching"))
        check(ev is not None and ev["watching"] == [a.user["id"]], "Publicador vê quem assiste (sem a própria pessoa)")
        b.events.clear()
        r = await http.post(f"{BASE}/api/rtc/unpublish", headers=a.h, json={
            "offer": {"type": "offer", "sdp": "v=0"}, "tracks": [{"mid": "1", "kind": "screen"}], "replaced": True})
        await asyncio.sleep(0.3)
        check(r.status_code == 200 and not b.has("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"]),
              "Fechar o transceiver antigo (troca de codec) não encerra a transmissão")
        r = await http.post(f"{BASE}/api/rtc/unpublish", headers=a.h, json={
            "offer": {"type": "offer", "sdp": "v=0"}, "tracks": [{"mid": "1", "kind": "screen"}, {"mid": "2", "kind": "screen_audio"}]})
        upd = await b.wait("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and not d["is_sharing_screen"])
        check(r.status_code == 200 and upd is not None, "A para de compartilhar e B é notificado")

        print("Mute")
        await a.send(op="voice_update", muted=True, deafened=False)
        check(await b.wait("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d["is_muted"]) is not None, "B vê A mutado")

        print("Reconexão dentro da tolerância")
        await a.close()
        check(await b.wait("PRESENCE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d["presence"] == "offline") is not None,
              "B vê A offline quando o socket cai")
        await asyncio.sleep(0.5)
        check(not b.has("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d["channel_id"] is None),
              "A continua na call durante a tolerância")
        await a.connect()
        await a.send(op="voice_join", channel_id=voice_ch["id"])
        rj = await a.wait("VOICE_JOINED")
        check(rj and rj["has_session"] and rj["tracks"].get("mic"), "A retoma a call com a mesma sessão e tracks")
        await asyncio.sleep(GRACE + 1)
        check(not b.has("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d["channel_id"] is None),
              "A não é removido depois que a tolerância expira (pois reconectou)")

        print("Queda sem reconexão")
        await a.close()
        left = await b.wait("VOICE_STATE_UPDATE", lambda d: d["user_id"] == a.user["id"] and d["channel_id"] is None, timeout=GRACE + 3)
        check(left is not None, "A é removido da call após a tolerância")

        print("Mensagens")
        for i in range(120):
            await http.post(f"{BASE}/api/channels/{text_ch['id']}/messages", json={"content": f"msg {i}"}, headers=b.h)
        latest = (await http.get(f"{BASE}/api/channels/{text_ch['id']}/messages", headers=b.h)).json()
        check(len(latest) == 50 and latest[-1]["content"] == "msg 119" and latest[0]["content"] == "msg 70",
              "Histórico traz as 50 mais recentes em ordem")
        older = (await http.get(f"{BASE}/api/channels/{text_ch['id']}/messages?before={latest[0]['id']}", headers=b.h)).json()
        check(older[-1]["content"] == "msg 69", "Paginação com before")
        check(c.has("MESSAGE_CREATE", lambda d: d["channel_id"] == text_ch["id"]), "C recebe MESSAGE_CREATE")
        outsider = Client(http, "zed")
        await outsider.register()
        r = await http.get(f"{BASE}/api/channels/{text_ch['id']}/messages", headers=outsider.h)
        check(r.status_code == 403, "Não-membro não lê o canal")
        mid = latest[-1]["id"]
        r = await http.patch(f"{BASE}/api/channels/{text_ch['id']}/messages/{mid}", json={"content": "editada"}, headers=c.h)
        check(r.status_code == 403, "Outro usuário não edita mensagem alheia")
        r = await http.delete(f"{BASE}/api/channels/{text_ch['id']}/messages/{mid}", headers=a.h)
        check(r.status_code == 200, "Dono do servidor apaga mensagem")

        print("Digitação e robustez")
        await b.send(op="typing", channel_id=text_ch["id"])
        check(await c.wait("TYPING_START", lambda d: d["user_id"] == b.user["id"]) is not None, "C vê B digitando")
        check(not b.has("TYPING_START"), "B não recebe a própria digitação")
        await c.ws.send("isso não é json")
        await c.send(op="voice_join", channel_id="abc")
        await c.send(op="heartbeat", t=1)
        check(await c.wait("HEARTBEAT_ACK") is not None, "Conexão sobrevive a mensagens malformadas")

        try:
            ws = await websockets.connect(f"{WS}?token=invalido")
            await ws.recv()
        except websockets.ConnectionClosed as e:
            check(e.rcvd.code == 4001, "Token inválido fecha com código 4001")

        print("DMs")
        conv = (await http.post(f"{BASE}/api/dm/conversations", json={"target_user_id": c.user["id"]}, headers=b.h)).json()
        await http.post(f"{BASE}/api/dm/conversations/{conv['id']}/messages", json={"content": "oi"}, headers=b.h)
        check(await c.wait("DM_MESSAGE_CREATE", lambda d: d["conversation_id"] == conv["id"]) is not None, "C recebe DM")
        convs = (await http.get(f"{BASE}/api/dm/conversations", headers=c.h)).json()
        check(convs[0]["last_message"]["content"] == "oi", "Lista de DMs traz última mensagem")
        r = await http.post(f"{BASE}/api/dm/conversations/{conv['id']}/messages", json={"content": "x"}, headers=outsider.h)
        check(r.status_code == 403, "Terceiro não envia DM em conversa alheia")

        print("Foto de perfil")
        d, e = Client(http, "dani"), Client(http, "edu")
        for x in (d, e):
            await x.register()
        await e.connect()
        await http.post(f"{BASE}/api/dm/conversations", json={"target_user_id": e.user["id"]}, headers=d.h)
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
               b"\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")
        r = await http.post(f"{BASE}/api/upload/image", files={"file": ("foto.png", png, "image/png")})
        check(r.status_code == 401, "Upload exige login")
        r = await http.post(f"{BASE}/api/upload/image", files={"file": ("foto.png", png, "image/png")}, headers=d.h)
        url = r.json().get("url", "")
        check(r.status_code == 200 and url.startswith("/uploads/"), "Upload de imagem retorna URL")
        r = await http.get(f"{BASE}{url}")
        check(r.status_code == 200 and r.content == png, "Imagem enviada é servida")
        r = await http.put(f"{BASE}/api/auth/profile", json={"avatar_url": url}, headers=d.h)
        check(r.status_code == 200, "Perfil salvo com a foto enviada")
        upd = await e.wait("USER_UPDATE", lambda u: u["id"] == d.user["id"] and u["avatar_url"] == url)
        check(upd is not None, "Contato só de DM recebe a nova foto na hora")
        r = await http.put(f"{BASE}/api/auth/profile", json={"avatar_url": "javascript:alert(1)"}, headers=d.h)
        check(r.status_code == 422, "Link de foto inválido é recusado")
        await b.wait("USER_UPDATE", timeout=0.2)
        await http.put(f"{BASE}/api/auth/profile", json={"avatar_url": "https://example.com/nova.png"}, headers=c.h)
        check(await b.wait("USER_UPDATE", lambda u: u["id"] == c.user["id"] and u["avatar_url"].endswith("nova.png")) is not None,
              "Membro do servidor recebe a nova foto na hora")

        print("Troca de nick")
        await b.send(op="voice_join", channel_id=voice_ch["id"])
        await b.wait("VOICE_JOINED")
        novo = f"Pilantrones{secrets.token_hex(2)}"
        r = await http.put(f"{BASE}/api/auth/profile", json={"username": f"  {novo}  "}, headers=b.h)
        check(r.status_code == 200 and r.json()["username"] == novo, "Troca de nick salva (espaços nas pontas removidos)")
        check(await c.wait("USER_UPDATE", lambda u: u["id"] == b.user["id"] and u["username"] == novo) is not None,
              "Outros membros recebem o nick novo na hora")
        check(await c.wait("VOICE_STATE_UPDATE", lambda v: v["user_id"] == b.user["id"] and v.get("username") == novo) is not None,
              "Nick novo aparece também na call")
        r = await http.put(f"{BASE}/api/auth/profile", json={"username": novo.upper()}, headers=c.h)
        check(r.status_code == 400 and "uso" in r.json()["detail"], "Nick já usado (mesmo com outra caixa) é recusado")
        r = await http.put(f"{BASE}/api/auth/profile", json={"username": " x "}, headers=c.h)
        check(r.status_code == 422, "Nick curto demais é recusado")
        r = await http.put(f"{BASE}/api/auth/profile", json={"username": novo.lower()}, headers=b.h)
        check(r.status_code == 200, "Pode mudar só as maiúsculas do próprio nick")
        msgs = (await http.get(f"{BASE}/api/channels/{text_ch['id']}/messages?limit=1", headers=c.h)).json()
        check(msgs[-1]["author"]["username"] == novo.lower(), "Mensagens antigas mostram o nick atual")
        r = await http.post(f"{BASE}/api/auth/login", json={"email": b.user["email"], "password": "123456"})
        check(r.status_code == 200, "Login (por e-mail) continua funcionando após trocar o nick")

        print("Enquetes")
        r = await http.post(f"{BASE}/api/channels/{text_ch['id']}/polls", headers=a.h,
                            json={"question": "Qual jogo hoje?", "options": ["CS2", "Valorant", " "], "multiple": False})
        check(r.status_code == 200 and len(r.json()["poll"]["options"]) == 2, "Cria enquete (opção vazia descartada)")
        msg = r.json()
        poll = msg["poll"]
        check(await c.wait("MESSAGE_CREATE", lambda d: d.get("poll") and d["poll"]["id"] == poll["id"]) is not None,
              "Membros recebem a enquete em tempo real")
        r = await http.post(f"{BASE}/api/channels/{text_ch['id']}/polls", headers=a.h,
                            json={"question": "x", "options": ["A", "a"]})
        check(r.status_code == 422, "Opções repetidas são recusadas")
        cs, val = poll["options"][0]["id"], poll["options"][1]["id"]
        r = await http.post(f"{BASE}/api/polls/{poll['id']}/vote", headers=c.h, json={"option_ids": [cs, val]})
        check(r.status_code == 400, "Escolha única não aceita 2 opções")
        await http.post(f"{BASE}/api/polls/{poll['id']}/vote", headers=c.h, json={"option_ids": [cs]})
        r = await http.post(f"{BASE}/api/polls/{poll['id']}/vote", headers=a.h, json={"option_ids": [cs]})
        p2 = r.json()["poll"]
        check(p2["options"][0]["votes"] == 2 and p2["total_voters"] == 2, "Votos contabilizados")
        upd = await c.wait("MESSAGE_UPDATE", lambda d: d["id"] == msg["id"] and d["poll"]["total_voters"] == 2)
        check(upd is not None, "Resultado atualiza em tempo real para todos")
        r = await http.post(f"{BASE}/api/polls/{poll['id']}/vote", headers=c.h, json={"option_ids": [val]})
        p3 = r.json()["poll"]
        check(p3["options"][0]["votes"] == 1 and p3["options"][1]["voters"] == [c.user["id"]], "Trocar de voto substitui o anterior")
        r = await http.post(f"{BASE}/api/polls/{poll['id']}/close", headers=c.h)
        check(r.status_code == 403, "Só o autor encerra a enquete")
        await http.post(f"{BASE}/api/polls/{poll['id']}/close", headers=a.h)
        r = await http.post(f"{BASE}/api/polls/{poll['id']}/vote", headers=c.h, json={"option_ids": [cs]})
        check(r.status_code == 400, "Enquete encerrada não aceita votos")
        r = await http.patch(f"{BASE}/api/channels/{text_ch['id']}/messages/{msg['id']}", headers=a.h, json={"content": "x"})
        check(r.status_code == 400, "Enquete não pode ser editada")
        hist = (await http.get(f"{BASE}/api/channels/{text_ch['id']}/messages?limit=5", headers=c.h)).json()
        check(any(m.get("poll") and m["poll"]["closed"] for m in hist), "Histórico traz a enquete com resultado")
        r = await http.post(f"{BASE}/api/polls/{poll['id']}/vote", headers=outsider.h, json={"option_ids": [cs]})
        check(r.status_code == 403, "Quem não é membro não vota")
        r = await http.delete(f"{BASE}/api/channels/{text_ch['id']}/messages/{msg['id']}", headers=a.h)
        check(r.status_code == 200, "Apagar a mensagem da enquete remove tudo")

        print("Ordem dos servidores")
        s2 = (await http.post(f"{BASE}/api/servers", json={"name": "Segundo"}, headers=a.h)).json()
        ids = [s["id"] for s in (await http.get(f"{BASE}/api/servers", headers=a.h)).json()]
        check(ids[-1] == s2["id"], "Servidor novo entra no fim da lista")
        await http.put(f"{BASE}/api/servers/order", json={"server_ids": list(reversed(ids))}, headers=a.h)
        ids2 = [s["id"] for s in (await http.get(f"{BASE}/api/servers", headers=a.h)).json()]
        check(ids2 == list(reversed(ids)), "Nova ordem é salva no servidor")
        await http.post(f"{BASE}/api/polls/0/vote", headers=a.h, json={"option_ids": []})
        await http.delete(f"{BASE}/api/servers/{s2['id']}", headers=a.h)

        print("v2.4: respostas, anexos e reações")
        ch = text_ch['id']
        orig = (await http.post(f"{BASE}/api/channels/{ch}/messages", json={"content": "original"}, headers=a.h)).json()
        r = await http.post(f"{BASE}/api/upload/attachment", files={"file": ("x.png", png, "image/png")}, headers=b.h)
        att = r.json()
        check(r.status_code == 200 and att.get("size") == len(png), "Upload de anexo retorna URL e tamanho")
        r = await http.post(f"{BASE}/api/upload/attachment", files={"file": ("x.png", b"<script>alert(1)</script>", "image/png")}, headers=b.h)
        check(r.status_code == 400, "Arquivo que não é imagem é recusado")
        r = await http.post(f"{BASE}/api/upload/attachment", files={"file": ("big.png", png + b"0" * (8 * 1024 * 1024), "image/png")}, headers=b.h)
        check(r.status_code == 413, "Anexo acima de 8 MB é recusado")
        r = await http.post(f"{BASE}/api/channels/{ch}/messages", headers=b.h, json={
            "content": "", "reply_to_id": orig["id"],
            "attachments": [{"url": att["url"], "name": "x.png", "size": att["size"], "width": 1, "height": 1}]})
        reply = r.json()
        check(r.status_code == 200 and reply["reply_to"]["id"] == orig["id"] and reply["reply_to"]["author"]["id"] == a.user["id"],
              "Resposta traz o resumo da original")
        check(len(reply["attachments"]) == 1 and reply["attachments"][0]["width"] == 1, "Mensagem só com anexo é aceita")
        ev = await b.wait("MESSAGE_CREATE", lambda d: d["id"] == reply["id"])
        check(ev is not None and ev["reply_to"]["id"] == orig["id"], "Gateway entrega a resposta com o resumo")
        r = await http.post(f"{BASE}/api/channels/{ch}/messages", headers=b.h, json={"content": "x", "attachments": [{"url": "https://evil.com/a.png"}]})
        check(r.status_code == 422, "Anexo com URL externa é recusado")
        r = await http.post(f"{BASE}/api/channels/{ch}/messages", headers=b.h, json={"content": ""})
        check(r.status_code == 422, "Mensagem vazia sem anexo é recusada")
        r = await http.post(f"{BASE}/api/channels/{ch}/messages", headers=b.h, json={"content": "x", "reply_to_id": 999999})
        check(r.status_code == 400, "Resposta a mensagem de outro canal é recusada")
        thumbs = "%F0%9F%91%8D"
        r = await http.put(f"{BASE}/api/channels/{ch}/messages/{orig['id']}/reactions/{thumbs}", headers=b.h)
        await http.put(f"{BASE}/api/channels/{ch}/messages/{orig['id']}/reactions/{thumbs}", headers=b.h)
        r = await http.put(f"{BASE}/api/channels/{ch}/messages/{orig['id']}/reactions/{thumbs}", headers=c.h)
        check(r.status_code == 200 and r.json()["reactions"] == [{"emoji": "👍", "count": 2, "users": [b.user["id"], c.user["id"]]}],
              "Reações agregadas e sem duplicar")
        ev = await b.wait("MESSAGE_REACTIONS", lambda d: d["message_id"] == orig["id"] and d["reactions"] and d["reactions"][0]["count"] == 2)
        check(ev is not None, "Gateway avisa as reações")
        r = await http.put(f"{BASE}/api/channels/{ch}/messages/{orig['id']}/reactions/abc", headers=b.h)
        check(r.status_code == 400, "Reação que não é emoji é recusada")
        r = await http.delete(f"{BASE}/api/channels/{ch}/messages/{orig['id']}/reactions/{thumbs}", headers=b.h)
        check(r.json()["reactions"][0]["count"] == 1, "Remover reação")
        r = await http.put(f"{BASE}/api/channels/{ch}/messages/{orig['id']}/reactions/{thumbs}", headers=outsider.h)
        check(r.status_code == 403, "Quem não é membro não reage")
        hist = (await http.get(f"{BASE}/api/channels/{ch}/messages", headers=b.h)).json()
        o = next(m for m in hist if m["id"] == orig["id"])
        check(o["reactions"][0]["users"] == [c.user["id"]], "Histórico traz as reações")
        await http.delete(f"{BASE}/api/channels/{ch}/messages/{orig['id']}", headers=a.h)
        hist = (await http.get(f"{BASE}/api/channels/{ch}/messages", headers=b.h)).json()
        rr = next(m for m in hist if m["id"] == reply["id"])
        check(rr["reply_to"] is None and rr["reply_to_id"] == orig["id"], "Original apagada: resposta continua sem o resumo")
        dconv = (await http.post(f"{BASE}/api/dm/conversations", json={"target_user_id": c.user["id"]}, headers=b.h)).json()
        d1 = (await http.post(f"{BASE}/api/dm/conversations/{dconv['id']}/messages", json={"content": "oi dm"}, headers=b.h)).json()
        r = await http.post(f"{BASE}/api/dm/conversations/{dconv['id']}/messages", headers=c.h, json={"content": "resp", "reply_to_id": d1["id"]})
        check(r.status_code == 200 and r.json()["reply_to"]["author"]["id"] == b.user["id"], "Resposta em DM")
        r = await http.put(f"{BASE}/api/dm/conversations/{dconv['id']}/messages/{d1['id']}/reactions/{thumbs}", headers=c.h)
        check(r.status_code == 200 and r.json()["reactions"][0]["count"] == 1, "Reação em DM")
        ev = await b.wait("DM_MESSAGE_REACTIONS", lambda d: d["message_id"] == d1["id"])
        check(ev is not None, "Gateway avisa reação em DM")
        convs = (await http.get(f"{BASE}/api/dm/conversations", headers=b.h)).json()
        check(any(cv["id"] == dconv["id"] and cv["last_message"]["reply_to"] for cv in convs), "Lista de DMs serializa a última mensagem com resposta")

        print("v2.6: super admin")
        import os, sqlite3
        boss = Client(http, "boss"); await boss.register()
        alvo = Client(http, "alvo"); await alvo.register()
        await http.post(f"{BASE}/api/servers/join", json={"invite_code": srv["invite_code"]}, headers=alvo.h)
        r = await http.get(f"{BASE}/api/admin/users", headers=boss.h)
        check(r.status_code == 403, "Sem super admin, o painel é recusado")
        db = sqlite3.connect(os.environ["E2E_DB"]); db.execute("UPDATE users SET is_superadmin = 1 WHERE id = ?", (boss.user["id"],)); db.commit(); db.close()
        me = (await http.get(f"{BASE}/api/auth/me", headers=boss.h)).json()
        check(me.get("is_superadmin") is True, "/auth/me informa o super admin")
        await alvo.connect()
        await alvo.send(op="voice_join", channel_id=voice_ch["id"])
        await alvo.wait("VOICE_JOINED")
        users = (await http.get(f"{BASE}/api/admin/users", headers=boss.h)).json()
        u = next(x for x in users if x["id"] == alvo.user["id"])
        check(u["voice"] and u["voice"]["channel_id"] == voice_ch["id"] and u["presence"] != "offline", "Lista mostra quem está em call e online")
        servers = (await http.get(f"{BASE}/api/admin/servers", headers=boss.h)).json()
        check(any(x["id"] == srv["id"] and x["in_voice"] >= 1 for x in servers), "Lista de servidores com pessoas em call")
        r = await http.post(f"{BASE}/api/admin/users/{alvo.user['id']}/disconnect-voice", headers=boss.h)
        ev = await alvo.wait("VOICE_DISCONNECTED", lambda d: d.get("reason") == "admin")
        check(r.status_code == 200 and ev is not None, "Super admin tira alguém da call")
        r = await http.post(f"{BASE}/api/admin/users/{boss.user['id']}/revoke-sessions", headers=boss.h)
        check(r.status_code == 400, "Não dá para moderar a si mesmo")
        r = await http.post(f"{BASE}/api/admin/users/{alvo.user['id']}/revoke-sessions", headers=boss.h)
        ev = await alvo.wait("SESSION_REVOKED")
        check(r.status_code == 200 and ev is not None, "Super admin encerra a sessão (aviso antes de fechar)")
        await asyncio.sleep(0.3)
        check(alvo.ws.close_code == 4001, "Conexão encerrada com 4001 (o app faz logout)")
        r = await http.patch(f"{BASE}/api/admin/users/{alvo.user['id']}", json={"username": "Renomeado" + secrets.token_hex(2)}, headers=boss.h)
        check(r.status_code == 200 and r.json()["username"].startswith("Renomeado"), "Super admin renomeia usuário")
        r = await http.post(f"{BASE}/api/admin/users/{alvo.user['id']}/ban", json={"banned": True}, headers=boss.h)
        check(r.status_code == 200, "Super admin suspende conta")
        r = await http.get(f"{BASE}/api/auth/me", headers=alvo.h)
        check(r.status_code == 401 and "suspensa" in r.json()["detail"], "Conta suspensa perde o acesso")
        r = await http.post(f"{BASE}/api/auth/login", json={"email": alvo.user["email"], "password": "123456"})
        check(r.status_code == 403, "Conta suspensa não consegue entrar")
        try:
            ws = await websockets.connect(f"{WS}?token={alvo.token}")
            await asyncio.wait_for(ws.recv(), 2)
            refused = False
        except Exception:
            refused = True
        check(refused, "Conta suspensa não conecta no gateway")
        await http.post(f"{BASE}/api/admin/users/{alvo.user['id']}/ban", json={"banned": False}, headers=boss.h)
        r = await http.post(f"{BASE}/api/auth/login", json={"email": alvo.user["email"], "password": "123456"})
        check(r.status_code == 200, "Reativar conta devolve o acesso")
        r = await http.post(f"{BASE}/api/admin/users/{alvo.user['id']}/ban", json={"banned": True}, headers=alvo.h)
        check(r.status_code == 403, "Usuário comum não usa as rotas de admin")

        print("v2.7: cargos")
        sid = srv["id"]
        R = f"{BASE}/api/servers/{sid}"
        det = (await http.get(R, headers=b.h)).json()
        everyone = next((r for r in det["roles"] if r["is_default"]), None)
        check(everyone is not None and everyone["name"] == "@everyone", "Servidor tem o cargo @everyone")
        check(all("role_ids" in m for m in det["members"]), "Membros trazem os cargos")
        r = await http.post(f"{R}/channels", json={"name": "sem-permissao", "type": "text"}, headers=c.h)
        check(r.status_code == 403, "Sem permissão, membro não cria canal")
        r = await http.post(f"{R}/roles", json={"name": "Mod", "color": "#3498db", "hoist": True, "permissions": 8 | 16 | 32}, headers=a.h)
        mod = r.json()
        ev = await b.wait("ROLES_UPDATE", lambda d: any(x["id"] == mod.get("id") for x in d["roles"]))
        check(r.status_code == 200 and mod["hoist"] and ev is not None, "Dono cria cargo e todos recebem ROLES_UPDATE")
        r = await http.put(f"{R}/members/{b.user['id']}/roles", json={"role_ids": [mod["id"]]}, headers=a.h)
        ev = await b.wait("MEMBER_ROLES_UPDATE", lambda d: d["user_id"] == b.user["id"] and mod["id"] in d["role_ids"])
        check(r.status_code == 200 and ev is not None, "Dar cargo a um membro avisa todos")
        r = await http.post(f"{R}/channels", json={"name": "do-mod", "type": "text"}, headers=b.h)
        check(r.status_code == 200, "Cargo com Gerenciar canais cria canal")
        await http.delete(f"{R}/channels/{r.json()['id']}", headers=b.h)
        r = await http.post(f"{R}/roles", json={"name": "Tentativa"}, headers=b.h)
        check(r.status_code == 403, "Sem Gerenciar cargos, não cria cargo")
        r = await http.post(f"{R}/roles", json={"name": "Gerente", "permissions": 4 | 16}, headers=a.h)
        gerente = r.json()
        await http.put(f"{R}/members/{b.user['id']}/roles", json={"role_ids": [mod["id"], gerente["id"]]}, headers=a.h)
        r = await http.post(f"{R}/roles", json={"name": "Baixo", "color": "#2ecc71"}, headers=b.h)
        baixo = r.json()
        check(r.status_code == 200 and baixo["position"] == 1, "Gerente cria cargo (entra logo acima do @everyone)")
        r = await http.patch(f"{R}/roles/{mod['id']}", json={"name": "Hackeado"}, headers=b.h)
        check(r.status_code == 403, "Não dá para editar cargo do próprio nível ou acima")
        r = await http.post(f"{R}/roles", json={"name": "Admin falso", "permissions": 1}, headers=b.h)
        check(r.status_code == 403, "Não dá para dar uma permissão que não tem")
        r = await http.put(f"{R}/members/{c.user['id']}/roles", json={"role_ids": [baixo["id"]]}, headers=b.h)
        check(r.status_code == 200, "Gerente dá cargo abaixo do seu a outro membro")
        r = await http.put(f"{R}/members/{c.user['id']}/roles", json={"role_ids": [mod["id"]]}, headers=b.h)
        check(r.status_code == 403, "Gerente não dá um cargo do seu nível")
        r = await http.delete(f"{R}/members/{a.user['id']}", headers=b.h)
        check(r.status_code == 403, "Ninguém expulsa o dono")
        roles_now = [x for x in (await http.get(R, headers=a.h)).json()["roles"] if not x["is_default"]]
        ids = [x["id"] for x in roles_now]
        r = await http.put(f"{R}/roles/order", json={"role_ids": list(reversed(ids))}, headers=b.h)
        check(r.status_code == 403, "Gerente não reordena cargos acima dele")
        r = await http.put(f"{R}/roles/order", json={"role_ids": list(reversed(ids))}, headers=a.h)
        new = {x["id"]: x["position"] for x in r.json()["roles"]}
        check(r.status_code == 200 and new[ids[-1]] > new[ids[0]], "Dono reordena os cargos")
        r = await http.patch(f"{R}/roles/{everyone['id']}", json={"permissions": 8, "name": "ignorado"}, headers=a.h)
        check(r.status_code == 200 and r.json()["name"] == "@everyone" and r.json()["permissions"] == 8, "@everyone só muda permissões")
        r = await http.post(f"{R}/channels", json={"name": "geral-2", "type": "text"}, headers=c.h)
        check(r.status_code == 200, "Permissão no @everyone vale para todos")
        await http.delete(f"{R}/channels/{r.json()['id']}", headers=a.h)
        await http.patch(f"{R}/roles/{everyone['id']}", json={"permissions": 0}, headers=a.h)
        r = await http.delete(f"{R}/roles/{everyone['id']}", headers=a.h)
        check(r.status_code == 400, "@everyone não pode ser excluído")
        r = await http.delete(f"{R}/roles/{baixo['id']}", headers=a.h)
        det = (await http.get(R, headers=a.h)).json()
        cm = next(m for m in det["members"] if m["user_id"] == c.user["id"])
        check(r.status_code == 200 and baixo["id"] not in cm["role_ids"], "Excluir cargo tira o cargo dos membros")
        positions = sorted(x["position"] for x in det["roles"] if not x["is_default"])
        check(positions == list(range(1, len(positions) + 1)), "Posições continuam sem buracos")

        print("v2.8: versão web")
        r = await http.get(f"{BASE}/", headers={"Accept": "application/json"})
        check(r.status_code == 200 and r.json().get("status") == "online", "App desktop continua recebendo o status em /")
        r = await http.get(f"{BASE}/", headers={"Accept": "text/html,application/xhtml+xml"})
        check(r.status_code == 200 and "Resenha web" in r.text and r.headers.get("cache-control") == "no-cache", "Navegador recebe o app web em /")
        r = await http.get(f"{BASE}/assets/app-123.js")
        check(r.status_code == 200 and "resenha" in r.text and "immutable" in r.headers.get("cache-control", ""), "Arquivos do app web com cache longo")
        r = await http.get(f"{BASE}/qualquer/rota", headers={"Accept": "text/html"})
        check(r.status_code == 200 and "Resenha web" in r.text, "Rotas desconhecidas abrem o app (página única)")
        r = await http.get(f"{BASE}/api/nao-existe")
        check(r.status_code == 404 and r.headers.get("content-type", "").startswith("application/json"), "/api inexistente continua sendo 404 da API")
        r = await http.get(f"{BASE}/..%2F..%2Fapp%2Fmain.py")
        check("APP_VERSION" not in r.text, "Não dá para ler arquivos fora da pasta web")
        r = await http.get(f"{BASE}/api/status")
        check(r.status_code == 200 and "version" in r.json(), "/api/status responde")

        print("v2.10.1: página de download")
        r = await http.get(f"{BASE}/download", headers={"Accept": "application/json"})
        check(r.status_code == 200 and r.headers.get("content-type", "").startswith("text/html")
              and "Baixar para Windows" in r.text and 'href="/download/windows"' in r.text, "/download entrega a página (mesmo pedindo JSON)")
        r = await http.get(f"{BASE}/download/assets/resenha-logo.svg")
        check(r.status_code == 200 and "<svg" in r.text, "Assets da página em /download/assets")
        r = await http.get(f"{BASE}/download/windows")
        check(r.status_code == 302 and r.headers.get("location", "").endswith("/v9.9.9/Resenha-Setup-9.9.9.exe"),
              "/download/windows redireciona para o Setup mais novo (não para o .blockmap)")
        r = await http.get(f"{BASE}/api/download")
        check(r.status_code == 200 and r.json() == {
            "version": "9.9.9",
            "setup_url": "https://github.com/exemplo/resenha-releases/releases/download/v9.9.9/Resenha-Setup-9.9.9.exe",
            "setup_size": 98469130,
            "portable_url": "https://github.com/exemplo/resenha-releases/releases/download/v9.9.9/Resenha-Portable-9.9.9.exe",
            "published_at": "2026-10-24T12:00:00Z",
        }, "/api/download responde versão, links e tamanho")
        r = await http.get(f"{BASE}/download/")
        check(r.status_code == 301 and r.headers.get("location") == "/download", "/download/ (com barra) leva para /download")
        r = await http.get(f"{BASE}/download/nao-existe", headers={"Accept": "text/html"})
        check(r.status_code == 404, "Rota desconhecida em /download não abre o app web")
        r = await http.get(f"{BASE}/downloads-e-mais", headers={"Accept": "text/html"})
        check(r.status_code == 200 and "Resenha web" in r.text, "Rota coringa do app web continua funcionando")
        r = await http.get(f"{BASE}/", headers={"Accept": "text/html"})
        check(r.status_code == 200 and "Resenha web" in r.text, "/ continua abrindo o app web")

        print("v2.9: excluir conta pelo admin")
        vit = Client(http, "vitima"); await vit.register()
        await http.post(f"{BASE}/api/servers/join", json={"invite_code": srv["invite_code"]}, headers=vit.h)
        dele = (await http.post(f"{BASE}/api/servers", json={"name": "Da vitima"}, headers=vit.h)).json()
        await http.post(f"{BASE}/api/servers/join", json={"invite_code": dele["invite_code"]}, headers=b.h)
        sozinho = (await http.post(f"{BASE}/api/servers", json={"name": "So dela"}, headers=vit.h)).json()
        text_ch = next(ch for ch in (await http.get(f"{BASE}/api/servers/{srv['id']}", headers=b.h)).json()["channels"] if ch["type"] == "text")
        vmsg = (await http.post(f"{BASE}/api/channels/{text_ch['id']}/messages", json={"content": "vou sumir"}, headers=vit.h)).json()
        vconv = (await http.post(f"{BASE}/api/dm/conversations", json={"target_user_id": b.user["id"]}, headers=vit.h)).json()
        await http.post(f"{BASE}/api/dm/conversations/{vconv['id']}/messages", json={"content": "oi"}, headers=vit.h)
        users = (await http.get(f"{BASE}/api/admin/users", headers=boss.h)).json()
        check(next(x for x in users if x["id"] == vit.user["id"])["owned_servers"] == 2, "Lista do admin mostra os servidores criados")
        r = await http.delete(f"{BASE}/api/admin/users/{boss.user['id']}", headers=boss.h)
        check(r.status_code == 400, "Admin não exclui a própria conta")
        r = await http.delete(f"{BASE}/api/admin/users/{vit.user['id']}", headers=alvo.h)
        check(r.status_code in (401, 403), "Usuário comum não exclui contas")
        await vit.connect()
        r = await http.delete(f"{BASE}/api/admin/users/{vit.user['id']}", headers=boss.h)
        check(r.status_code == 200 and r.json() == {"ok": True, "transferred": 1, "deleted_servers": 1}, "Super admin exclui a conta")
        check(await vit.wait("SESSION_REVOKED") is not None, "A pessoa é desconectada")
        check(await b.wait("USER_DELETE", lambda d: d["user_id"] == vit.user["id"]) is not None, "Quem via a pessoa recebe USER_DELETE")
        check(await b.wait("MEMBER_REMOVE", lambda d: d["user_id"] == vit.user["id"]) is not None, "Servidores em comum tiram o membro")
        r = await http.get(f"{BASE}/api/auth/me", headers=vit.h)
        check(r.status_code == 401, "Token da conta excluída para de valer")
        r = await http.post(f"{BASE}/api/auth/login", json={"email": vit.user["email"], "password": "123456"})
        check(r.status_code in (400, 401, 404), "Conta excluída não entra mais")
        herdado = (await http.get(f"{BASE}/api/servers/{dele['id']}", headers=b.h)).json()
        check(herdado["owner_id"] == b.user["id"], "Servidor dela passa para o membro mais antigo")
        servers = (await http.get(f"{BASE}/api/admin/servers", headers=boss.h)).json()
        check(not any(x["id"] == sozinho["id"] for x in servers), "Servidor sem mais ninguém é apagado")
        msgs = (await http.get(f"{BASE}/api/channels/{text_ch['id']}/messages", headers=b.h)).json()
        check(not any(m["id"] == vmsg["id"] for m in msgs), "Mensagens dela são apagadas")
        convs = (await http.get(f"{BASE}/api/dm/conversations", headers=b.h)).json()
        check(not any(cv["id"] == vconv["id"] for cv in convs), "DMs com ela são apagadas")
        users = (await http.get(f"{BASE}/api/admin/users", headers=boss.h)).json()
        check(not any(x["id"] == vit.user["id"] for x in users), "Conta some da lista do admin")
        again = Client(http, "vitima"); await again.register()
        check(True, "Cadastro continua funcionando depois da exclusão")

        print("v2.10: confirmação de e-mail e recuperação de senha")
        tag = secrets.token_hex(3)
        em = f"novo{tag}@t.com"
        r = await http.post(f"{BASE}/api/auth/register", json={"username": f"novo{tag}", "email": em, "password": "123456"})
        check(r.status_code == 200 and r.json() == {"verification_required": True, "email": em}, "Cadastro pede confirmação (sem token)")
        mails = await sent_emails(http, em)
        check(len(mails) == 1 and mails[0]["template"] == "confirmar-email"
              and mails[0]["variables"]["USERNAME"] == f"novo{tag}" and len(mails[0]["variables"]["CODE"]) == 6
              and "mail.resenha.example" in mails[0]["from"], "E-mail de confirmação com nome e código de 6 dígitos")
        r = await http.post(f"{BASE}/api/auth/login", json={"email": em, "password": "123456"})
        check(r.status_code == 200 and r.json().get("verification_required") and "access_token" not in r.json(), "Login sem confirmar pede o código")
        check(len(await sent_emails(http, em)) == 1, "Reenvio dentro de 60 s não manda outro e-mail")
        code = await last_code(http, em)
        wrong = f"{(int(code) + 1) % 10**6:06d}"
        r = await http.post(f"{BASE}/api/auth/verify-email", json={"email": em, "code": wrong})
        check(r.status_code == 400 and "4" in r.json()["detail"], "Código errado é recusado (mostra tentativas)")
        r = await http.post(f"{BASE}/api/auth/verify-email", json={"email": em, "code": "12a456"})
        check(r.status_code == 422, "Código precisa ter 6 dígitos")
        r = await http.post(f"{BASE}/api/auth/verify-email", json={"email": em, "code": code})
        check(r.status_code == 200 and r.json()["access_token"], "Código certo confirma e entra")
        r = await http.post(f"{BASE}/api/auth/verify-email", json={"email": em, "code": code})
        check(r.status_code == 400, "Código não vale duas vezes")
        r = await http.post(f"{BASE}/api/auth/login", json={"email": em, "password": "123456"})
        check(r.status_code == 200 and r.json().get("access_token"), "Depois de confirmar, login normal")
        r = await http.post(f"{BASE}/api/auth/register", json={"username": f"outro{tag}", "email": em, "password": "123456"})
        check(r.status_code == 400 and "e-mail" in r.json()["detail"], "E-mail confirmado não se cadastra de novo")

        em2 = f"refaz{tag}@t.com"
        await http.post(f"{BASE}/api/auth/register", json={"username": f"refaz{tag}", "email": em2, "password": "123456"})
        r = await http.post(f"{BASE}/api/auth/register", json={"username": f"refaz2{tag}", "email": em2, "password": "654321"})
        check(r.status_code == 200 and r.json().get("verification_required"), "Quem não confirmou pode refazer o cadastro")
        r = await http.post(f"{BASE}/api/auth/register", json={"username": f"novo{tag}", "email": f"x{tag}@t.com", "password": "123456"})
        check(r.status_code == 400 and "nome" in r.json()["detail"], "Nome em uso continua recusado")
        for _ in range(5):
            await http.post(f"{BASE}/api/auth/verify-email", json={"email": em2, "code": "000000"})
        r = await http.post(f"{BASE}/api/auth/verify-email", json={"email": em2, "code": await last_code(http, em2)})
        check(r.status_code == 400, "Após 5 erros o código para de valer")

        await http.post(f"{FAKE_MAIL}/fail-next")
        em3 = f"falha{tag}@t.com"
        r = await http.post(f"{BASE}/api/auth/register", json={"username": f"falha{tag}", "email": em3, "password": "123456"})
        check(r.status_code == 502, "Falha no envio avisa a pessoa")
        r = await http.post(f"{BASE}/api/auth/resend-verification", json={"email": em3})
        check(r.status_code == 200 and len(await sent_emails(http, em3)) == 1, "Depois da falha, dá para pedir o código de novo na hora")

        print("Recuperar senha")
        r = await http.post(f"{BASE}/api/auth/forgot-password", json={"email": f"ninguem{tag}@t.com"})
        check(r.status_code == 200 and not await sent_emails(http, f"ninguem{tag}@t.com"), "E-mail sem conta: responde ok e não envia nada")
        await b.connect()
        r = await http.post(f"{BASE}/api/auth/forgot-password", json={"email": b.user["email"]})
        reset_code = await last_code(http, b.user["email"], "redefinir-senha")
        check(r.status_code == 200 and reset_code, "Esqueci a senha envia o código")
        r = await http.post(f"{BASE}/api/auth/reset-password", json={"email": b.user["email"], "code": "000000", "password": "novasenha"})
        check(r.status_code == 400, "Código errado não troca a senha")
        await asyncio.sleep(1.1)  # o token antigo precisa ser de um segundo anterior à troca
        r = await http.post(f"{BASE}/api/auth/reset-password", json={"email": b.user["email"], "code": reset_code, "password": "novasenha"})
        check(r.status_code == 200 and r.json()["access_token"], "Código certo troca a senha e já entra")
        new_token = r.json().get("access_token")
        check(await b.wait("SESSION_REVOKED") is not None, "Sessões abertas caem ao trocar a senha")
        r = await http.get(f"{BASE}/api/auth/me", headers=b.h)
        check(r.status_code == 401, "Token antigo deixa de valer")
        r = await http.get(f"{BASE}/api/auth/me", headers={"Authorization": f"Bearer {new_token}"})
        check(r.status_code == 200, "Token novo vale")
        r = await http.post(f"{BASE}/api/auth/login", json={"email": b.user["email"], "password": "123456"})
        check(r.status_code == 401, "Senha antiga não entra mais")
        r = await http.post(f"{BASE}/api/auth/login", json={"email": b.user["email"], "password": "novasenha"})
        check(r.status_code == 200 and r.json().get("access_token"), "Senha nova entra")
        b.token = r.json()["access_token"]; b.h = {"Authorization": f"Bearer {b.token}"}
        await b.connect()

        print("v2.11: convites em link")
        import os, sqlite3
        d, e, f = Client(http, "duda"), Client(http, "edu"), Client(http, "fabi")
        for x in (d, e, f):
            await x.register()
        srv2 = (await http.post(f"{BASE}/api/servers", json={"name": "Os <Amigos> do Lol"}, headers=b.h)).json()
        everyone = next(r for r in srv2["roles"] if r["is_default"])
        check(everyone["permissions"] & 128, "Servidor novo: @everyone pode criar convites")
        r = await http.post(f"{BASE}/api/servers/{srv2['id']}/invites", json={}, headers=b.h)
        inv = r.json()
        check(r.status_code == 200 and len(inv["code"]) == 8 and inv["url"] == f"https://resenha.example/convite/{inv['code']}",
              "Cria convite com link resenha.example/convite/<código>")
        check(inv["max_age"] == 604800 and inv["expires_at"] and inv["max_uses"] == 0, "Padrão: 7 dias, sem limite de usos")
        check(await b.wait("INVITE_UPDATE", lambda x: x["server_id"] == srv2["id"]) is not None, "Criar convite manda INVITE_UPDATE")
        r = await http.post(f"{BASE}/api/servers/{srv2['id']}/invites", json={}, headers=b.h)
        check(r.json()["code"] == inv["code"], "Copiar de novo reaproveita o mesmo convite")
        r = await http.post(f"{BASE}/api/servers/{srv2['id']}/invites", json={"max_age": 999}, headers=b.h)
        check(r.status_code == 400, "Validade fora da lista é recusada")
        r = await http.get(f"{BASE}/api/invites/{inv['code']}")
        pv = r.json()
        check(r.status_code == 200 and pv["server"]["name"] == "Os <Amigos> do Lol" and pv["members"] == 1
              and pv["online"] == 1 and pv["inviter"]["id"] == b.user["id"], "Prévia pública sem login")
        r = await http.get(f"{BASE}/api/invites/naoexiste1")
        check(r.status_code == 404 and r.json()["detail"] == "Este convite expirou ou não existe." and "server" not in r.text,
              "Convite inexistente: 404 sem dados do servidor")
        r = await http.post(f"{BASE}/api/invites/{inv['code']}/accept")
        check(r.status_code == 401, "Aceitar exige login")
        r = await http.post(f"{BASE}/api/invites/{inv['code']}/accept", headers=d.h)
        check(r.status_code == 200 and r.json()["id"] == srv2["id"], "D aceita o convite e entra")
        check(await b.wait("MEMBER_ADD", lambda x: x["user_id"] == d.user["id"]) is not None, "Dono recebe MEMBER_ADD")
        r = await http.post(f"{BASE}/api/invites/{inv['code']}/accept", headers=d.h)
        listing = (await http.get(f"{BASE}/api/servers/{srv2['id']}/invites", headers=b.h)).json()
        check(r.status_code == 200 and next(i for i in listing if i["code"] == inv["code"])["uses"] == 1,
              "Aceitar de novo (já é membro) não conta uso")
        r = await http.get(f"{BASE}/api/servers/{srv2['id']}/invites", headers=d.h)
        check(r.status_code == 403, "Listar convites exige Gerenciar servidor")

        one = (await http.post(f"{BASE}/api/servers/{srv2['id']}/invites", json={"max_uses": 1, "max_age": 0}, headers=b.h)).json()
        check(one["code"] != inv["code"] and one["expires_at"] is None, "Configuração diferente gera outro convite (sem validade)")
        r1 = await http.post(f"{BASE}/api/invites/{one['code']}/accept", headers=e.h)
        r2 = await http.post(f"{BASE}/api/invites/{one['code']}/accept", headers=f.h)
        check(r1.status_code == 200 and r2.status_code == 404, "Limite de 1 uso: o segundo não entra")
        check((await http.get(f"{BASE}/api/invites/{one['code']}")).status_code == 404, "Convite esgotado some da prévia")

        old = (await http.post(f"{BASE}/api/servers/{srv2['id']}/invites", json={"max_age": 1800}, headers=b.h)).json()
        db = sqlite3.connect(os.environ["E2E_DB"])
        db.execute("UPDATE server_invites SET expires_at = '2000-01-01 00:00:00' WHERE code = ?", (old["code"],)); db.commit(); db.close()
        r = await http.post(f"{BASE}/api/invites/{old['code']}/accept", headers=f.h)
        check((await http.get(f"{BASE}/api/invites/{old['code']}")).status_code == 404 and r.status_code == 404,
              "Convite expirado não abre nem aceita")
        r = await http.post(f"{BASE}/api/servers/{srv2['id']}/invites", json={"max_age": 1800}, headers=b.h)
        check(r.json()["code"] != old["code"], "Convite expirado não é reaproveitado")

        mine = (await http.post(f"{BASE}/api/servers/{srv2['id']}/invites", json={"max_age": 3600}, headers=d.h)).json()
        check(mine.get("code") and mine["inviter"]["id"] == d.user["id"], "Membro comum cria convite (@everyone)")
        r = await http.delete(f"{BASE}/api/invites/{mine['code']}", headers=e.h)
        check(r.status_code == 403, "Outro membro não revoga convite alheio")
        r = await http.delete(f"{BASE}/api/invites/{mine['code']}", headers=d.h)
        check(r.status_code == 200 and (await http.get(f"{BASE}/api/invites/{mine['code']}")).status_code == 404,
              "Quem criou revoga o próprio convite")
        theirs = (await http.post(f"{BASE}/api/servers/{srv2['id']}/invites", json={"max_age": 21600}, headers=d.h)).json()
        r = await http.delete(f"{BASE}/api/invites/{theirs['code']}", headers=b.h)
        check(r.status_code == 200 and await b.wait("INVITE_UPDATE") is not None, "Dono revoga convite de outro (INVITE_UPDATE)")
        listing = (await http.get(f"{BASE}/api/servers/{srv2['id']}/invites", headers=b.h)).json()
        codes = {i["code"] for i in listing}
        check(inv["code"] in codes and not codes & {one["code"], old["code"], mine["code"], theirs["code"]},
              "Lista só traz convites válidos")

        r = await http.patch(f"{BASE}/api/servers/{srv2['id']}/roles/{everyone['id']}", json={"permissions": 0}, headers=b.h)
        r = await http.post(f"{BASE}/api/servers/{srv2['id']}/invites", json={}, headers=d.h)
        check(r.status_code == 403 and "Criar convites" in r.json()["detail"], "Sem \"Criar convites\" no @everyone, membro não cria")
        r = await http.post(f"{BASE}/api/servers/{srv2['id']}/invites", json={}, headers=b.h)
        check(r.status_code == 200, "Dono continua criando convites")

        r = await http.post(f"{BASE}/api/servers/join", json={"invite_code": srv2["invite_code"]}, headers=f.h)
        check(r.status_code == 200 and r.json()["id"] == srv2["id"], "Rota antiga /join continua com o código antigo")
        check((await http.get(f"{BASE}/api/invites/{srv2['invite_code']}")).json()["server"]["id"] == srv2["id"],
              "Código antigo também tem prévia (convite permanente)")
        g, h2 = Client(http, "gabi"), Client(http, "hugo")
        await g.register(); await h2.register()
        r = await http.post(f"{BASE}/api/servers/join", json={"invite_code": f"https://resenha.example/convite/{inv['code']}/"}, headers=g.h)
        check(r.status_code == 200 and r.json()["id"] == srv2["id"], "Rota antiga /join aceita a URL nova")
        r = await http.post(f"{BASE}/api/servers/join", json={"invite_code": f"resenha://convite/{inv['code']}?x=1"}, headers=h2.h)
        check(r.status_code == 200, "Rota antiga /join aceita resenha://convite/<código>")
        r = await http.post(f"{BASE}/api/servers/join", json={"invite_code": "naoexiste1"}, headers=h2.h)
        check(r.status_code == 404, "Rota antiga /join: código inválido dá 404")

        r = await http.get(f"{BASE}/convite/{inv['code']}", headers={"Accept": "text/html"})
        check(r.status_code == 200 and "text/html" in r.headers["content-type"]
              and 'og:title" content="Convite para Os &lt;Amigos&gt; do Lol"' in r.text and "<Amigos>" not in r.text,
              "/convite/<código> devolve HTML com Open Graph (escapado)")
        r = await http.get(f"{BASE}/convite/naoexiste1")
        check(r.status_code == 404 and "Este convite expirou ou não existe" in r.text, "/convite/<inválido> mostra a página de inválido")
        r = await http.get(f"{BASE}/convite/assets/invite.css")
        check(r.status_code == 200 and "--cobalt" in r.text, "Arquivos da página do convite")
        r = await http.get(f"{BASE}/servidor/qualquer", headers={"Accept": "text/html"})
        check(r.status_code == 200 and "Resenha web" in r.text, "Rota coringa do app web segue funcionando")

        r = await http.delete(f"{BASE}/api/servers/{srv2['id']}", headers=b.h)
        check(r.status_code == 200 and (await http.get(f"{BASE}/api/invites/{inv['code']}")).status_code == 404,
              "Excluir o servidor apaga os convites")

        print("Saída do servidor")
        r = await http.delete(f"{BASE}/api/servers/{srv['id']}/members/@me", headers=c.h)
        check(r.status_code == 200 and await b.wait("MEMBER_REMOVE", lambda d: d["user_id"] == c.user["id"]) is not None,
              "C sai e B é notificado")
        r = await http.delete(f"{BASE}/api/servers/{srv['id']}", headers=a.h)
        check(r.status_code == 200 and await b.wait("SERVER_DELETE") is not None, "Dono exclui servidor")

    print()
    print("FALHAS:" if failures else "TUDO OK", failures if failures else "")
    sys.exit(1 if failures else 0)


asyncio.run(main())
