#!/usr/bin/env bash
# Обновление «МойДень» до свежей версии из GitHub.
# Запуск на сервере от root:   bash /opt/myday/deploy/update.sh
# База данных и файлы НЕ ТРОГАЮТСЯ — они лежат отдельно, в /var/lib/myday.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/myday}"
BRANCH="${BRANCH:-main}"
SERVICE="myday"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Запустите от имени root."
[ -d "$APP_DIR/.git" ] || die "Приложение не найдено в $APP_DIR. Сначала установите его (install.sh)."

DATA_DIR="${DATA_DIR:-/var/lib/myday}"

say "Делаю резервную копию базы перед обновлением"
if [ -f "$DATA_DIR/organizer.db" ]; then
  stamp="$(date +%Y-%m-%d-%H%M)"
  mkdir -p "$DATA_DIR/backups"
  sudo -u myday "$(command -v node || echo /usr/bin/node)" --no-warnings -e "
    const {DatabaseSync} = require('node:sqlite');
    const db = new DatabaseSync('$DATA_DIR/organizer.db');
    db.exec(\"VACUUM INTO '$DATA_DIR/backups/organizer-before-update-$stamp.db'\");
  " && ok "Копия: $DATA_DIR/backups/organizer-before-update-$stamp.db" \
    || ok "База ещё пустая — копировать нечего"
else
  ok "База ещё не создана"
fi

say "Скачиваю свежую версию ($BRANCH)"
git -C "$APP_DIR" fetch --depth=1 origin "$BRANCH" -q
before="$(git -C "$APP_DIR" rev-parse --short HEAD)"
git -C "$APP_DIR" reset --hard "origin/$BRANCH" -q
after="$(git -C "$APP_DIR" rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then ok "У вас уже самая свежая версия ($after)"; else ok "$before → $after"; fi

say "Пересобираю интерфейс"
cd "$APP_DIR/web" && npm ci --no-audit --no-fund --silent && npm run build --silent
ok "Готово"

say "Обновляю зависимости сервера"
cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund --silent
ok "Готово"

say "Перезапускаю приложение"
systemctl restart $SERVICE
sleep 3
systemctl is-active --quiet $SERVICE || { journalctl -u $SERVICE -n 30 --no-pager; die "Не запустилось"; }
curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null || die "Приложение не отвечает"
ok "Обновление завершено, всё работает"

printf '\n\033[1;33mНа телефоне: закройте приложение и откройте заново — новая версия подтянется сама.\033[0m\n\n'
