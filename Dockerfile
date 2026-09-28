# Сборка фронтенда (React + Vite) и запуск сервера (Node + Express + node:sqlite).
# Один контейнер = и сайт, и API, и Telegram-бот.

# ---------- 1. Собираем веб-интерфейс ----------
FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 2. Рабочий образ ----------
FROM node:22-alpine
# tzdata нужен, чтобы работало московское время
RUN apk add --no-cache tzdata
ENV TZ=Europe/Moscow \
    NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/
COPY --from=web-build /app/web/dist ./web/dist

# База и файлы лежат в постоянном хранилище /data — оно переживает перезапуски
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "--no-warnings", "server/src/index.js"]
