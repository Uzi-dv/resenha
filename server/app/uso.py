"""
Monitoramento de uso do Resenha: Cloudflare (GB do mês, contra a franquia grátis) e a máquina (CPU, memória,
disco, rede) com o risco de a Oracle recuperar a máquina grátis por ociosidade.

- Painel:  GET /painel   (usuário "admin" e a senha PAINEL_SENHA do .env)
- Dados:   GET /api/uso  (mesma senha)
- Alertas no celular pelo ntfy.sh (tópico secreto NTFY_TOPICO): 50/70/90% da franquia, previsão de estourar,
  disco cheio, servidor reiniciado, risco de ociosidade.
- Trava: perto do fim da franquia (CF_BLOQUEAR_VIDEO_PCT, padrão 90%), o servidor recusa tela e câmera até virar
  o mês; a voz continua (gasta quase nada). Assim a conta do Cloudflare não passa do grátis.

Variáveis (.env):
  CF_ACCOUNT_ID          ID da conta Cloudflare (está na URL do painel)
  CF_ANALYTICS_TOKEN     token de API com permissão "Account Analytics: Read"
  CF_LIMITE_GB           franquia mensal (padrão 1000)
  CF_BLOQUEAR_VIDEO_PCT  % da franquia em que tela/câmera são bloqueadas (padrão 90; 0 desliga)
  PAINEL_SENHA           senha do painel (sem ela o painel fica desligado)
  NTFY_TOPICO            tópico do ntfy.sh para os alertas (vazio = sem alertas)
"""
import asyncio
import base64
import datetime as dt
import html
import json
import logging
import os
import secrets
import shutil
import time
from collections import deque
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from app import config as _config  # noqa: F401  (carrega o .env antes de ler as variáveis)

logger = logging.getLogger("resenha.uso")
router = APIRouter()

ROOT = Path(__file__).resolve().parent.parent
ARQUIVO = Path(os.getenv("USO_ARQUIVO", ROOT / "uso.json"))
CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID", "").strip()
CF_ANALYTICS_TOKEN = os.getenv("CF_ANALYTICS_TOKEN", "").strip()
CF_GRAPHQL = os.getenv("CF_GRAPHQL_URL", "https://api.cloudflare.com/client/v4/graphql")
LIMITE_GB = float(os.getenv("CF_LIMITE_GB", "1000"))
BLOQUEAR_PCT = float(os.getenv("CF_BLOQUEAR_VIDEO_PCT", "90"))
PAINEL_SENHA = os.getenv("PAINEL_SENHA", "").strip()
NTFY_TOPICO = os.getenv("NTFY_TOPICO", "").strip()
NTFY_URL = os.getenv("NTFY_URL", "https://ntfy.sh").rstrip("/")
INTERVALO_CF = int(os.getenv("USO_INTERVALO_CF", "1800"))     # consulta à Cloudflare a cada 30 min
JANELA = 7 * 24 * 60                                          # 7 dias de amostras por minuto
GB = 1024 ** 3


