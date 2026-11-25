# ============================================================================
# Dockerfile — многоэтапная сборка «Текст по-человечески»
#
# ВАЖНО: файл лежит в корне репозитория. Сборка идёт из корня:
#   docker build -t tph:latest .
#
# Запуск:
#   docker run -p 4173:4173 \
#     -e GIGACHAT_AUTH_KEY=... \
#     -e ADMIN_TOKEN=... \
#     -e VK_ACCESS_TOKEN=... -e VK_GROUP_ID=... \
#     -v tph-data:/app/app/data \
#     tph:latest
# ============================================================================

# ---- Этап 1: сборка фронтенда ----
FROM node:20-alpine AS build

WORKDIR /repo

COPY app/package.json app/package-lock.json ./
RUN npm ci --no-fund --no-audit

COPY app/tsconfig.json app/vite.config.ts app/index.html ./
COPY app/src ./src
COPY app/public ./public
COPY app/server ./server

RUN npm run build

# ---- Этап 2: рабочий образ ----
FROM node:20-alpine

WORKDIR /app

# Зависимости нужны только серверу (node:* + fetch), но ставим prod-набор
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && npm cache clean --force

COPY --from=build /repo/dist ./dist
COPY app/server ./server

# Каталог метрик: пишется только владельцем процесса
RUN mkdir -p /app/data && chmod 700 /app/data

# Слушаем все интерфейсы внутри контейнера
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4173/api/gigachat/status >/dev/null 2>&1 || exit 1

CMD ["node", "server/index.mjs"]
