"""
Roda o teste ponta a ponta do servidor num banco temporário, sem tocar no resenha.db.

Uso (na pasta do servidor):
    .\\venv\\Scripts\\python.exe tests\\run_e2e.py

Sobe um SFU falso (tests/fake_cf.py, porta 8766) no lugar do Cloudflare Realtime e o
servidor na porta 8765 com banco e uploads numa pasta temporária; ao fim, derruba os dois.
"""
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable


def wait_for(url: str, timeout: float = 20) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception as exc:  # 404 do SFU falso também significa "no ar"
            if getattr(exc, "code", None):
                return True
            time.sleep(0.3)
    return False


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="resenha-e2e-") as tmp:
        db = Path(tmp) / "e2e.db"
        uploads = Path(tmp) / "uploads"
        # App web falso para testar como o servidor entrega a versão web
        web = Path(tmp) / "web"
        (web / "assets").mkdir(parents=True)
        (web / "index.html").write_text("<!doctype html><title>Resenha web</title>", encoding="utf-8")
        (web / "assets" / "app-123.js").write_text("console.log('resenha')", encoding="utf-8")
        env = {
            **os.environ,
            "DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}",
            "UPLOAD_DIR": str(uploads),
            "JWT_SECRET": "e2e",
            "CF_REALTIME_APP_ID": "teste",
            "CF_REALTIME_APP_TOKEN": "secret-token",
            "CF_REALTIME_API_BASE": "http://127.0.0.1:8766/v1",
            "VOICE_RECONNECT_GRACE_SECONDS": "2",
            "E2E_DB": str(db),
            "WEB_DIR": str(web),
            "WEB_AUTO_UPDATE": "0",
            "GITHUB_API_BASE": "http://127.0.0.1:8766/github",
            "RESEND_API_KEY": "re_teste",
            "RESEND_API_BASE": "http://127.0.0.1:8766/resend",
            "EMAIL_FROM": "Resenha <nao-responda@mail.resenha.example>",
            "PUBLIC_URL": "https://resenha.example",
            "WEB_RELEASES_REPO": "exemplo/resenha-releases",
            "PYTHONIOENCODING": "utf-8",
        }
        log = open(Path(tmp) / "server.log", "w", encoding="utf-8")
        fake = subprocess.Popen([PY, "-m", "uvicorn", "fake_cf:app", "--port", "8766"], cwd=ROOT / "tests", stdout=log, stderr=log)
        server = subprocess.Popen([PY, "-m", "uvicorn", "app.main:app", "--port", "8765"], cwd=ROOT, env=env, stdout=log, stderr=log)
        try:
            if not (wait_for("http://127.0.0.1:8766/") and wait_for("http://127.0.0.1:8765/")):
                print("Os servidores de teste não subiram. Veja se as portas 8765/8766 estão livres.")
                log.flush()
                print((Path(tmp) / "server.log").read_text(encoding="utf-8", errors="replace")[-3000:])
                return 1
            return subprocess.call([PY, str(ROOT / "tests" / "e2e_test.py")], env=env)
        finally:
            for proc in (server, fake):
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
            log.close()


if __name__ == "__main__":
    sys.exit(main())
