#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
#  Установка «МойДень» на чистый сервер Ubuntu 22.04 / 24.04 (REG.RU reg.cloud,
#  Timeweb VDS, любой другой VPS с root-доступом).
#
#  Запуск одной строкой (от root):
#     DOMAIN=example.ru EMAIL=you@mail.ru bash <(curl -fsSL \
#       https://raw.githubusercontent.com/silovr709-dotcom/CRM/main/deploy/install.sh)
#
#  Скрипт можно запускать повторно: он не ломает уже настроенное и не трогает
#  базу данных. По сути это «установить» и «обновить» в одном флаконе.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN="${DOMAIN:-}"                    # например myday.ru (без http://)
EMAIL="${EMAIL:-}"                      # почта для бесплатного SSL Let's Encrypt
REPO="${REPO:-https://github.com/silovr709-dotcom/CRM.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/myday}"        # код приложения
DATA_DIR="${DATA_DIR:-/var/lib/myday}"  # база, файлы, резервные копии — ТОЛЬКО тут
ENV_FILE="/etc/myday.env"
SERVICE="myday"
PORT="${PORT:-3000}"
TZ_NAME="${TZ_NAME:-Europe/Moscow}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Запустите от имени root (в веб-консоли сервера вы уже root)."

# ── 1. Системные пакеты ───────────────────────────────────────────────────────
say "Обновляю список пакетов и ставлю необходимое"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git nginx ufw tzdata >/dev/null
timedatectl set-timezone "$TZ_NAME" 2>/dev/null || true
ok "Пакеты на месте, часовой пояс: $TZ_NAME"

# ── 2. Node.js 22 (нужен для встроенной базы node:sqlite) ─────────────────────
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 22 ] 2>/dev/null && need_node=0
fi
if [ "$need_node" = "1" ]; then
  say "Ставлю Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_BIN="$(command -v node)"
ok "Node.js $(node -v) ($NODE_BIN)"

# ── 3. Подкачка (на сервере с 1 ГБ памяти сборка интерфейса без неё падает) ───
mem_mb="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$mem_mb" -lt 1800 ] && ! swapon --show | grep -q .; then
  say "Памяти мало (${mem_mb} МБ) — добавляю файл подкачки 2 ГБ"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Подкачка включена"
fi

# ── 4. Пользователь и папки ───────────────────────────────────────────────────
id -u myday >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin myday
mkdir -p "$APP_DIR" "$DATA_DIR"

# ── 5. Код приложения ─────────────────────────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  say "Обновляю код до свежей версии ветки $BRANCH"
  git -C "$APP_DIR" remote set-url origin "$REPO"
  git -C "$APP_DIR" fetch --depth=1 origin "$BRANCH" -q
  git -C "$APP_DIR" reset --hard "origin/$BRANCH" -q
else
  say "Скачиваю код из GitHub ($BRANCH)"
  rm -rf "$APP_DIR"
  git clone --depth=1 -b "$BRANCH" "$REPO" "$APP_DIR" -q \
    || die "Не удалось скачать код. Проверьте, что репозиторий публичный: $REPO"
fi
ok "Код в $APP_DIR ($(git -C "$APP_DIR" rev-parse --short HEAD))"

# ── 6. Сборка ─────────────────────────────────────────────────────────────────
say "Собираю веб-интерфейс (1–3 минуты)"
cd "$APP_DIR/web"
npm ci --no-audit --no-fund --silent
npm run build --silent
ok "Интерфейс собран"

say "Ставлю зависимости сервера"
cd "$APP_DIR/server"
npm ci --omit=dev --no-audit --no-fund --silent
ok "Сервер готов"

# ── 7. Настройки (пароль администратора создаётся один раз) ───────────────────
if [ ! -f "$ENV_FILE" ]; then
  # Пароль генерируем через node: никаких конвейеров, которые при set -o pipefail
  # могут завершиться с SIGPIPE и уронить установку.
  ADMIN_PASSWORD="$("$NODE_BIN" -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64').replace(/[^A-Za-z2-9]/g,'').slice(0,12))")"
  say "Создаю файл настроек $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
# Настройки «МойДень». Файл виден только root — в GitHub он НЕ попадает.
NODE_ENV=production
PORT=$PORT
TZ=$TZ_NAME
DATA_DIR=$DATA_DIR

