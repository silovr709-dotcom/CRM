# Сборка фронтенда (React + Vite) и запуск сервера (Node + Express + node:sqlite).
# Один контейнер = и сайт, и API, и Telegram-бот.

# ---------- 1. Собираем веб-интерфейс ----------
FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 2. Зависимости сервера (только production) ----------
FROM node:22-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---------- 3. Рабочий образ ----------
FROM node:22-alpine
# tzdata — чтобы работало московское время, curl — для проверки состояния
RUN apk add --no-cache tzdata curl
ENV TZ=Europe/Moscow \
    NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY --from=web-build /app/web/dist ./web/dist

# База и файлы лежат в постоянном хранилище /data — оно переживает перезапуски
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

# Работаем не от root — так безопаснее
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "--no-warnings", "server/src/index.js"]
