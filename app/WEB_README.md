# Web-версия с GigaChat

Браузерная версия «Текста по-человечески» с подключённой нейросетью GigaChat.
Ключ авторизации хранится **только на сервере**: в браузер он не передаётся,
в исходный код не вшит и в логи не пишется.

## Что добавлено

| Файл | Назначение |
|---|---|
| `server/gigachat.mjs` | OAuth GigaChat, кэш токена, запросы к чат-модели, сертификаты НУЦ Минцифры |
| `server/api.mjs` | HTTP-маршруты `/api/gigachat/*`, `/api/admin/*`, `/api/vk/callback` |
| `server/metrics.mjs` | учёт запросов и расхода токенов, сводка |
| `server/vk.mjs` | статистика сообщества ВК и Callback API |
| `server/admin.html` | страница админ-сводки `/admin` |
| `server/index.mjs` | web-сервер: раздаёт `dist/`, проксирует GigaChat и админ-API |
| `server/certs/*.pem` | корневой и промежуточный сертификаты Russian Trusted CA |
| `src/engines/gigachat.ts` | движок `GigaChatEngine` + `checkGigaChat()` для проверки подключения |
| `src/engines/index.ts` | фабрика движка: локально / GigaChat / OpenAI-совместимый |
| `.env.example` | шаблон настроек сервера (копируется в `.env`) |

## Куда добавить API-ключ

