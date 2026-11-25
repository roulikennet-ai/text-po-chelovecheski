# Деплой на сервер

Документ описывает, как поднять «Текст по-человечески» на сервере и получить
публичную ссылку. Проверено локально: прод-сборка (`npm run web:build`),
админ-сводка, VK-эндпоинты. **Не проверено**: реальная публикация (нет доступа
к серверу и домену), сборка Docker-образа (Docker на машине не установлен),
реальный VK API (нет токена сообщества).

## Что нужно

- VPS или любой хостинг с Docker (или Node.js 20+ без Docker).
- Домен и DNS (для HTTPS-ссылки) — рекомендуется, но не обязателен.
- Ключ GigaChat, `ADMIN_TOKEN` (придумать самому), опционально токен ВК.

## Вариант 1. Docker Compose (рекомендуется)

На сервере:

```bash
git clone <репозиторий> tph && cd tph
cp .env.deploy.example .env.deploy
nano .env.deploy          # вписать GIGACHAT_AUTH_KEY, ADMIN_TOKEN, VK_*
docker compose --env-file .env.deploy up -d --build
```

Проверка:

```bash
curl -s http://127.0.0.1:4173/api/gigachat/status
```

Приложение: `http://<IP-сервера>:4173`
Админ-сводка: `http://<IP-сервера>:4173/admin` (нужен `ADMIN_TOKEN`).

Метрики лежат в томе `tph-data`, переживают перезапуск и пересборку.

## Вариант 2. Без Docker (Node.js 20+)

```bash
cd app
npm ci
npm run build
GIGACHAT_AUTH_KEY=... ADMIN_TOKEN=... HOST=0.0.0.0 PORT=4173 node server/index.mjs
```

Для постоянной работы — systemd или pm2:

```ini
# /etc/systemd/system/tph.service
[Unit]
Description=Text by Human
After=network.target

[Service]
WorkingDirectory=/opt/tph/app
EnvironmentFile=/opt/tph/.env
Environment=HOST=0.0.0.0
Environment=PORT=4173
ExecStart=/usr/bin/node server/index.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now tph
```

## HTTPS и домен

Сервер слушает обычный HTTP. Для публичной ссылки поставьте перед ним
обратный прокси с TLS — Caddy проще всего:

```
# /etc/caddy/Caddyfile
tph.example.ru {
    reverse_proxy 127.0.0.1:4173
}
```

Caddy сам получит сертификат Let's Encrypt. Аналогично работает nginx + certbot.

> **Важно про локальные GGUF-модели.** Для многопоточности wllama нужны
> заголовки `Cross-Origin-Opener-Policy` и `Cross-Origin-Embedder-Policy`.
> Сервер их уже отдаёт. Если ставите свой прокси — пробрасывайте их как есть,
> иначе модель загрузится, но в один поток.

## Переменные окружения

| Переменная | Обязательна | Что задаёт |
|---|---|---|
| `GIGACHAT_AUTH_KEY` | да (для облака) | ключ авторизации GigaChat (Base64) |
| `ADMIN_TOKEN` | да (для сводки) | токен доступа к `/admin` и `/api/admin/*` |
| `PORT` | нет | порт (по умолчанию 4173) |
| `HOST` | нет | интерфейс; на сервере `0.0.0.0` |
| `METRICS_FILE` | нет | путь к файлу метрик |
| `ADMIN_EMAIL` | нет | получатель уведомлений о регистрации аккаунтов |
| `USERS_FILE` | нет | путь к файлу аккаунтов (по умолчанию `app/data/users.json`) |
| `NOTIFY_FILE` | нет | путь к журналу уведомлений (по умолчанию `app/data/notifications.jsonl`) |
| `GIGACHAT_MODEL` | нет | модель по умолчанию |
| `GIGACHAT_SCOPE` | нет | `GIGACHAT_API_PERS` / `_B2B` / `_CORP` |
| `VK_ACCESS_TOKEN` | нет | токен сообщества ВК |
| `VK_GROUP_ID` | нет | числовой id сообщества |
| `VK_GROUP_SCREEN` | нет | короткое имя сообщества |
| `VK_CONFIRMATION_TOKEN` | нет | подтверждение Callback API |
| `VK_SECRET` | нет | секрет Callback API |

Сгенерировать `ADMIN_TOKEN`:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

## Учёт запросов и расхода токенов

Каждый запрос к GigaChat пишет запись в `app/data/metrics.json`:

- модель, `prompt_tokens`, `completion_tokens`, `total_tokens`;
- время ответа, успех/ошибка и код ошибки;
- **длина** отправленного текста в символах.

Сам текст документа, промпты и ответы модели **не сохраняются**. Секреты в
метрики не попадают.

Сводка доступна на `/admin` (вводится `ADMIN_TOKEN`) или программно:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" "http://127.0.0.1:4173/api/admin/stats?days=7"
```

Период: `days` от 1 до 90. В ответе — всего запросов, успешных, с ошибками,
сумма токенов, разбивка по моделям и последние 20 запросов.

## Подключение сообщества ВКонтакте

1. В сообществе: **Управление → Настройки → API для партнёров**, создать
   токен с правами `groups` и `stats`.
2. Узнать числовой id сообщества (в адресе `vk.com/club123456789` → `123456789`).
3. Вписать `VK_ACCESS_TOKEN`, `VK_GROUP_ID`, `VK_GROUP_SCREEN` в конфиг.
4. **Callback API** (приём событий): в настройках сообщества → Callback API:
   - адрес: `https://<домен>/api/vk/callback`
   - строку подтверждения сохранить в `VK_CONFIRMATION_TOKEN`
   - секретный ключ сохранить в `VK_SECRET`
5. Проверить в админке: блок «Сообщество ВКонтакте» покажет подписчиков,
   просмотры и охват за неделю.

Без токена ВК-блок в админке пишет «Не подключено» — приложение работает
как обычно.