class Uso:
    def __init__(self):
        self.amostras: deque = deque(maxlen=JANELA)   # (ts, cpu%, mem%, rede bytes/s)
        self.cf = {"mes": None, "sfu_bytes": None, "turn_bytes": None, "atualizado": None, "erro": None, "dataset_sfu": None}
        self.alertas: dict = {}                        # chave -> quando foi enviado
        self.inicio = time.time()
        self._cpu_ant = None
        self._rede_ant = None
        self._client: Optional[httpx.AsyncClient] = None
        self._carregar()

    # ------------------------------------------------------------------ persistência
    def _carregar(self):
        try:
            d = json.loads(ARQUIVO.read_text(encoding="utf-8"))
            corte = time.time() - JANELA * 60
            self.amostras.extend(tuple(a) for a in d.get("amostras", []) if a[0] >= corte)
            self.cf.update(d.get("cf", {}))
            self.alertas = d.get("alertas", {})
        except Exception:
            pass

    def salvar(self):
        try:
            tmp = ARQUIVO.with_suffix(".tmp")
            tmp.write_text(json.dumps({"amostras": list(self.amostras), "cf": self.cf, "alertas": self.alertas}), encoding="utf-8")
            tmp.replace(ARQUIVO)
        except Exception as exc:
            logger.warning("não consegui salvar %s: %s", ARQUIVO, exc)

    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=20)
        return self._client

    # ------------------------------------------------------------------ máquina
    @staticmethod
    def _ler_cpu():
        with open("/proc/stat") as f:
            v = [int(x) for x in f.readline().split()[1:]]
        ocioso = v[3] + (v[4] if len(v) > 4 else 0)
        return sum(v), ocioso

    @staticmethod
    def _ler_rede():
        total = 0
        with open("/proc/net/dev") as f:
            for linha in f.readlines()[2:]:
                nome, dados = linha.split(":", 1)
                if nome.strip() == "lo":
                    continue
                c = dados.split()
                total += int(c[0]) + int(c[8])
        return total

    @staticmethod
    def memoria():
        info = {}
        with open("/proc/meminfo") as f:
            for linha in f:
                k, v = linha.split(":", 1)
                info[k] = int(v.split()[0]) * 1024
        total, livre = info.get("MemTotal", 1), info.get("MemAvailable", 0)
        swap_t, swap_l = info.get("SwapTotal", 0), info.get("SwapFree", 0)
        return {"total": total, "usado": total - livre, "pct": round(100 * (total - livre) / total, 1),
                "swap_total": swap_t, "swap_usado": swap_t - swap_l}

    def amostrar(self):
        try:
            agora = time.time()
            cpu = self._ler_cpu()
            rede = self._ler_rede()
            cpu_pct = rede_bps = 0.0
            if self._cpu_ant:
                dt_total = cpu[0] - self._cpu_ant[0]
                dt_ocioso = cpu[1] - self._cpu_ant[1]
                cpu_pct = 100 * (1 - dt_ocioso / dt_total) if dt_total > 0 else 0
            if self._rede_ant:
                rede_bps = max(0, rede - self._rede_ant[1]) / max(1, agora - self._rede_ant[0])
            self._cpu_ant, self._rede_ant = cpu, (agora, rede)
            if cpu_pct or rede_bps:
                self.amostras.append((int(agora), round(cpu_pct, 2), self.memoria()["pct"], round(rede_bps)))
        except Exception as exc:  # fora do Linux (desenvolvimento no Windows): sem métricas da máquina
            logger.debug("sem métricas da máquina: %s", exc)

    def risco_ociosidade(self):
        """Regra da Oracle (Always Free): 7 dias com CPU p95 < 20%, rede < 20% (e memória < 20% nas ARM)."""
        if not self.amostras:
            return {"dias": 0, "cpu_p95": None, "ocioso": None}
        cpus = sorted(a[1] for a in self.amostras)
        p95 = cpus[min(len(cpus) - 1, int(len(cpus) * 0.95))]
        dias = (self.amostras[-1][0] - self.amostras[0][0]) / 86400
        return {"dias": round(dias, 1), "cpu_p95": round(p95, 1), "ocioso": p95 < 20}

    # ------------------------------------------------------------------ Cloudflare
    async def _graphql(self, query: str, variables: dict) -> dict:
        r = await self.client().post(CF_GRAPHQL, json={"query": query, "variables": variables},
                                     headers={"Authorization": f"Bearer {CF_ANALYTICS_TOKEN}"})
        r.raise_for_status()
        d = r.json()
        if d.get("errors"):
            raise RuntimeError(d["errors"][0].get("message", "erro do GraphQL"))
        return d["data"]

    async def _soma_egress(self, dataset: str, inicio: str, fim: str) -> int:
        q = ("query($a: String!, $i: Date!, $f: Date!) { viewer { accounts(filter: {accountTag: $a}) { "
             f"{dataset}(limit: 10000, filter: {{date_geq: $i, date_leq: $f}}) {{ sum {{ egressBytes }} }} }} }} }}")
        d = await self._graphql(q, {"a": CF_ACCOUNT_ID, "i": inicio, "f": fim})
        grupos = d["viewer"]["accounts"][0][dataset] if d["viewer"]["accounts"] else []
        return sum(int(g["sum"]["egressBytes"] or 0) for g in grupos)

    async def _descobrir_sfu(self) -> Optional[str]:
        """O dataset do SFU não está documentado: procura no schema um 'calls…AdaptiveGroups' que não seja o TURN."""
        if self.cf.get("dataset_sfu"):
            return self.cf["dataset_sfu"]
        d = await self._graphql('query { __type(name: "account") { fields { name } } }', {})
        nomes = [f["name"] for f in (d.get("__type") or {}).get("fields", [])]
        candidatos = [n for n in nomes if n.lower().startswith("calls") and "turn" not in n.lower() and n.endswith("AdaptiveGroups")]
        candidatos.sort(key=lambda n: (n != "callsUsageAdaptiveGroups", n))
        hoje = dt.date.today().isoformat()
        for n in candidatos:
            try:
                await self._soma_egress(n, hoje, hoje)
                self.cf["dataset_sfu"] = n
                return n
            except Exception:
                continue
        return None

    async def atualizar_cf(self):
        if not (CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN):
            self.cf["erro"] = "monitor do Cloudflare não configurado (CF_ACCOUNT_ID / CF_ANALYTICS_TOKEN)"
            return
        hoje = dt.datetime.now(dt.timezone.utc).date()
        inicio = hoje.replace(day=1).isoformat()
        try:
            turn = await self._soma_egress("callsTurnUsageAdaptiveGroups", inicio, hoje.isoformat())
            ds = await self._descobrir_sfu()
            sfu = await self._soma_egress(ds, inicio, hoje.isoformat()) if ds else None
            self.cf.update({"mes": inicio[:7], "sfu_bytes": sfu, "turn_bytes": turn,
                            "atualizado": int(time.time()), "erro": None if ds else "dataset do SFU não encontrado"})
        except Exception as exc:
            self.cf["erro"] = str(exc)[:200]
            logger.warning("consulta de uso da Cloudflare falhou: %s", exc)

    def cf_resumo(self) -> dict:
        agora = dt.datetime.now(dt.timezone.utc)
        mes_atual = agora.strftime("%Y-%m")
        valido = self.cf.get("mes") == mes_atual
        usado = ((self.cf.get("sfu_bytes") or 0) + (self.cf.get("turn_bytes") or 0)) / GB if valido else 0.0
        dias_mes = ((agora.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)).day
        decorrido = (agora.day - 1 + agora.hour / 24 + agora.minute / 1440) / dias_mes
        previsao = usado / decorrido if decorrido > 0.1 else None   # só depois de ~3 dias, para não assustar no dia 1
        excedente = max(0.0, (previsao or 0) - LIMITE_GB)
        return {
            "mes": mes_atual, "usado_gb": round(usado, 2), "limite_gb": LIMITE_GB,
            "pct": round(100 * usado / LIMITE_GB, 1), "previsao_gb": round(previsao, 1) if previsao is not None else None,
            "custo_previsto_usd": round(excedente * 0.05, 2),
            "sfu_gb": round((self.cf.get("sfu_bytes") or 0) / GB, 2) if valido else 0,
            "turn_gb": round((self.cf.get("turn_bytes") or 0) / GB, 2) if valido else 0,
            "atualizado": self.cf.get("atualizado"), "erro": self.cf.get("erro"),
            "video_bloqueado": self.video_bloqueado(usado),
        }

    def video_bloqueado(self, usado_gb: Optional[float] = None) -> bool:
        if BLOQUEAR_PCT <= 0:
            return False
        if usado_gb is None:
            agora = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
            if self.cf.get("mes") != agora:
                return False
            usado_gb = ((self.cf.get("sfu_bytes") or 0) + (self.cf.get("turn_bytes") or 0)) / GB
        return usado_gb >= LIMITE_GB * BLOQUEAR_PCT / 100

    # ------------------------------------------------------------------ alertas (ntfy.sh)
    async def avisar(self, chave: str, titulo: str, texto: str, prioridade: str = "default", repetir_horas: float = 1e9):
        if not NTFY_TOPICO:
            return
        quando = self.alertas.get(chave)
        if quando is not None and time.time() - quando < repetir_horas * 3600:
            return
        try:
            await self.client().post(f"{NTFY_URL}/{NTFY_TOPICO}", content=texto.encode("utf-8"),
                                     headers={"Title": titulo.encode("utf-8"), "Priority": prioridade, "Tags": "resenha"})
            self.alertas[chave] = time.time()
        except Exception as exc:
            logger.warning("alerta não enviado: %s", exc)

    async def verificar_alertas(self):
        c = self.cf_resumo()
        mes = c["mes"]
        for nivel in (50, 70, 90):
            if c["pct"] >= nivel:
                await self.avisar(f"cf{nivel}-{mes}", f"Resenha: {nivel}% da franquia do Cloudflare",
                                  f"Já foram {c['usado_gb']:.0f} de {LIMITE_GB:.0f} GB grátis este mês.",
                                  "high" if nivel >= 90 else "default")
        if c["video_bloqueado"]:
            await self.avisar(f"bloq-{mes}", "Resenha: tela e câmera pausadas",
                              f"Chegou a {c['pct']:.0f}% da franquia. Até o mês virar, só voz (para não gerar cobrança).", "high")
        elif c["previsao_gb"] and c["previsao_gb"] > LIMITE_GB:
            await self.avisar(f"prev-{mes}", "Resenha: ritmo acima da franquia",
                              f"No ritmo atual o mês fecha em ~{c['previsao_gb']:.0f} GB (grátis: {LIMITE_GB:.0f}). "
                              f"A trava de vídeo entra em {BLOQUEAR_PCT:.0f}%.", repetir_horas=72)
        disco = shutil.disk_usage(ROOT)
        if disco.used / disco.total > 0.85:
            await self.avisar("disco", "Resenha: disco do servidor quase cheio",
                              f"{100 * disco.used / disco.total:.0f}% usado. Apague backups antigos em migracao/.", "high", 24)
        r = self.risco_ociosidade()
        if r["ocioso"] and r["dias"] >= 6:
            await self.avisar("ocioso", "Resenha: máquina pode ser recuperada pela Oracle",
                              f"CPU p95 em {r['cpu_p95']}% nos últimos {r['dias']} dias (a Oracle considera ociosa abaixo de 20%). "
                              "Os backups diários estão em /opt/resenha/server/migracao.", repetir_horas=24 * 7)

    # ------------------------------------------------------------------ resumo
    def resumo(self) -> dict:
        disco = shutil.disk_usage(ROOT)
        ultimas = list(self.amostras)[-60:]
        try:
            mem = self.memoria()
        except Exception:
            mem = None
        backups = sorted((ROOT / "migracao").glob("*.zip")) if (ROOT / "migracao").exists() else []
        return {
            "cloudflare": self.cf_resumo(),
            "maquina": {
                "cpu_pct_1h": round(sum(a[1] for a in ultimas) / len(ultimas), 1) if ultimas else None,
                "rede_kbps_1h": round(sum(a[3] for a in ultimas) / len(ultimas) * 8 / 1000, 1) if ultimas else None,
                "memoria": mem,
                "disco": {"total": disco.total, "usado": disco.used, "pct": round(100 * disco.used / disco.total, 1)},
                "ligado_ha_horas": round((time.time() - self.inicio) / 3600, 1),
                "ociosidade_oracle": self.risco_ociosidade(),
                "ultimo_backup": backups[-1].name if backups else None,
            },
            "alertas_ligados": bool(NTFY_TOPICO),
        }

    async def laco(self):
        await self.avisar(f"inicio-{int(self.inicio)}", "Resenha: servidor ligado",
                          "O servidor do Resenha (re)iniciou.", "low")
        ultimo_cf = 0.0
        while True:
            try:
                self.amostrar()
                if time.time() - ultimo_cf >= INTERVALO_CF:
                    ultimo_cf = time.time()
                    await self.atualizar_cf()
                    await self.verificar_alertas()
                    self.salvar()
            except Exception as exc:
                logger.warning("monitor: %s", exc)
            await asyncio.sleep(60)


