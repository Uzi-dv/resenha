"""Testa o monitor de uso (app/uso.py) com Cloudflare e ntfy falsos: soma do mês, descoberta do dataset do SFU,
previsão, alertas, trava de vídeo e o painel com senha."""
import asyncio
import base64
import json
import os
import sys
import tempfile
from pathlib import Path

D = tempfile.mkdtemp()
os.environ.update({
    "USO_ARQUIVO": str(Path(D) / "uso.json"), "CF_ACCOUNT_ID": "conta123", "CF_ANALYTICS_TOKEN": "tok",
    "CF_LIMITE_GB": "10", "CF_BLOQUEAR_VIDEO_PCT": "90", "PAINEL_SENHA": "segredo", "NTFY_TOPICO": "topico-x",
    "NTFY_URL": "https://ntfy.teste", "CF_GRAPHQL_URL": "https://cf.teste/graphql",
})
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import uso as modulo  # noqa: E402

GB = 1024 ** 3
estado = {"sfu": 3 * GB, "turn": 1 * GB, "avisos": [], "consultas": []}


def responder(req: httpx.Request) -> httpx.Response:
    if req.url.host == "ntfy.teste":
        estado["avisos"].append((req.headers.get("Title"), req.content.decode()))
        return httpx.Response(200, json={})
    corpo = json.loads(req.content)
    q = corpo["query"]
    estado["consultas"].append(q)
    if req.headers.get("Authorization") != "Bearer tok":
        return httpx.Response(200, json={"errors": [{"message": "token inválido"}]})
    if "__type" in q:
        return httpx.Response(200, json={"data": {"__type": {"fields": [
            {"name": "callsTurnUsageAdaptiveGroups"}, {"name": "callsUsageAdaptiveGroups"}, {"name": "httpRequestsAdaptiveGroups"}]}}})
    for ds, chave in (("callsTurnUsageAdaptiveGroups", "turn"), ("callsUsageAdaptiveGroups", "sfu")):
        if ds in q:
            assert corpo["variables"]["a"] == "conta123"
            metade = estado[chave] // 2
            return httpx.Response(200, json={"data": {"viewer": {"accounts": [
                {ds: [{"sum": {"egressBytes": metade}}, {"sum": {"egressBytes": estado[chave] - metade}}]}]}}})
    return httpx.Response(200, json={"errors": [{"message": "campo desconhecido"}]})


falhas = 0


def ok(c, msg):
    global falhas
    print(("OK    " if c else "FALHA ") + msg)
    falhas += 0 if c else 1


async def main():
    u = modulo.uso
    u._client = httpx.AsyncClient(transport=httpx.MockTransport(responder))
    u.amostrar(); await asyncio.sleep(1.1); u.amostrar()
    ok(len(u.amostras) >= 1, f"mede CPU/memória/rede da máquina ({len(u.amostras)} amostra)")

    await u.atualizar_cf()
    r = u.cf_resumo()
    ok(r["erro"] is None, f"consulta a Cloudflare sem erro ({r['erro']})")
    ok(u.cf["dataset_sfu"] == "callsUsageAdaptiveGroups", "descobre o dataset do SFU pelo schema")
    ok(r["usado_gb"] == 4.0 and r["sfu_gb"] == 3.0 and r["turn_gb"] == 1.0, f"soma SFU + TURN do mês ({r['usado_gb']} GB)")
    ok(r["pct"] == 40.0, "porcentagem da franquia")
    ok(not u.video_bloqueado(), "abaixo de 90%: tela e câmera liberadas")

    await u.verificar_alertas()
    titulos = [a[0] for a in estado["avisos"]]
    ok(not any("50%" in t for t in titulos), "sem alerta abaixo de 50%")

    estado["sfu"], estado["turn"] = 8 * GB, int(1.2 * GB)
    await u.atualizar_cf(); await u.verificar_alertas()
    titulos = [a[0] for a in estado["avisos"]]
    ok(any("90%" in t for t in titulos) and any("70%" in t for t in titulos), f"alertas de 70% e 90% ({titulos})")
    ok(u.video_bloqueado(), "acima de 90%: tela e câmera pausadas")
    ok(any("pausadas" in t for t in titulos), "avisa que pausou tela e câmera")
    n = len(estado["avisos"])
    await u.verificar_alertas()
    ok(len(estado["avisos"]) == n, "não repete o mesmo alerta")

    u.salvar()
    novo = modulo.Uso()
    ok(novo.cf["sfu_bytes"] == 8 * GB and novo.alertas, "guarda números e alertas ao reiniciar")

    # token errado: mostra erro em vez de quebrar
    modulo.CF_ANALYTICS_TOKEN = "errado"
    await u.atualizar_cf()
    ok("token" in (u.cf["erro"] or ""), f"token errado vira mensagem no painel ({u.cf['erro']})")
    modulo.CF_ANALYTICS_TOKEN = "tok"

    # painel com senha
    app = FastAPI(); app.include_router(modulo.router)
    c = TestClient(app)
    ok(c.get("/painel").status_code == 401, "painel pede senha")
    errado = base64.b64encode(b"admin:outra").decode()
    ok(c.get("/painel", headers={"Authorization": f"Basic {errado}"}).status_code == 401, "senha errada é recusada")
    certo = {"Authorization": "Basic " + base64.b64encode(b"admin:segredo").decode()}
    p = c.get("/painel", headers=certo)
    ok(p.status_code == 200 and "Resenha" in p.text and "PAUSADAS" in p.text, "painel abre e mostra a trava")
    j = c.get("/api/uso", headers=certo).json()
    ok(j["cloudflare"]["usado_gb"] > 9 and "maquina" in j, "API /api/uso devolve os números")
    Path(D, "painel.html").write_text(p.text, encoding="utf-8")
    print("painel salvo em", Path(D, "painel.html"))


asyncio.run(main())
print("TUDO OK" if not falhas else f"{falhas} FALHA(S)")
sys.exit(1 if falhas else 0)