# Администратор создаётся при первом запуске. Пароль смените в приложении.
ADMIN_LOGIN=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_MUST_CHANGE=1

# Резервные копии базы на диске сервера
BACKUP_EVERY_HOURS=24
BACKUP_KEEP=14

# Облачное хранилище S3 — на этом сервере не нужно: база лежит на диске.
# Если захотите дублировать базу в облако, заполните четыре строки ниже.
#S3_BUCKET=
#S3_ENDPOINT=https://s3.twcstorage.ru
#S3_ACCESS_KEY=
#S3_SECRET_KEY=
EOF
  chmod 600 "$ENV_FILE"
  cat > /root/myday-admin.txt <<TXT
Логин: admin
Пароль: $ADMIN_PASSWORD
Адрес: ${DOMAIN:+https://$DOMAIN}
TXT
  chmod 600 /root/myday-admin.txt
  ok "Пароль администратора сохранён в /root/myday-admin.txt"
else
  ok "Файл настроек уже есть — пароль и данные не трогаю"
fi

chown -R myday:myday "$DATA_DIR"
chown -R root:root "$APP_DIR"

# ── 8. Служба systemd: приложение работает всегда и само поднимается ──────────
say "Настраиваю автозапуск"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=МойДень — CRM и органайзер
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=myday
Group=myday
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN --no-warnings src/index.js
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=30
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable $SERVICE >/dev/null 2>&1
systemctl restart $SERVICE
sleep 3
systemctl is-active --quiet $SERVICE || { journalctl -u $SERVICE -n 30 --no-pager; die "Служба не запустилась (лог выше)"; }
ok "Служба $SERVICE работает"

# ── 9. Nginx: принимает запросы из интернета и отдаёт их приложению ───────────
say "Настраиваю веб-сервер"
server_name="${DOMAIN:-_}"
[ -n "$DOMAIN" ] && server_name="$DOMAIN www.$DOMAIN"
cat > /etc/nginx/sites-available/$SERVICE <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $server_name;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/$SERVICE /etc/nginx/sites-enabled/$SERVICE
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || die "Ошибка в настройках nginx"
systemctl reload nginx
ok "Веб-сервер настроен"

# ── 10. Фаервол ───────────────────────────────────────────────────────────────
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true
ok "Открыты только нужные порты (22, 80, 443)"

# ── 11. Бесплатный SSL (https) ────────────────────────────────────────────────
if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  say "Получаю бесплатный сертификат для https://$DOMAIN"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos \
       -m "$EMAIL" --redirect >/tmp/certbot.log 2>&1; then
    ok "Сертификат выпущен, сайт работает по https"
  elif certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
       -m "$EMAIL" --redirect >>/tmp/certbot.log 2>&1; then
    ok "Сертификат выпущен для $DOMAIN (без www)"
  else
    warn "Сертификат пока не выпущен — чаще всего это значит, что домен ещё не"
    warn "указывает на этот сервер. Подождите 15–60 минут и выполните:"
    warn "  certbot --nginx -d $DOMAIN -d www.$DOMAIN -m $EMAIL --agree-tos --redirect"
    warn "Подробности: /tmp/certbot.log"
  fi
else
  warn "DOMAIN или EMAIL не заданы — пропустил выпуск https-сертификата"
fi

# ── 12. Проверка ──────────────────────────────────────────────────────────────
say "Проверяю, что приложение отвечает"
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then ok "Проверка пройдена"
else die "Приложение не отвечает: journalctl -u $SERVICE -n 50 --no-pager"; fi

ip="$(hostname -I | awk '{print $1}')"
if [ -n "$DOMAIN" ]; then ADDR="https://$DOMAIN"; else ADDR="http://$ip"; fi
cat <<EOF

┌──────────────────────────────────────────────────────────────┐
│  Готово. «МойДень» работает.                                 │
└──────────────────────────────────────────────────────────────┘

  Адрес:   $ADDR
  Логин:   admin
  Пароль:  смотрите в файле /root/myday-admin.txt
           (показать: cat /root/myday-admin.txt)

  База и все файлы:     $DATA_DIR
  Резервные копии:      $DATA_DIR/backups (автоматически раз в сутки)

  Полезные команды:
    systemctl status myday          — работает ли приложение
    systemctl restart myday         — перезапустить
    journalctl -u myday -n 50       — последние строки журнала
    bash $APP_DIR/deploy/update.sh  — обновить до свежей версии

EOF