uso = Uso()


# ---------------------------------------------------------------------- rotas
def _autorizado(request: Request):
    if not PAINEL_SENHA:
        raise HTTPException(status_code=404, detail="Painel desligado (defina PAINEL_SENHA no .env).")
    cab = request.headers.get("authorization", "")
    if cab.lower().startswith("basic "):
        try:
            usuario, _, senha = base64.b64decode(cab[6:]).decode("utf-8").partition(":")
            if secrets.compare_digest(usuario, "admin") and secrets.compare_digest(senha, PAINEL_SENHA):
                return
        except Exception:
            pass
    raise HTTPException(status_code=401, detail="Senha do painel.", headers={"WWW-Authenticate": 'Basic realm="Resenha"'})


@router.get("/api/uso")
async def api_uso(request: Request):
    _autorizado(request)
    return uso.resumo()


@router.post("/api/uso/atualizar")
async def api_uso_atualizar(request: Request):
    _autorizado(request)
    await uso.atualizar_cf()
    uso.salvar()
    return uso.resumo()


def _gb(b: float) -> str:
    return f"{b / GB:.1f} GB"


@router.get("/painel", response_class=HTMLResponse, include_in_schema=False)
async def painel(request: Request):
    _autorizado(request)
    r = uso.resumo()
    c, m = r["cloudflare"], r["maquina"]
    pct = min(100, c["pct"])
    cor = "#4be3a9" if pct < 70 else "#ffb547" if pct < 90 else "#ff6b6b"
    oc = m["ociosidade_oracle"]
    if oc["ocioso"] is None or oc["dias"] < 1:
        risco = f"medindo... ({oc['dias']} de 7 dias)"
    elif oc["ocioso"]:
        risco = f"ALTO: CPU p95 {oc['cpu_p95']}% em {oc['dias']} dias (abaixo de 20% a Oracle considera ociosa)"
    else:
        risco = f"baixo: CPU p95 {oc['cpu_p95']}% em {oc['dias']} dias"
    mem = m["memoria"] or {}
    atual = dt.datetime.fromtimestamp(c["atualizado"]).strftime("%d/%m %H:%M") if c.get("atualizado") else "nunca"
    previsao = f"{c['previsao_gb']:.0f} GB" if c["previsao_gb"] is not None else "medindo..."
    custo = f"US$ {c['custo_previsto_usd']:.2f}" if c["custo_previsto_usd"] else "US$ 0,00 (dentro do grátis)"
    linhas = [
        ("Cloudflare: usado no mês", f"{c['usado_gb']:.1f} de {c['limite_gb']:.0f} GB ({c['pct']:.1f}%)"),
        ("  voz/tela (SFU)", f"{c['sfu_gb']:.2f} GB"), ("  TURN", f"{c['turn_gb']:.2f} GB"),
        ("Previsão para o fim do mês", previsao), ("Custo previsto", custo),
        ("Tela e câmera", "PAUSADAS até o mês virar (franquia quase no fim)" if c["video_bloqueado"] else
         f"liberadas (pausam em {BLOQUEAR_PCT:.0f}% da franquia)" if BLOQUEAR_PCT > 0 else "liberadas (trava desligada)"),
        ("Atualizado", atual + (f" — erro: {c['erro']}" if c.get("erro") else "")),
        ("Máquina: CPU (última hora)", f"{m['cpu_pct_1h']}%" if m["cpu_pct_1h"] is not None else "medindo..."),
        ("Memória", f"{_gb(mem.get('usado', 0))} de {_gb(mem.get('total', 0))} ({mem.get('pct', '?')}%), swap {_gb(mem.get('swap_usado', 0))}"),
        ("Disco", f"{_gb(m['disco']['usado'])} de {_gb(m['disco']['total'])} ({m['disco']['pct']}%)"),
        ("Rede (última hora)", f"{m['rede_kbps_1h']} kbit/s" if m["rede_kbps_1h"] is not None else "medindo..."),
        ("Risco de a Oracle recuperar a máquina", risco),
        ("Último backup", m["ultimo_backup"] or "nenhum ainda (sai todo dia às 5h)"),
        ("Ligado há", f"{m['ligado_ha_horas']} h"),
        ("Alertas no celular", "ligados (ntfy)" if r["alertas_ligados"] else "desligados"),
    ]
    tabela = "".join(f"<tr><th>{html.escape(a)}</th><td>{html.escape(str(b))}</td></tr>" for a, b in linhas)
    return HTMLResponse(f"""<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="300">
<title>Resenha · uso</title><style>
:root{{color-scheme:dark}}body{{margin:0;background:#0b0e19;color:#e3e7f0;font:15px system-ui,sans-serif;padding:16px}}
main{{max-width:760px;margin:auto}}h1{{font-size:22px;margin:8px 0 16px}}
.barra{{height:18px;background:#1f2741;border-radius:9px;overflow:hidden;margin:6px 0 4px}}
.barra i{{display:block;height:100%;width:{pct}%;background:{cor}}}
table{{width:100%;border-collapse:collapse;margin-top:14px}}th,td{{text-align:left;padding:8px 6px;border-bottom:1px solid #232b47;vertical-align:top}}
th{{color:#8f99ae;font-weight:500;width:42%}}small{{color:#8f99ae}}button{{margin-top:14px;background:#ffb547;border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer}}
</style></head><body><main><h1>Resenha · uso do servidor</h1>
<div>Franquia grátis do Cloudflare este mês ({html.escape(c['mes'])})</div>
<div class="barra"><i></i></div><small>{c['usado_gb']:.1f} GB de {c['limite_gb']:.0f} GB · previsão {html.escape(previsao)}</small>
<table>{tabela}</table>
<button onclick="fetch('/api/uso/atualizar',{{method:'POST'}}).then(()=>location.reload())">Atualizar agora</button>
<p><small>Os números do Cloudflare chegam com atraso de alguns minutos. A página recarrega a cada 5 min.</small></p>
</main></body></html>""")
