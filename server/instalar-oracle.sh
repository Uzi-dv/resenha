#!/usr/bin/env bash
# Instala o servidor do Resenha numa máquina Linux (Oracle Cloud Always Free, Ubuntu 22.04/24.04).
# Deixa tudo ligado sozinho: o servidor, o HTTPS (Caddy + Let's Encrypt), o endereço grátis (DuckDNS)
# e um backup por dia. Rode de novo quando quiser atualizar: ele não apaga os seus dados.
#
#   curl -fsSL https://raw.githubusercontent.com/Uzi-dv/resenha/main/server/instalar-oracle.sh -o instalar.sh
#   sudo bash instalar.sh
#
# Ele pergunta: o nome do DuckDNS, o token do DuckDNS e as duas chaves do Cloudflare Realtime.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Uzi-dv/resenha.git}"
RELEASES_REPO="${RELEASES_REPO:-Uzi-dv/resenha}"
PASTA="/opt/resenha"
USUARIO="resenha"

if [ "$(id -u)" != "0" ]; then echo "Rode com sudo:  sudo bash $0"; exit 1; fi
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

# ------------------------------------------------------------------ perguntas (só na 1ª vez)
CFG=/etc/resenha-instalacao.conf
[ -f "$CFG" ] && . "$CFG"
pergunta() { # nome  texto  [segredo]
  local atual="${!1:-}"
  if [ -n "$atual" ]; then return; fi
  if [ "${3:-}" = "segredo" ]; then read -rsp "$2: " v; echo; else read -rp "$2: " v; fi
  printf -v "$1" '%s' "$v"
}
pergunta DUCK_NOME   "Nome no DuckDNS (só a parte antes de .duckdns.org, ex.: resenha-galera)"
pergunta DUCK_TOKEN  "Token do DuckDNS (aparece no topo de duckdns.org depois do login)" segredo
pergunta CF_ID       "Cloudflare Realtime: App ID"
pergunta CF_TOKEN    "Cloudflare Realtime: App Secret (App Token)" segredo
pergunta CF_TURN_ID  "Cloudflare TURN: Token ID (Enter para pular)"
[ -n "${CF_TURN_ID:-}" ] && pergunta CF_TURN_TOKEN "Cloudflare TURN: API Token" segredo
DUCK_NOME="${DUCK_NOME%.duckdns.org}"
DOMINIO="$DUCK_NOME.duckdns.org"
umask 077
cat > "$CFG" <<EOF
DUCK_NOME='$DUCK_NOME'
DUCK_TOKEN='$DUCK_TOKEN'
CF_ID='$CF_ID'
CF_TOKEN='$CF_TOKEN'
CF_TURN_ID='${CF_TURN_ID:-}'
CF_TURN_TOKEN='${CF_TURN_TOKEN:-}'
EOF
umask 022

# ------------------------------------------------------------------ DuckDNS: aponta o nome para este servidor
say "Atualizando o DuckDNS ($DOMINIO)"
cat > /usr/local/bin/resenha-duckdns <<EOF
#!/bin/sh
curl -fsS "https://www.duckdns.org/update?domains=$DUCK_NOME&token=$DUCK_TOKEN&ip=" -o /var/log/resenha-duckdns.log
EOF
chmod 700 /usr/local/bin/resenha-duckdns
/usr/local/bin/resenha-duckdns
grep -q OK /var/log/resenha-duckdns.log || { echo "O DuckDNS recusou: confira o nome e o token."; exit 1; }
echo "*/5 * * * * root /usr/local/bin/resenha-duckdns" > /etc/cron.d/resenha-duckdns

# ------------------------------------------------------------------ memória extra (máquina de 1 GB)
if [ ! -f /swapfile ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ]; then
  say "Criando 2 GB de memória extra (swap)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ------------------------------------------------------------------ pacotes
say "Instalando pacotes"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git python3 python3-venv python3-pip curl cron caddy iptables-persistent >/dev/null

# ------------------------------------------------------------------ firewall do Ubuntu da Oracle (bloqueia 80/443 por padrão)
say "Liberando as portas 80 e 443"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -p tcp --dport $p -m state --state NEW -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true

# ------------------------------------------------------------------ código
say "Baixando o Resenha"
id "$USUARIO" >/dev/null 2>&1 || useradd --system --home "$PASTA" --shell /usr/sbin/nologin "$USUARIO"
if [ -d "$PASTA/.git" ]; then
  git -c safe.directory="$PASTA" -C "$PASTA" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$PASTA"
fi
cd "$PASTA/server"
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q -r requirements.txt

# ------------------------------------------------------------------ .env (mantém o que já existir)
[ -f .env ] || cp .env.example .env
definir() { # chave valor
  if grep -qE "^#? ?$1=" .env; then sed -i "s|^#\? \?$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
definir PUBLIC_URL "https://$DOMINIO"
definir CF_REALTIME_APP_ID "$CF_ID"
definir CF_REALTIME_APP_TOKEN "$CF_TOKEN"
definir CF_TURN_KEY_ID "${CF_TURN_ID:-}"
definir CF_TURN_KEY_TOKEN "${CF_TURN_TOKEN:-}"
definir WEB_RELEASES_REPO "$RELEASES_REPO"
chmod 600 .env
chown -R "$USUARIO:$USUARIO" "$PASTA"

# ------------------------------------------------------------------ serviço (liga sozinho e reinicia se cair)
say "Criando o serviço"
cat > /etc/systemd/system/resenha.service <<EOF
[Unit]
Description=Resenha - servidor
After=network-online.target
Wants=network-online.target

[Service]
User=$USUARIO
WorkingDirectory=$PASTA/server
ExecStart=$PASTA/server/venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --ws-ping-interval 20 --ws-ping-timeout 20 --proxy-headers
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now resenha
systemctl restart resenha

# ------------------------------------------------------------------ HTTPS (Caddy pega o certificado sozinho)
say "Configurando o HTTPS"
cat > /etc/caddy/Caddyfile <<EOF
$DOMINIO {
  encode gzip
  reverse_proxy 127.0.0.1:8000
}
EOF
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

# ------------------------------------------------------------------ backup diário (guarda os 14 últimos)
cat > /etc/cron.d/resenha-backup <<EOF
0 5 * * * $USUARIO cd $PASTA/server && ./venv/bin/python scripts/exportar_dados.py --manter 14 >/dev/null 2>&1
EOF

# ------------------------------------------------------------------ conferência
say "Conferindo"
ok=0
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:8000/api/status" 2>/dev/null | grep -q '"voice": *true'; then ok=1; break; fi
  sleep 2
done
if [ $ok = 1 ]; then echo "Servidor no ar com voz ligada."; else
  echo "O servidor subiu, mas a voz está desligada: confira as chaves do Cloudflare (sudo nano $PASTA/server/.env e sudo systemctl restart resenha)."; fi
for i in $(seq 1 30); do
  if curl -fsS "https://$DOMINIO/api/status" >/dev/null 2>&1; then echo "HTTPS ok: https://$DOMINIO"; break; fi
  sleep 3
  [ $i = 30 ] && echo "O HTTPS ainda não respondeu. Confira no painel da Oracle se as portas 80 e 443 estão liberadas (Security List)."
done

cat <<EOF

Pronto!
  Endereço do servidor:   https://$DOMINIO
  Página de download:     https://$DOMINIO/download
  Ver se está no ar:      sudo systemctl status resenha
  Ver o log:              sudo journalctl -u resenha -n 50
  Atualizar:              sudo bash $0   (roda de novo, sem perder dados)
  Backups:                $PASTA/server/migracao/
EOF
