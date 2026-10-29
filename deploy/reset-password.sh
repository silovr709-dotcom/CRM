#!/usr/bin/env bash
# Аварийный сброс пароля пользователя — если забыли пароль администратора.
#
# Запуск на сервере от root:
#     bash /opt/myday/deploy/reset-password.sh admin
#     bash /opt/myday/deploy/reset-password.sh admin МойНовыйПароль123
#
# Если пароль не указан — скрипт придумает его сам и напечатает.
# При следующем входе система попросит сменить пароль на свой.
set -euo pipefail

LOGIN="${1:-admin}"
NEWPASS="${2:-}"
DATA_DIR="${DATA_DIR:-/var/lib/myday}"
DB="$DATA_DIR/organizer.db"
SERVICE="myday"

[ "$(id -u)" = "0" ] || { echo "Запустите от имени root." >&2; exit 1; }
[ -f "$DB" ] || { echo "База не найдена: $DB" >&2; exit 1; }

NODE_BIN="$(command -v node || echo /usr/bin/node)"
[ -n "$NEWPASS" ] || NEWPASS="$("$NODE_BIN" -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64').replace(/[^A-Za-z2-9]/g,'').slice(0,12))")"

"$NODE_BIN" --no-warnings -e '
const { DatabaseSync } = require("node:sqlite");
const { randomBytes, scryptSync } = require("node:crypto");
const [dbPath, login, password] = process.argv.slice(1);
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id, login FROM users WHERE login = ?").get(login);
if (!user) {
  const all = db.prepare("SELECT login FROM users").all().map(u => u.login).join(", ");
  console.error(`Пользователя «${login}» нет. Есть такие: ${all || "(ни одного)"}`);
  process.exit(1);
}
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(String(password), salt, 64).toString("hex");
db.prepare("UPDATE users SET pass_salt = ?, pass_hash = ?, must_change_password = 1, active = 1 WHERE id = ?")
  .run(salt, hash, user.id);
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
console.log("ok");
' "$DB" "$LOGIN" "$NEWPASS" >/dev/null

chown myday:myday "$DB" 2>/dev/null || true
systemctl is-active --quiet "$SERVICE" && systemctl restart "$SERVICE" || true

cat <<EOF

Пароль обновлён.

  Логин:  $LOGIN
  Пароль: $NEWPASS

Войдите с ним на сайте — система сразу попросит задать свой пароль.
Все прежние входы этого пользователя на телефонах сброшены.

EOF
