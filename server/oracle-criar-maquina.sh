#!/usr/bin/env bash
# Cria a máquina grátis do Resenha na Oracle Cloud, pelo Cloud Shell (o terminal do próprio site da Oracle).
# Cria rede, libera as portas 22/80/443, cria a chave SSH e a máquina "Always Free", e mostra o IP.
# Pode rodar de novo: reaproveita o que já existir.
#
#   curl -fsSL https://raw.githubusercontent.com/Uzi-dv/resenha/main/server/oracle-criar-maquina.sh | bash
set -euo pipefail

C="${OCI_TENANCY:?Rode no Cloud Shell da Oracle}"
NOME=resenha
KEY="$HOME/.ssh/resenha"
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
q() { "$@" 2>/dev/null || true; }

[ -f "$KEY" ] || { say "Criando a chave SSH"; mkdir -p ~/.ssh; ssh-keygen -q -t rsa -b 4096 -N "" -f "$KEY" -C resenha; }

say "Rede"
VCN=$(q oci network vcn list -c "$C" --display-name resenha-vcn --query 'data[0].id' --raw-output)
if [ -z "$VCN" ] || [ "$VCN" = "None" ]; then
  VCN=$(oci network vcn create -c "$C" --cidr-block 10.0.0.0/16 --display-name resenha-vcn --dns-label resenha \
    --wait-for-state AVAILABLE --query data.id --raw-output)
fi
IGW=$(q oci network internet-gateway list -c "$C" --vcn-id "$VCN" --query 'data[0].id' --raw-output)
if [ -z "$IGW" ] || [ "$IGW" = "None" ]; then
  IGW=$(oci network internet-gateway create -c "$C" --vcn-id "$VCN" --is-enabled true --display-name resenha-igw \
    --wait-for-state AVAILABLE --query data.id --raw-output)
fi
RT=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
oci network route-table update --rt-id "$RT" --force \
  --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
SL=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)
porta() { echo "{\"source\":\"0.0.0.0/0\",\"protocol\":\"6\",\"isStateless\":false,\"tcpOptions\":{\"destinationPortRange\":{\"min\":$1,\"max\":$1}}}"; }
oci network security-list update --security-list-id "$SL" --force \
  --ingress-security-rules "[$(porta 22),$(porta 80),$(porta 443),{\"source\":\"0.0.0.0/0\",\"protocol\":\"1\",\"isStateless\":false,\"icmpOptions\":{\"type\":3,\"code\":4}},{\"source\":\"10.0.0.0/16\",\"protocol\":\"1\",\"isStateless\":false,\"icmpOptions\":{\"type\":3}}]" \
  --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all","isStateless":false}]' >/dev/null
SUB=$(q oci network subnet list -c "$C" --vcn-id "$VCN" --display-name resenha-subnet --query 'data[0].id' --raw-output)
if [ -z "$SUB" ] || [ "$SUB" = "None" ]; then
  SUB=$(oci network subnet create -c "$C" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 --display-name resenha-subnet \
    --dns-label pub --wait-for-state AVAILABLE --query data.id --raw-output)
fi
echo "rede ok (portas 22, 80 e 443 liberadas)"

say "Máquina"
INST=$(q oci compute instance list -c "$C" --display-name "$NOME" --lifecycle-state RUNNING --query 'data[0].id' --raw-output)
if [ -z "$INST" ] || [ "$INST" = "None" ]; then
  ADS=$(oci iam availability-domain list -c "$C" --query 'data[].name' --raw-output | tr -d '[]", ' | grep -v '^$')
  tentar() { # shape  config  imagem
    for AD in $ADS; do
      echo "tentando $1 em $AD..."
      if INST=$(oci compute instance launch -c "$C" --availability-domain "$AD" --shape "$1" ${2:+--shape-config "$2"} \
          --image-id "$3" --subnet-id "$SUB" --assign-public-ip true --display-name "$NOME" \
          --ssh-authorized-keys-file "$KEY.pub" --wait-for-state RUNNING --max-wait-seconds 900 \
          --query data.id --raw-output 2>/tmp/erro-oracle.txt); then return 0; fi
      grep -o '"message": "[^"]*"' /tmp/erro-oracle.txt | head -1
    done
    return 1
  }
  img() { oci compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
    --shape "$1" --sort-by TIMECREATED --sort-order DESC --query 'data[0].id' --raw-output; }
  # 1ª opção: ARM (1 núcleo, 6 GB, Always Free). Se faltar vaga: a pequena x86 (1 GB, Always Free).
  tentar VM.Standard.A1.Flex '{"ocpus":1,"memoryInGBs":6}' "$(img VM.Standard.A1.Flex)" || \
  tentar VM.Standard.E2.1.Micro "" "$(img VM.Standard.E2.1.Micro)" || {
    echo; echo "A Oracle está sem vaga agora nas máquinas grátis. Tente de novo daqui a alguns minutos ou horas."; exit 1; }
fi
IP=$(oci compute instance list-vnics --instance-id "$INST" --query 'data[0]."public-ip"' --raw-output)
SHAPE=$(oci compute instance get --instance-id "$INST" --query 'data.shape' --raw-output)
echo "máquina $SHAPE ligada, IP $IP"
echo "$IP" > ~/resenha-ip.txt

say "Esperando a máquina aceitar conexão"
for i in $(seq 1 60); do
  ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 -o BatchMode=yes ubuntu@"$IP" true 2>/dev/null && break
  sleep 5
done

cat <<EOF

Pronto! Máquina no ar: $IP
Agora instale o servidor (ele vai pedir o DuckDNS e as chaves do Cloudflare):

  ssh -t -i ~/.ssh/resenha ubuntu@$IP "curl -fsSL https://raw.githubusercontent.com/Uzi-dv/resenha/main/server/instalar-oracle.sh -o instalar.sh && sudo bash instalar.sh"
EOF
