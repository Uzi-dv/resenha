#!/usr/bin/env bash
# Liga o monitor de uso do Resenha (painel /painel, alertas no celular e trava de vídeo perto do limite grátis).
#   sudo bash configurar-monitor.sh
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "Rode com sudo:  sudo bash $0"; exit 1; }
ENV=/opt/resenha/server/.env
[ -f "$ENV" ] || { echo "Servidor não encontrado em /opt/resenha."; exit 1; }
atual() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- || true; }
definir() { if grep -qE "^#? ?$1=" "$ENV"; then sed -i "s|^#\? \?$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }

echo "Monitor de uso do Resenha"
CONTA="${CF_ACCOUNT_ID:-$(atual CF_ACCOUNT_ID)}"
if [ -z "$CONTA" ]; then read -rp "ID da conta Cloudflare (o código longo na URL do painel): " CONTA; fi
definir CF_ACCOUNT_ID "$(printf '%s' "$CONTA" | tr -d '[:space:]')"
echo
read -rsp "Token de API do Cloudflare com 'Account Analytics: Read' (cole e Enter; não aparece; Enter vazio mantém): " TK; echo
TK="$(printf '%s' "$TK" | tr -d '[:space:]')"
[ -n "$TK" ] && definir CF_ANALYTICS_TOKEN "$TK" && echo "  ok, token salvo (${#TK} caracteres)"
[ -n "$(atual PAINEL_SENHA)" ] || definir PAINEL_SENHA "$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)"
[ -n "$(atual NTFY_TOPICO)" ] || definir NTFY_TOPICO "resenha-$(head -c 24 /dev/urandom | base64 | tr -dc 'a-z0-9' | head -c 20)"
[ -n "$(atual CF_BLOQUEAR_VIDEO_PCT)" ] || definir CF_BLOQUEAR_VIDEO_PCT 90
chmod 600 "$ENV"; chown resenha:resenha "$ENV"

git -c safe.directory=/opt/resenha -C /opt/resenha pull -q --ff-only || echo "(não consegui baixar a versão nova do código; seguindo com a atual)"
chown -R resenha:resenha /opt/resenha
systemctl restart resenha
sleep 6
SENHA="$(atual PAINEL_SENHA)"; TOPICO="$(atual NTFY_TOPICO)"; URL="$(atual PUBLIC_URL)"
R="$(curl -fsS -u "admin:$SENHA" -X POST http://127.0.0.1:8000/api/uso/atualizar || true)"
echo
if echo "$R" | grep -q '"erro": *null\|"erro":null'; then echo "Cloudflare: OK (números chegando)"; else
  echo "Cloudflare: $(echo "$R" | grep -o '"erro": *"[^"]*"' | head -1)"; fi
cat <<FIM

Pronto!
  Painel:   $URL/painel
  Usuário:  admin
  Senha:    $SENHA
  Alertas:  instale o app "ntfy" no celular (Android/iPhone) e assine o tópico:  $TOPICO
            (ou abra https://ntfy.sh/$TOPICO no navegador)
  Trava:    tela e câmera pausam sozinhas em 90% da franquia grátis; a voz continua.
Guarde a senha e o tópico: quem tiver o tópico recebe os alertas.
FIM
