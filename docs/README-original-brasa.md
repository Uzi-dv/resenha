> Guia original do projeto Brasa (https://github.com/aranhoso/brasa), com os nomes trocados para Resenha. O guia do Resenha está no README.md da raiz.

<p align="center"><img src="client/build/icon.png" width="120" alt=""></p>

# Resenha

Voz, chat e transmissão de tela para o seu grupo de amigos, com **o servidor rodando na sua máquina**.
Cada grupo sobe a própria instalação: as contas, as mensagens e as fotos ficam com você.

- **Servidores e canais** de texto e de voz, mensagens diretas, respostas, reações, enquetes, menções e anexos de imagem.
- **Voz** com supressão de ruído (RNNoise), volume por pessoa e indicador de quem está falando.
- **Transmissão de tela** de um jogo ou janela com o **áudio só do jogo**, e câmera. O vídeo usa codificação por hardware (AV1, H265 ou H264).
- **Convites em link** (`https://seu-dominio.com/convite/abc123`) que abrem o app instalado.
- **Tweets do X/Twitter** viram um cartão na conversa.
- **App para Windows** com atualização automática, **versão no navegador** (também no celular) e página de download.
- Temas claro e escuro, painel de moderação para o administrador.

> [!WARNING]
> **Use por sua conta e risco.** O Resenha é distribuído como está, sem garantia de nenhum tipo e sem suporte.
> Os autores não se responsabilizam pelo projeto nem por nada que aconteça com o seu uso: instalações, servidores,
> dados, contas, custos de serviços de terceiros (Cloudflare, ngrok, Resend, GitHub), segurança, conteúdo publicado
> pelos usuários ou qualquer outro dano. Quem instala, hospeda ou usa o Resenha assume todos os riscos e é o único
> responsável pela própria instalação e pelo cumprimento das leis aplicáveis. Veja a [licença](LICENSE).

---

## Sumário

1. [Como funciona](#como-funciona)
2. [O que você precisa](#o-que-você-precisa)
3. [Passo 1: criar o seu repositório](#passo-1-criar-o-seu-repositório)
4. [Passo 2: Cloudflare Realtime (voz e vídeo)](#passo-2-cloudflare-realtime-voz-e-vídeo)
5. [Passo 3: subir o servidor](#passo-3-subir-o-servidor)
6. [Passo 4: colocar o servidor na internet](#passo-4-colocar-o-servidor-na-internet)
7. [Passo 5: deixar o servidor sempre ligado](#passo-5-deixar-o-servidor-sempre-ligado)
8. [Passo 6: gerar o app e publicar as versões](#passo-6-gerar-o-app-e-publicar-as-versões)
9. [Passo 7: chamar os amigos](#passo-7-chamar-os-amigos)
10. [E-mails (opcional)](#e-mails-opcional)
11. [Administração](#administração)
12. [Atualizar a sua instalação](#atualizar-a-sua-instalação)
13. [Desenvolvimento](#desenvolvimento)
14. [Referência: variáveis do servidor](#referência-variáveis-do-servidor)
15. [Segurança](#segurança)
16. [Problemas comuns](#problemas-comuns)
17. [Licença](#licença)

---

## Como funciona

```
  Seu PC (servidor do Resenha)                         Cloudflare Realtime (SFU)
 ┌───────────────────────────────────┐              ┌────────────────────────────────┐
 │ FastAPI + SQLite                  │  segredo do  │ recebe 1 cópia do áudio/vídeo  │
 │ contas, servidores, mensagens,    │  Cloudflare  │ de cada pessoa e entrega a     │
 │ convites, quem está em qual call  │ ───────────► │ quem precisa (servidores perto │
 │ + versão web e página de download │  só aqui     │ de todo mundo)                 │
 └───────────────▲───────────────────┘              └───────────────▲────────────────┘
                 │ HTTPS (túnel: Cloudflare Tunnel ou ngrok)        │ voz e vídeo
                 └───────────── App Resenha dos seus amigos ──────────┘
```

- **O servidor é leve.** Ele só guarda os dados e coordena quem está em qual call; a voz e o vídeo não passam por ele.
  Um notebook antigo dá conta de um grupo de amigos.
- **A mídia passa pelo Cloudflare Realtime.** Cada pessoa envia o áudio e o vídeo uma vez só, e quem assiste baixa.
  O segredo da conta Cloudflare fica só no servidor. O app pede tudo ao seu servidor, que conversa com a Cloudflare.
- **O servidor não precisa de porta aberta no roteador.** Ele fica atrás de um túnel (Cloudflare Tunnel ou ngrok), que dá um endereço HTTPS público.
- **O app é Electron (Windows)** e a versão web é o mesmo app, servido pelo seu servidor.

### Quanto custa

| Item | Custo |
| :--- | :--- |
| Cloudflare Realtime (voz/vídeo) e TURN | **1.000 GB/mês grátis**; depois, US$ 0,05/GB. Voz é desprezível; uma transmissão 1080p gasta uns 3 GB por hora **por espectador**. |
| Cloudflare Tunnel | Grátis. Precisa de um domínio seu (~US$ 10/ano). |
| ngrok (alternativa sem domínio) | Grátis, com limite mensal de tráfego e de requisições (ver o [Passo 4](#opção-b-ngrok-sem-domínio)). |
| GitHub (código, releases e CI) | Grátis. |
| Resend (e-mails, opcional) | Grátis até 3.000 e-mails/mês. |

---

## O que você precisa

- **Um PC para o servidor** que possa ficar ligado. Windows 10/11 é o caminho deste guia (Linux também funciona).
- **[Python 3.11+](https://www.python.org/downloads/)** e **[Git](https://git-scm.com/downloads)** nesse PC.
- **Uma conta na [Cloudflare](https://dash.cloudflare.com/sign-up)** (grátis) e uma no **[GitHub](https://github.com/signup)**.
- **Opcional:** um domínio (para o Cloudflare Tunnel e para os e-mails). Sem domínio, use o ngrok.
- **Só para gerar o app no seu PC (opcional):** [Node.js 22](https://nodejs.org/). A pipeline do GitHub gera o app sem você instalar nada.

---

## Passo 1: criar o seu repositório

1. No GitHub, crie a sua cópia deste repositório (**Use this template** ou **Fork**). Pode ser privada.
2. Crie também um repositório **público e vazio** para as versões do app, por exemplo `resenha-releases`.
   É de lá que o app instalado se atualiza sozinho, sem precisar de login.
3. No PC do servidor, baixe o código:

```powershell
git clone https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git C:\Resenha
```

---

## Passo 2: Cloudflare Realtime (voz e vídeo)

1. Entre em <https://dash.cloudflare.com>.
2. No menu lateral, abra **Realtime → Serverless SFU** e clique em **Create**. O nome pode ser `resenha`.
3. Copie o **App ID** e o **App Secret** (o painel também chama de "App Token").
4. *(Recomendado)* Em **Realtime → TURN Server**, crie uma chave e copie o **Token ID** e o **API Token**.
   Isso ajuda quem está em rede que bloqueia UDP (faculdade, empresa, 4G ruim).

Guarde esses valores: eles vão no `.env` do servidor no próximo passo, e **só lá**.

---

## Passo 3: subir o servidor

Na pasta `server`:

```powershell
cd C:\Resenha\server
py run.py
```

Na primeira vez, o `run.py` cria o ambiente Python (`venv`), instala as dependências e cria o arquivo `.env`.
Feche com **Ctrl+C**, abra o `.env` no Bloco de Notas e preencha:

```env
PUBLIC_URL=https://seu-dominio.com        # o endereço público do Passo 4 (por enquanto, http://localhost:8000)
CF_REALTIME_APP_ID=...
CF_REALTIME_APP_TOKEN=...
CF_TURN_KEY_ID=...                        # opcional
CF_TURN_KEY_TOKEN=...                     # opcional
WEB_RELEASES_REPO=SEU-USUARIO/resenha-releases
```

Rode `py run.py` de novo e abra <http://localhost:8000/api/status>. A resposta deve ter `"app": "Resenha API"`
e `"voice": true` (se der `false`, confira as chaves da Cloudflare).

> O servidor cria sozinho o banco (`resenha.db`), a pasta `uploads/` (fotos) e o `.jwt_secret` (segredo dos logins).
> **Esses arquivos e o `.env` são a sua instalação:** não os apague e nunca faça commit deles (o `.gitignore` já os ignora).

---

## Passo 4: colocar o servidor na internet

Escolha uma opção. Depois, ponha o endereço final em `PUBLIC_URL` no `.env` e reinicie o servidor.

### Opção A: Cloudflare Tunnel (recomendada, com domínio)

Sem limite de tráfego e com o endereço que você quiser (`https://seu-dominio.com`).

1. **Domínio na Cloudflare:** em <https://dash.cloudflare.com>, clique em **Adicionar um domínio**, digite o seu domínio e escolha o plano **Free**.
   A Cloudflare mostra **dois nameservers**. No site onde você comprou o domínio, troque os nameservers por esses dois e espere o domínio aparecer como **Ativo**.
2. **Criar o túnel:** em **Zero Trust → Networks → Tunnels → Create a tunnel**, escolha **Cloudflared** e dê um nome (ex.: `resenha`).
   Na tela de instalação, escolha **Windows** e copie o comando (ele contém um token: trate como senha).
3. **Instalar no PC do servidor** (PowerShell como administrador):

   ```powershell
   winget install --id Cloudflare.cloudflared -e
   cloudflared.exe service install <TOKEN-DO-PASSO-2>
   ```

4. **Ligar o domínio ao servidor:** ainda no túnel, em **Public Hostname** (ou "Published application routes"), adicione:
   Subdomain *(vazio)* · Domain `seu-dominio.com` · Type **HTTP** · URL `localhost:8000`.
5. **Ajustes no painel do domínio:**
   - Deixe **Security → Bots → Bot Fight Mode desligado**, porque ele bloqueia o app.
   - Mantenha **Network → WebSockets ligado**.

O túnel aparece como **HEALTHY** e <https://seu-dominio.com/api/status> responde. O `cloudflared` já fica como serviço do Windows e volta sozinho depois de reiniciar.

### Opção B: ngrok (sem domínio)

1. Crie uma conta em <https://ngrok.com>, instale (`winget install --id Ngrok.Ngrok`) e configure o token:
   `ngrok config add-authtoken <SEU-TOKEN>`.
2. Pegue o **domínio fixo grátis** em <https://dashboard.ngrok.com/domains> (algo como `seu-nome.ngrok-free.dev`).
3. Rode o servidor com o túnel:

   ```powershell
   py run.py --ngrok --domain=seu-nome.ngrok-free.dev
   ```

> **Limite do plano grátis:** o ngrok tem uma cota mensal de tráfego e de requisições, e cada mensagem e cada foto exibida contam.
> Com o grupo ativo, a cota pode acabar antes do fim do mês; nesse caso, passe para a Opção A.

---

## Passo 5: deixar o servidor sempre ligado

### Servidor como serviço do Windows (NSSM)

Assim ele sobe com o Windows, mesmo sem ninguém logado, e reinicia sozinho se cair.
Instale o [NSSM](https://nssm.cc/download) (`winget install --id NSSM.NSSM`) e, no PowerShell como administrador:

```powershell
$repo = 'C:\Resenha\server'
nssm install ResenhaServer "$repo\venv\Scripts\python.exe" "-m uvicorn app.main:app --host 127.0.0.1 --port 8000 --ws-ping-interval 20 --ws-ping-timeout 20 --proxy-headers"
nssm set ResenhaServer AppDirectory $repo
nssm set ResenhaServer DisplayName "Resenha - servidor"
nssm set ResenhaServer Start SERVICE_AUTO_START
nssm set ResenhaServer AppExit Default Restart
nssm set ResenhaServer AppRestartDelay 5000
New-Item -ItemType Directory -Force "$repo\logs" | Out-Null
nssm set ResenhaServer AppStdout "$repo\logs\server.log"
nssm set ResenhaServer AppStderr "$repo\logs\server.log"
nssm set ResenhaServer AppRotateFiles 1
nssm set ResenhaServer AppRotateBytes 10485760
nssm start ResenhaServer
```

`nssm status ResenhaServer` deve mostrar `SERVICE_RUNNING`. O `AppDirectory` é obrigatório: é nessa pasta que o servidor procura o `.env`, o banco e as fotos.
(Rode `py run.py` uma vez antes, para criar o `venv`.)

### Não deixar o PC dormir (notebook)

```powershell
# Na tomada: nunca suspender nem hibernar
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
# Fechar a tampa na tomada não faz nada
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
```

Mais três ajustes ajudam:
- No adaptador Wi-Fi (Gerenciador de Dispositivos → Gerenciamento de Energia), desmarque "Permitir que o computador desligue este dispositivo".
- Configure o "Horário ativo" do Windows Update fora do horário em que o grupo usa.
- Se o fabricante permitir, limite a carga da bateria a ~80%.

### Backup diário

O banco é a única coisa insubstituível. O script `exportar_dados.py` gera um `.zip` com o banco, as fotos, o `.env` e o `.jwt_secret`.
Ele pode rodar com o servidor ligado. Para agendar todo dia às 5h, mantendo os 14 últimos:

```powershell
$action = New-ScheduledTaskAction -Execute 'C:\Resenha\server\venv\Scripts\python.exe' `
  -Argument 'scripts\exportar_dados.py --manter 14' -WorkingDirectory 'C:\Resenha\server'
$trigger = New-ScheduledTaskTrigger -Daily -At 5am
Register-ScheduledTask -TaskName 'Resenha - backup diario' -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest
```

Os pacotes ficam em `C:\Resenha\server\migracao\`. Copie um deles de vez em quando para outro lugar.
O `.zip` contém segredos: não mande em chat público nem faça commit.
Para restaurar ou migrar de máquina, extraia o conteúdo na pasta `server`.

---

## Passo 6: gerar o app e publicar as versões

### Pelo GitHub (recomendado)

A pipeline `.github/workflows/release.yml` gera o instalador e o pacote da versão web a cada push na `main` que mexa em `client/`.
Depois, publica tudo no seu repositório de releases.

1. **Token:** em GitHub → **Settings → Developer settings → Fine-grained tokens**, crie um token com acesso **só** ao repositório
   `resenha-releases` e permissão **Contents: Read and write**.
2. **No seu repositório do código**, em **Settings → Secrets and variables → Actions**:
   - **Secret** `RELEASES_TOKEN`: o token do item 1.
   - **Variable** `RELEASES_REPO`: `SEU-USUARIO/resenha-releases`.
   - **Variable** `SERVER_URL`: o endereço do seu servidor (ex.: `https://seu-dominio.com`). O app já abre conectado nele.
3. Em **Actions → Release → Run workflow**, rode a primeira vez. Em ~10 minutos aparece a release `v1.0.0` com o
   `Resenha-Setup-1.0.0.exe`, a versão portátil e o `resenha-web-1.0.0.zip`.

Daí em diante:
- **Atualização automática:** cada push que mexe em `client/` publica uma versão nova (+1 no último número), e os apps instalados se atualizam sozinhos. O **Ctrl+R** no app procura na hora.
- **Notas:** as notas da versão vêm dos commits. Para escrever notas próprias ou pular para uma versão maior, suba a versão no `client/package.json` e crie um `client/RELEASE_NOTES.md`.
- **Versão web:** o servidor baixa sozinho o pacote web da última release (a cada 30 minutos) e a serve no próprio endereço.

> Sem a variável `RELEASES_REPO`, a pipeline de release não roda (a de checagem, `ci.yml`, roda sempre).

### No seu PC

```powershell
cd C:\Resenha\client
npm ci
$env:VITE_SERVER_URL = "https://seu-dominio.com"
npm run dist
```

Os instaladores ficam em `client\dist-electron\`. Assim, o app não se atualiza sozinho, a não ser que você também
preencha `build.publish` (owner/repo) no `client/package.json` e publique as versões lá (`npm run release`, com `GH_TOKEN` e `GH_REPO` no ambiente).

> Se o app for gerado sem `VITE_SERVER_URL`, ele pergunta o endereço do servidor na primeira vez que abre. Dá para trocar depois com **F3**.

---

## Passo 7: chamar os amigos

1. Mande o link da página de download: `https://seu-dominio.com/download`. Ela sempre aponta para o instalador mais novo.
   Também dá para usar direto no navegador: `https://seu-dominio.com`.
2. Cada pessoa cria a conta no app.
3. Crie um servidor e convide pelo link (**Convidar pessoas**). O link abre o app instalado ou a página do convite.

O Windows pode mostrar "O Windows protegeu o computador" porque o app não tem assinatura digital: **Mais informações → Executar assim mesmo**.

---

## E-mails (opcional)

Sem configuração, o cadastro entra direto. Com a [Resend](https://resend.com), o app passa a pedir a **confirmação do e-mail**
no cadastro e ganha o **"Esqueci minha senha"**.

1. Na Resend, em **Domains**, adicione um subdomínio seu (ex.: `mail.seu-dominio.com`) e crie no seu DNS os registros que ela mostrar.
2. Em **API Keys**, crie uma chave com permissão **Sending access** só para esse domínio.
3. No `.env` do servidor:

```env
RESEND_API_KEY=re_...
EMAIL_FROM=Resenha <nao-responda@mail.seu-dominio.com>
```

O código tem 6 dígitos e vale 15 minutos, com 5 tentativas. Dá para pedir outro a cada 60 s, até 5 por hora.
Trocar a senha encerra as outras sessões da conta. Os textos dos e-mails ficam em `server/app/email.py`.

---

## Administração

O **super admin** tem um painel de moderação. Por ele, pode:
- tirar alguém da call e encerrar sessões;
- suspender ou excluir contas;
- renomear e excluir servidores.

Para dar o super admin a uma conta (crie a conta no app antes):

```powershell
cd C:\Resenha\server
.\venv\Scripts\python.exe scripts\superadmin.py SeuNome          # dá
.\venv\Scripts\python.exe scripts\superadmin.py SeuNome --remover
.\venv\Scripts\python.exe scripts\superadmin.py --listar
nssm restart ResenhaServer
```

A pessoa precisa reabrir o app para ver o painel.

### Operação do dia a dia

| Tarefa | Comando (PowerShell como administrador) |
| :--- | :--- |
| Ver se está no ar | `nssm status ResenhaServer` e abrir `https://seu-dominio.com/api/status` |
| Reiniciar o servidor | `nssm restart ResenhaServer` |
| Ver o log | `Get-Content C:\Resenha\server\logs\server.log -Tail 50` |

---

## Atualizar a sua instalação

Para trazer melhorias deste repositório para o seu:

```powershell
# No seu repositório (em qualquer PC): traga as mudanças daqui e faça push
git remote add upstream https://github.com/aranhoso/brasa.git   # uma vez
git pull upstream main
git push
```

O push na `main` publica um app novo, se `client/` mudou. No PC do servidor:

```powershell
cd C:\Resenha\server
git pull
.\venv\Scripts\python.exe -m pip install -r requirements.txt
nssm restart ResenhaServer
```

As mudanças no banco de dados rodam sozinhas quando o servidor inicia. Faça um backup antes de atualizar.

---

## Desenvolvimento

```
client/   app (Electron + React + Vite + Tailwind)
  electron/   processo principal: janela, captura de tela/áudio, atualização, links resenha://
  src/        interface; voz e vídeo em src/services/voice (WebRTC do Chromium + Cloudflare)
  scripts/    versão e publicação das releases, gerar o ícone
server/   servidor (FastAPI + SQLite + WebSocket)
  app/        rotas, gateway em tempo real, proxy do Cloudflare Realtime, e-mails, páginas de download/convite
  scripts/    super admin e backup
  tests/      testes ponta a ponta (com Cloudflare, GitHub e Resend falsos)
```

**Servidor:** `cd server` e `py run.py`, que sobe em <http://localhost:8000>.
Os testes ponta a ponta rodam com `.\venv\Scripts\python.exe tests\run_e2e.py`.

**App:**

```powershell
cd client
npm install
npm start        # Vite + Electron; em desenvolvimento o app usa http://localhost:8000
```

- **Navegador:** `npm run dev` abre a versão web em <http://localhost:5173>.
- **Servidor:** **F3** troca o servidor.
- **Atalhos:** **F5** recarrega, **F12** abre as ferramentas de desenvolvedor.
- **Checagens:** `npx oxlint src electron` (lint) e `npm test` (testes).

O app só conversa com servidores que se identificam como `"Resenha API"` em `GET /`: login, senha e token nunca são
enviados para outro tipo de servidor.

---

## Referência: variáveis do servidor

Ficam no `server/.env` (modelo em `server/.env.example`).

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `PUBLIC_URL` | `http://localhost:8000` | Endereço público, usado nos links de convite |
| `CF_REALTIME_APP_ID` / `CF_REALTIME_APP_TOKEN` | — | **Obrigatórias para voz e tela** |
| `CF_TURN_KEY_ID` / `CF_TURN_KEY_TOKEN` | — | TURN (opcional, recomendado) |
| `WEB_RELEASES_REPO` | — | Repositório das releases (`usuario/repo`): página `/download` e versão web |
| `WEB_AUTO_UPDATE` | `1` | `0` desliga o download automático da versão web |
| `RESEND_API_KEY` / `EMAIL_FROM` | — | E-mails de confirmação e de senha (as duas são necessárias) |
| `JWT_SECRET` | gerado em `.jwt_secret` | Segredo dos logins |
| `MAX_UPLOAD_MB` | `10` | Tamanho máximo das imagens |
| `VOICE_RECONNECT_GRACE_SECONDS` | `20` | Quanto tempo alguém continua na call depois de cair |
| `DATABASE_URL` | `sqlite+aiosqlite:///./resenha.db` | Banco de dados |
| `NGROK_DOMAIN` | — | Domínio fixo do ngrok para `py run.py --ngrok` |

E no app, na hora de gerar (variável de ambiente ou variável do GitHub Actions):

| Variável | Descrição |
| :--- | :--- |
| `VITE_SERVER_URL` | Endereço do seu servidor. No GitHub Actions, vem da variável `SERVER_URL` |
| `build.publish` no `client/package.json` | Repositório das releases para a atualização automática. No GitHub Actions, vem de `RELEASES_REPO` |

---

## Segurança

- **Nunca faça commit de:**
  - `server/.env` (chaves da Cloudflare e da Resend);
  - `server/.jwt_secret` (quem tem esse arquivo forja logins);
  - `resenha.db`, `uploads/` e `migracao/`.

  O `.gitignore` já ignora todos eles.
- **Repositório de releases:** use um token fine-grained que só escreve nesse repositório, e guarde-o como *secret* do GitHub.
- **Token do túnel:** o comando do Cloudflare Tunnel contém um token. Se ele vazar, gere outro no painel (o túnel antigo para de funcionar).
- **Na Resend**, use uma chave só de envio, restrita ao seu domínio.
- **Senhas e convites:** as senhas são guardadas com bcrypt. Os códigos de e-mail ficam como HMAC, não em texto puro. Convites podem expirar e ter limite de usos.
- **Atualizações:** mantenha o servidor atualizado ([Atualizar a sua instalação](#atualizar-a-sua-instalação)). O CI recusa publicar um app com dependência de vulnerabilidade alta.

---

## Problemas comuns

| Sintoma | O que fazer |
| :--- | :--- |
| `"voice": false` em `/api/status` | Confira `CF_REALTIME_APP_ID` e `CF_REALTIME_APP_TOKEN` no `.env` e reinicie o servidor |
| "Esse endereço não é um servidor do Resenha" | O endereço responde, mas não é o seu servidor (ex.: domínio estacionado ou túnel apontando para outra porta) |
| App não conecta pelo domínio | Túnel **HEALTHY** no painel? **Bot Fight Mode** desligado? `http://localhost:8000/api/status` responde no PC do servidor? |
| Alguém não ouve ninguém (rede de faculdade/empresa) | Configure o TURN da Cloudflare (`CF_TURN_KEY_ID`/`CF_TURN_KEY_TOKEN`) |
| Link de convite aponta para `localhost` | Preencha `PUBLIC_URL` no `.env` com o endereço público e reinicie |
| `/download` mostra a página de releases | `WEB_RELEASES_REPO` vazio ou ainda sem nenhuma release publicada |
| O app não se atualiza | Confira as variáveis `RELEASES_REPO` e o secret `RELEASES_TOKEN`, e se a release saiu em **Actions** |

---

## Licença

[MIT](LICENSE). Pode usar, modificar e redistribuir, mantendo o aviso de autoria. O software é fornecido
"no estado em que se encontra", sem garantia de nenhum tipo: os autores não respondem por nenhum dano ou prejuízo
decorrente do uso, e quem usa assume todos os riscos.
