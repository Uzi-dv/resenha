import os
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import subprocess
import time
import re
import shutil
import threading
from pathlib import Path

ROOT_DIR = Path(__file__).parent.resolve()
VENV_PYTHON = ROOT_DIR / "venv" / "Scripts" / "python.exe"
VENV_PIP = ROOT_DIR / "venv" / "Scripts" / "pip.exe"

def find_cloudflared() -> str:
    which = shutil.which("cloudflared")
    if which:
        return which

    possible_paths = [
        r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
        r"C:\Program Files\cloudflared\cloudflared.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\cloudflared\cloudflared.exe"),
    ]
    for p in possible_paths:
        if os.path.exists(p):
            return p
    return None

def find_ngrok() -> str:
    which = shutil.which("ngrok")
    if which:
        return which

    possible_paths = [
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links\ngrok.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\ngrok\ngrok.exe"),
        r"C:\Program Files\ngrok\ngrok.exe",
    ]
    for p in possible_paths:
        if os.path.exists(p):
            return p
    return None

def ensure_environment():
    if not VENV_PYTHON.exists():
        print("[1/3] Criando ambiente virtual Python...")
        subprocess.run([sys.executable, "-m", "venv", str(ROOT_DIR / "venv")], check=True)
        print("[2/3] Instalando dependências do backend...")
        subprocess.run([str(VENV_PIP), "install", "-r", str(ROOT_DIR / "requirements.txt")], check=True)

    else:
        # Garante dependências novas após atualizar o código (rápido quando já está tudo instalado)
        subprocess.run(
            [str(VENV_PIP), "install", "-q", "--disable-pip-version-check", "-r", str(ROOT_DIR / "requirements.txt")],
            check=False,
        )

    env_file = ROOT_DIR / ".env"
    if not env_file.exists():
        example = ROOT_DIR / ".env.example"
        if example.exists():
            shutil.copy(example, env_file)
        print()
        print("[!] Arquivo .env criado. Preencha CF_REALTIME_APP_ID e CF_REALTIME_APP_TOKEN para ativar voz/tela.")
    else:
        content = env_file.read_text(encoding="utf-8")
        configured = any(
            line.strip().startswith("CF_REALTIME_APP_TOKEN=") and line.strip() != "CF_REALTIME_APP_TOKEN="
            for line in content.splitlines()
        )
        if not configured:
            print()
            print("[!] Cloudflare Realtime não configurado no .env: chat funciona, mas voz/tela ficam desativados.")

def main():
    is_public = "--public" in sys.argv or "--share" in sys.argv
    is_ngrok = "--ngrok" in sys.argv or "--fixed" in sys.argv
    # Domínio fixo do ngrok: --domain=seu-nome.ngrok-free.dev ou NGROK_DOMAIN no ambiente
    ngrok_domain = os.getenv("NGROK_DOMAIN", "")
    for arg in sys.argv:
        if arg.startswith("--domain="):
            ngrok_domain = arg.split("=", 1)[1]

    print("=" * 65)
    print("           RESENHA SERVER - BACKEND FASTAPI & SQLITE          ")
    print("=" * 65)

    ensure_environment()

    # Inicia o backend FastAPI com Uvicorn
    print("\n[+] Iniciando backend FastAPI (porta 8000)...")
    backend_proc = subprocess.Popen(
        [str(VENV_PYTHON), "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000",
         "--ws-ping-interval", "20", "--ws-ping-timeout", "20", "--proxy-headers"],
        cwd=str(ROOT_DIR)
    )

    tunnel_proc = None
    public_url = None

    if is_ngrok:
        ngrok_bin = find_ngrok()
        if not ngrok_domain:
            print("
[!] Informe o domínio fixo do ngrok: py run.py --ngrok --domain=seu-nome.ngrok-free.dev")
            print("    (o domínio grátis fica em https://dashboard.ngrok.com/domains)")
        elif not ngrok_bin:
            print("\n[!] Aviso: ngrok não foi encontrado no sistema.")
            print("    Instale com: winget install --id Ngrok.Ngrok")
        else:
            print(f"[+] Abrindo túnel fixo permanente Ngrok ({ngrok_domain})...")
            tunnel_proc = subprocess.Popen(
                [ngrok_bin, "http", f"--domain={ngrok_domain}", "8000"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace"
            )

            def monitor_ngrok():
                for line in tunnel_proc.stdout:
                    if "authentication failed" in line or "ERR_NGROK_4018" in line:
                        print("\n[!] ERRO DE AUTENTICAÇÃO DO NGROK:")
                        print("    Você precisa configurar seu token do ngrok uma única vez.")
                        print("    Pegue seu token em: https://dashboard.ngrok.com/get-started/your-authtoken")
                        print("    E execute no terminal:")
                        print("    ngrok config add-authtoken SEU_AUTH_TOKEN\n")

            threading.Thread(target=monitor_ngrok, daemon=True).start()

            print("\n" + "=" * 65)
            print(" 🌟 SERVIDOR RESENHA PÚBLICO (TÚNEL FIXO NGROK)!")
            print(" Endereço permanente para colar no seu Resenha Client:")
            print(f" 👉 https://{ngrok_domain} 👈")
            print("=" * 65 + "\n")

    elif is_public:
        cloudflared_bin = find_cloudflared()
        if not cloudflared_bin:
            print("\n[!] Aviso: cloudflared não foi encontrado no sistema.")
            print("    Instale com: winget install --id Cloudflare.cloudflared")
        else:
            print("[+] Abrindo túnel Cloudflare seguro (HTTPS + WebSockets)...")
            tunnel_proc = subprocess.Popen(
                [cloudflared_bin, "tunnel", "--url", "http://localhost:8000"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace"
            )

            # Thread para ler a saída do cloudflared e capturar o link https
            def monitor_tunnel():
                nonlocal public_url
                url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
                for line in tunnel_proc.stdout:
                    match = url_pattern.search(line)
                    if match and not public_url:
                        public_url = match.group(0)
                        print("\n" + "=" * 65)
                        print(" 🌟 SERVIDOR RESENHA PÚBLICO DISPONÍVEL!")
                        print(" Endereço para colar no seu Resenha Client:")
                        print(f" 👉 {public_url} 👈")
                        print("=" * 65 + "\n")

            t = threading.Thread(target=monitor_tunnel, daemon=True)
            t.start()

    time.sleep(2)
    print("\n[OK] Servidor Resenha pronto:")
    print("  Local:    http://localhost:8000")
    print("  API Docs: http://localhost:8000/docs")
    print("\nPressione Ctrl+C para encerrar.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nEncerrando servidor Resenha...")
        backend_proc.terminate()
        if tunnel_proc:
            tunnel_proc.terminate()

if __name__ == "__main__":
    main()
