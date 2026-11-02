#!/usr/bin/env bash
# Troca as chaves do Cloudflare (voz/tela e TURN) no servidor do Resenha, sem reinstalar nada.
#   sudo bash trocar-chaves.sh
# Enter vazio mantém a chave atual.
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "Rode com sudo:  sudo bash $0"; exit 1; }
ENV=/opt/resenha/server/.env
CFG=/etc/resenha-instalacao.conf
[ -f "$ENV" ] || { echo "Servidor não encontrado em /opt/resenha. Rode o instalar-oracle.sh primeiro."; exit 1; }

atual() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
definir() {
  if grep -qE "^#? ?$1=" "$ENV"; then sed -i "s|^#\? \?$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi
}
pergunta() { # chave  texto  segredo?
  local v
  echo
  if [ "${3:-}" = "segredo" ]; then
    read -rsp "$2 (cole e aperte Enter; não aparece na tela): " v; echo
  else
    read -rp "$2: " v
  fi
  v="$(printf '%s' "$v" | tr -d '[:space:]')"
  if [ -n "$v" ]; then definir "$1" "$v"; echo "  ok, $1 atualizado (${#v} caracteres)"; else echo "  mantido"; fi
}

echo "Cole cada valor quando pedir. Enter vazio mantém o que já está."
pergunta CF_REALTIME_APP_ID    "1/4  Serverless SFU: App ID"
pergunta CF_REALTIME_APP_TOKEN "2/4  Serverless SFU: API Token" segredo
pergunta CF_TURN_KEY_ID        "3/4  TURN: Turn Token ID"
pergunta CF_TURN_KEY_TOKEN     "4/4  TURN: API Token" segredo
chmod 600 "$ENV"; chown resenha:resenha "$ENV"

# mantém o arquivo da instalação em dia (para reinstalações)
if [ -f "$CFG" ]; then
  umask 077
  sed -i "s|^CF_ID=.*|CF_ID='$(atual CF_REALTIME_APP_ID)'|; s|^CF_TOKEN=.*|CF_TOKEN='$(atual CF_REALTIME_APP_TOKEN)'|; \
s|^CF_TURN_ID=.*|CF_TURN_ID='$(atual CF_TURN_KEY_ID)'|; s|^CF_TURN_TOKEN=.*|CF_TURN_TOKEN='$(atual CF_TURN_KEY_TOKEN)'|" "$CFG"
fi

echo; echo "Reiniciando o servidor..."
systemctl restart resenha
for i in $(seq 1 30); do
  s="$(curl -fsS http://127.0.0.1:8000/api/status 2>/dev/null || true)"
  [ -n "$s" ] && break; sleep 1
done
echo "$s" | grep -q '"voice": *true' && echo "Voz e tela: OK" || echo "Voz e tela: DESLIGADA (confira o App ID e o API Token do SFU)"

# testa as chaves de verdade na Cloudflare
ID="$(atual CF_REALTIME_APP_ID)"; TK="$(atual CF_REALTIME_APP_TOKEN)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TK" "https://rtc.live.cloudflare.com/v1/apps/$ID/sessions/new")
[ "$code" = "201" ] || [ "$code" = "200" ] && echo "Chave do SFU aceita pela Cloudflare" || echo "Cloudflare recusou a chave do SFU (código $code)"
TID="$(atual CF_TURN_KEY_ID)"; TTK="$(atual CF_TURN_KEY_TOKEN)"
if [ -n "$TID" ] && [ -n "$TTK" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TTK" -H "Content-Type: application/json" \
    -d '{"ttl": 60}' "https://rtc.live.cloudflare.com/v1/turn/keys/$TID/credentials/generate-ice-servers")
  [ "$code" = "201" ] || [ "$code" = "200" ] && echo "TURN: OK (chave aceita pela Cloudflare)" || echo "TURN: Cloudflare recusou a chave (código $code)"
else
  echo "TURN: não configurado"
fi
