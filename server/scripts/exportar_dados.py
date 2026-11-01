"""
Empacota os dados do servidor Resenha para migrar para outra máquina.

Uso (na pasta do servidor, com o servidor DESLIGADO para não perder mensagens novas):
    .\\venv\\Scripts\\python.exe scripts\\exportar_dados.py

Gera migracao/resenha-dados-AAAAMMDD-HHMMSS.zip com:
    resenha.db    cópia consistente do banco (API de backup do SQLite, inclui o WAL)
    uploads/      fotos de perfil, banners e imagens enviadas
    .env          chaves do Cloudflare Realtime (SEGREDO)
    .jwt_secret   segredo dos logins (mantém todo mundo logado na máquina nova) (SEGREDO)

Backup periódico (pode rodar com o servidor ligado), mantendo só os 14 pacotes mais recentes:
    .\\venv\\Scripts\\python.exe scripts\\exportar_dados.py --manter 14

O zip contém segredos: não envie por chat público nem commite no git.
Na máquina nova: extraia o conteúdo na raiz da pasta do servidor.
"""
import argparse
import sqlite3
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser(description="Empacota os dados do servidor Resenha.")
    parser.add_argument("--manter", type=int, default=0, metavar="N",
                        help="apaga pacotes antigos em migracao/, mantendo só os N mais recentes (backup periódico)")
    args = parser.parse_args()

    db_path = ROOT / "resenha.db"
    if not db_path.exists():
        print(f"Banco não encontrado em {db_path}")
        return 1

    out_dir = ROOT / "migracao"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"resenha-dados-{datetime.now():%Y%m%d-%H%M%S}.zip"

    with tempfile.TemporaryDirectory() as tmp:
        snapshot = Path(tmp) / "resenha.db"
        src = sqlite3.connect(db_path)
        dst = sqlite3.connect(snapshot)
        src.backup(dst)  # cópia consistente mesmo com o WAL ativo
        dst.execute("PRAGMA journal_mode=DELETE")  # arquivo único, sem -wal/-shm
        users = dst.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        messages = dst.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        dst.close()
        src.close()

        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(snapshot, "resenha.db")
            uploads = ROOT / "uploads"
            n_uploads = 0
            if uploads.exists():
                for f in uploads.rglob("*"):
                    if f.is_file():
                        z.write(f, f.relative_to(ROOT).as_posix())
                        n_uploads += 1
            missing = []
            for secret in (".env", ".jwt_secret"):
                if (ROOT / secret).exists():
                    z.write(ROOT / secret, secret)
                else:
                    missing.append(secret)

    print(f"Pacote criado: {out}")
    print(f"  {users} usuário(s), {messages} mensagem(ns), {n_uploads} arquivo(s) em uploads/")
    if missing:
        print(f"  ATENÇÃO: não encontrados: {', '.join(missing)}")
    print("  Contém segredos (.env, .jwt_secret): transfira por pendrive/rede local, não por chat público.")
    if args.manter > 0:
        old = sorted(out_dir.glob("resenha-dados-*.zip"))[:-args.manter]
        for f in old:
            f.unlink()
        if old:
            print(f"  {len(old)} pacote(s) antigo(s) removido(s); mantidos os {args.manter} mais recentes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