Ключ авторизации — строка Base64 из личного кабинета
[Sber Developers](https://developers.sber.ru/portal/products/gigachat-api)
(проект → «Ключи авторизации» → «Получить ключ»). Это **не** `sk-...`.

### Способ 1 — файл `app/.env` (рекомендуется)

1. В папке `app/` скопируйте шаблон:

   ```powershell
   cd C:\Users\sport\Yandex.Disk\int-coda-code\app
   copy .env.example .env
   ```

2. Откройте `app/.env` в любом редакторе и впишите ключ в строку:

   ```ini
   GIGACHAT_AUTH_KEY=вставьте_сюда_ключ_из_личного_кабинета
   ```

3. Сохраните файл. Больше ничего править не нужно — `GIGACHAT_SCOPE`
   (`GIGACHAT_API_PERS` для физлица) и модель `GigaChat-2` уже прописаны.

Файл `.env` добавлен в `.gitignore` и в репозиторий не попадёт.

### Способ 2 — переменная окружения

```powershell
$env:GIGACHAT_AUTH_KEY = "ваш-ключ"
npm run web
```

### Способ 3 — отдельный файл с ключом

По умолчанию сервер уже умеет читать `API/api.txt` (там сейчас лежит ключ).
Можно указать другой путь:

```ini
GIGACHAT_KEY_FILE=C:\путь\к\файлу\с\ключом.txt
```

**Порядок поиска:** `GIGACHAT_AUTH_KEY` → `GIGACHAT_KEY_FILE` → `API/api.txt`.

## Запуск

```powershell
cd C:\Users\sport\Yandex.Disk\int-coda-code\app

# разработка (Vite + прокси на том же порту)
npm run dev

# продакшн: собрать и поднять web-сервер
npm run web:build
```

Web-сервер: `http://127.0.0.1:4173` (порт меняется через `PORT`).

В консоли при старте видно статус — сам ключ не печатается:

```
  GigaChat: ключ найден (файл)
  Модель: GigaChat-2 · scope: GIGACHAT_API_PERS
  Сертификаты НУЦ Минцифры: подключены
```

## Проверка подключения

1. Откройте приложение → **Настройки** → «Облачный провайдер».
2. Убедитесь, что выбран **GigaChat**.
3. Нажмите **«Проверить подключение»**.

Зелёная плашка «Подключено» покажет источник ключа и список моделей.
Если ключ не найден — красная плашка с подсказкой, что делать.

## Как это работает

```
браузер ──POST /api/gigachat/chat──► web-сервер ──Bearer токен──► api.giga.chat
                                     (ключ здесь)
```

1. Браузер отправляет **уже маскированный** текст: числа, имена и ссылки
   заменены токенами `⟦Ч12⟧`, `⟦И1⟧` (гарантия неизменяемого).
2. Сервер получает `access_token` по OAuth (кэш 30 минут, автообновление)
   и вызывает `GigaChat-2`.
3. Ответ возвращается в браузер, токены восстанавливаются дословно.

Ключ авторизации существует только в памяти серверного процесса.

## Что нужно знать про TLS

`api.giga.chat` и OAuth-хост подписаны цепочкой **Russian Trusted Root CA**
(НУЦ Минцифры). Этого корня обычно нет в хранилище Windows, поэтому сервер
сам подкладывает сертификаты из `server/certs/` в стандартный набор Node —
системные настройки менять не нужно.

Если сертификаты нужно обновить, скачайте их заново:

- https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
- https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt

и положите в `server/certs/` под именами
`russian-trusted-root-ca.pem` и `russian-trusted-sub-ca.pem`.

## Настройки сервера (`.env`)

| Переменная | По умолчанию | Что задаёт |
|---|---|---|
| `GIGACHAT_AUTH_KEY` | — | ключ авторизации (Base64) |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` | версия API: `_PERS`, `_B2B`, `_CORP` |
| `GIGACHAT_MODEL` | `GigaChat-2` | модель по умолчанию |
| `GIGACHAT_OAUTH_URL` | `https://ngw.devices.sberbank.ru:9443/api/v2/oauth` | OAuth-эндпоинт |
| `GIGACHAT_API_BASE` | `https://api.giga.chat/v1` | базовый адрес API |
| `PORT` | `4173` | порт web-сервера |
| `HOST` | `127.0.0.1` | интерфейс прослушивания |
| `ADMIN_TOKEN` | — | токен доступа к `/admin` и `/api/admin/*` |
| `METRICS_FILE` | `app/data/metrics.json` | файл метрик использования |
| `ADMIN_EMAIL` | — | получатель уведомлений о регистрации аккаунтов |
| `USERS_FILE` | `app/data/users.json` | файл учётных записей |
| `NOTIFY_FILE` | `app/data/notifications.jsonl` | журнал уведомлений о регистрации |
| `VK_ACCESS_TOKEN` | — | токен сообщества ВКонтакте |
| `VK_GROUP_ID` | — | числовой id сообщества |
| `VK_GROUP_SCREEN` | — | короткое имя сообщества |
| `VK_CONFIRMATION_TOKEN` | — | строка подтверждения Callback API |
| `VK_SECRET` | — | секрет Callback API |

Доступные модели для переписывания: `GigaChat-2`, `GigaChat-2-Pro`,
`GigaChat-2-Max`, `GigaChat-3-Lightning`, `GigaChat-3-Pro`, `GigaChat-3-Ultra`.

## Админ-сводка и учёт токенов

Сервер пишет метрику после каждого запроса к GigaChat: модель, `prompt_tokens`,
`completion_tokens`, `total_tokens`, время ответа, успех или код ошибки и
**длину** отправленного текста в символах. Текст документа, промпты и ответы
модели не сохраняются; секреты в метрики не попадают.

Задать токен администратора:

```ini
ADMIN_TOKEN=длинная-случайная-строка
```

Сгенерировать:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Открыть `http://127.0.0.1:4173/admin` и ввести токен. Программно:

```powershell
curl -H "Authorization: Bearer <ADMIN_TOKEN>" "http://127.0.0.1:4173/api/admin/stats?days=7"
```

Период `days` — от 1 до 90. Без `ADMIN_TOKEN` эндпоинт отвечает 503, с неверным
токеном — 401. Файл метрик (`app/data/`) в git не попадает.

## Безопасность

- Ключ не входит в JS-бандл: проверено поиском по `dist/`.
- Ключ не пишется в логи сервера и не попадает в ответы `/api/gigachat/*`.
- `.env` в `.gitignore`; в репозитории только `.env.example`.
- В интерфейсе ключ не вводится — только статус «найден / не найден».
- Текст уходит в сеть только после подтверждения M1, и только маскированный.

## Ограничения

- По умолчанию прокси слушает `127.0.0.1` — это локальный запуск, не публичный
  сервер. Для публикации задайте `HOST=0.0.0.0` и поставьте HTTPS-прокси
  (см. `DEPLOY.md` в корне репозитория).
- Десктопная сборка Tauri (`npm run app:build`) пока использует старый
  путь к OpenAI-совместимому API: GigaChat в ней подключается только после
  переноса OAuth в Rust-команду (CORS и TLS из WebView).
- Веб-версия и Tauri используют один и тот же `localStorage` браузера
  или webview, но проекты между ними не синхронизируются.
- Аккаунтов и входа в приложении нет: проекты хранятся в `localStorage`.
- Метрики пишутся в один JSON-файл без блокировок: рассчитано на один процесс.
