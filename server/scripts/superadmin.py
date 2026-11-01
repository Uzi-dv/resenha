"""
Dá ou tira o super admin de uma conta (moderação em todo o Resenha: tirar da call,
encerrar sessões, suspender contas, renomear e excluir servidores).

Uso (na pasta do servidor):
    .\\venv\\Scripts\\python.exe scripts\\superadmin.py SeuNome             dá o super admin
    .\\venv\\Scripts\\python.exe scripts\\superadmin.py SeuNome --remover   tira
    .\\venv\\Scripts\\python.exe scripts\\superadmin.py --listar            mostra quem tem

Pode rodar com o servidor ligado; reinicie-o em seguida para valer na hora
(ex.: nssm restart ResenhaServer). A pessoa precisa reabrir o app para ver o painel.
"""
import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser(description="Gerencia o super admin do Resenha.")
    parser.add_argument("username", nargs="?", help="nome de usuário (como aparece no app)")
    parser.add_argument("--remover", action="store_true", help="tira o super admin em vez de dar")
    parser.add_argument("--listar", action="store_true", help="lista quem é super admin")
    parser.add_argument("--banco", default=str(ROOT / "resenha.db"), help=argparse.SUPPRESS)  # testes
    args = parser.parse_args()

    db_path = Path(args.banco)
    if not db_path.exists():
        print(f"Banco não encontrado em {db_path}")
        return 1
    con = sqlite3.connect(db_path)
    columns = {row[1] for row in con.execute("PRAGMA table_info(users)")}
    if "is_superadmin" not in columns:
        print("O banco ainda não tem a coluna de super admin: inicie o servidor 2.6.0 uma vez e rode de novo.")
        return 1

    if args.listar or not args.username:
        rows = con.execute("SELECT id, username FROM users WHERE is_superadmin = 1 ORDER BY id").fetchall()
        print("Super admins:", ", ".join(f"{name} (id {uid})" for uid, name in rows) if rows else "nenhum")
        return 0

    row = con.execute("SELECT id, username FROM users WHERE lower(username) = lower(?)", (args.username,)).fetchone()
    if not row:
        print(f'Usuário "{args.username}" não encontrado.')
        return 1
    con.execute("UPDATE users SET is_superadmin = ? WHERE id = ?", (0 if args.remover else 1, row[0]))
    con.commit()
    con.close()
    action = "não é mais" if args.remover else "agora é"
    print(f"{row[1]} (id {row[0]}) {action} super admin. Reinicie o servidor para valer na hora.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
