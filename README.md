<p align="center"><img src="client/build/icon.png" width="110" alt=""></p>

# Resenha

Voz, chat e transmissão de tela para a galera, com **servidor próprio**. Feito a partir do
[Brasa](https://github.com/aranhoso/brasa) (licença MIT), com a cara do Resenha.

- Servidores e canais de texto e de voz, mensagens diretas, respostas, reações, enquetes, menções e imagens.
- Voz com supressão de ruído, volume por pessoa e indicador de quem fala.
- Transmissão de tela com **o áudio só do jogo** (sem eco da voz dos amigos) e câmera.
- Mensagens e canais **ficam salvos no servidor**: ninguém "fica sozinho" ao reabrir.
- App para Windows que se atualiza sozinho, versão no navegador (também no celular) e página de download.

> [!WARNING]
> Distribuído como está, sem garantia. Quem hospeda é responsável pela própria instalação. Veja a [licença](LICENSE).

## Como funciona

```
 Oracle Cloud (grátis, 24 h)                        Cloudflare Realtime (grátis até 1.000 GB/mês)
 ┌──────────────────────────────┐                   ┌──────────────────────────────────┐
 │ servidor do Resenha (Python) │  chave só aqui    │ recebe 1 cópia da voz/vídeo de   │
 │ contas, mensagens, canais,   │ ────────────────► │ cada um e entrega para os outros │
 │ convites, versão web         │                   └───────────────▲──────────────────┘
 └───────────▲──────────────────┘                                   │ voz e vídeo
             │ HTTPS (https://SEU-NOME.duckdns.org)                 │
             └──────────────── app Resenha dos amigos ──────────────┘
```

O servidor é leve (~80 MB de memória, quase nada de processador): a voz e o vídeo não passam por ele.

## Instalação (uma vez)

### 1. Código no GitHub
Este repositório (`Uzi-dv/resenha`) é **público**: as versões do app saem nele mesmo e o app instalado se atualiza
por aqui. Segredos nunca entram no código: ficam só no servidor (`server/.env`).

Em **Settings → Secrets and variables → Actions → Variables**, crie `SERVER_URL` = `https://SEU-NOME.duckdns.org`.
Depois, **Actions → Release → Run workflow**. Em ~10 min sai a versão `v1.0.0` com o `Resenha-Setup-1.0.0.exe`.
Cada push que mexe em `client/` publica uma versão nova sozinho.

### 2. Cloudflare Realtime (voz e vídeo)
[dash.cloudflare.com](https://dash.cloudflare.com) → **Realtime → Serverless SFU → Create** (nome `resenha`).
Guarde o **App ID** e o **App Secret**. Recomendado: **Realtime → TURN Server → Create** (Token ID e API Token).

### 3. Endereço grátis (DuckDNS)
[duckdns.org](https://www.duckdns.org) → entre com o GitHub → crie um nome (ex.: `resenha-galera`) → guarde o **token**.

### 4. Servidor na Oracle Cloud (grátis)
1. [cloud.oracle.com](https://cloud.oracle.com) → **Create a VM instance**: imagem **Ubuntu 24.04**, shape **VM.Standard.A1.Flex**
   (1 OCPU, 6 GB) ou **VM.Standard.E2.1.Micro**. Baixe a chave SSH que ela oferece.
2. Na rede da instância (**Subnet → Security List → Add Ingress Rules**): libere TCP **80** e **443** de `0.0.0.0/0`.
3. Conecte (no PowerShell: `ssh -i chave.key ubuntu@IP-DA-MAQUINA`) e rode:

```bash
curl -fsSL https://raw.githubusercontent.com/Uzi-dv/resenha/main/server/instalar-oracle.sh -o instalar.sh
sudo bash instalar.sh
```

Ele pergunta o nome e o token do DuckDNS e as chaves do Cloudflare, e deixa tudo ligado: servidor, HTTPS,
atualização do endereço e backup diário (os 14 últimos, em `/opt/resenha/server/migracao/`).
Para atualizar o servidor depois: `sudo bash instalar.sh` de novo (não apaga nada).

### 5. Chamar a galera
Mande `https://SEU-NOME.duckdns.org/download`. Cada um baixa, cria a conta e entra pelo link de convite.
Também funciona direto no navegador: `https://SEU-NOME.duckdns.org`.
O Windows pode avisar "O Windows protegeu o computador" (app sem assinatura paga): **Mais informações → Executar assim mesmo**.

## Administração
Dar o super admin (painel de moderação) a uma conta, no servidor:

```bash
cd /opt/resenha/server && sudo -u resenha ./venv/bin/python scripts/superadmin.py SeuNome && sudo systemctl restart resenha
```

| Tarefa | Comando no servidor |
| :--- | :--- |
| Ver se está no ar | `sudo systemctl status resenha` ou abrir `https://SEU-NOME.duckdns.org/api/status` |
| Reiniciar | `sudo systemctl restart resenha` |
| Ver o log | `sudo journalctl -u resenha -n 50` |

## Limites e riscos
- **Oracle "Always Free":** a Oracle pode recuperar máquinas grátis que ficam ociosas por 7 dias. O backup diário existe por isso;
  copie um `.zip` de `migracao/` para o seu PC de vez em quando. Plano B: rodar o servidor no próprio PC (guia original em `docs/`).
- **Cloudflare:** 1.000 GB/mês grátis. Voz gasta quase nada; tela em 1080p gasta ~3 GB por hora **por pessoa assistindo**.
- **Sem e-mail configurado**, não existe "esqueci minha senha" (dá para configurar a Resend, ver `docs/`).

## Desenvolvimento
`client/` é o app (Electron + React + Vite) e `server/` o servidor (FastAPI + SQLite).
Servidor: `cd server && python run.py`. App: `cd client && npm install && npm start`.
Testes do servidor: `python tests/run_e2e.py`. O guia completo original está em [`docs/README-original-brasa.md`](docs/README-original-brasa.md).

## Licença
[MIT](LICENSE). Baseado no Brasa, © os autores do Brasa; modificações do Resenha © 2026 Gabriel Santos.
