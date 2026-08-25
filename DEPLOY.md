# Деплой на VPS

Репозиторий: [github.com/AspWinCode/gk_vmeste](https://github.com/AspWinCode/gk_vmeste)

## Этот сервер — общий (важно!)

На VPS уже работают чужие проекты (lesovik, moodle, skulpt, dog-assistant, ollama и др.), и порты 80/443 заняты **системным nginx**, который маршрутизирует их по доменам. Наш docker-compose **не трогает** ни системный nginx, ни его конфиги — фронтенд поднимается на отдельном порту (по умолчанию **8092**, см. `HTTP_PORT` в `.env`). Postgres/Redis из этого проекта не публикуются на хост вообще (доступны только внутри docker-сети), так что с чужими `postgres`/`redis`-контейнерами конфликтов нет.

Если позже понадобится нормальный домен — добавим **новый** файл в `/etc/nginx/sites-enabled/`, не трогая существующие (`lesovik`, `moodle`, `skulpt.win-code.online`, `squlpt.wincode-academy.ru`).

## Требования к серверу

- Docker + Docker Compose plugin (проверить: `docker compose version`; если нет — `curl -fsSL https://get.docker.com | sh`)
- Свободный порт (8092 по умолчанию, проверено — свободен на этом сервере)
- Диск/память на сервере: 62 ГБ свободно, 5.9 ГБ свободной RAM — более чем достаточно

## Первый деплой

```bash
git clone https://github.com/AspWinCode/gk_vmeste.git
cd gk_vmeste

cp .env.example .env
nano .env   # обязательно: ANTHROPIC_API_KEY, JWT_SECRET, POSTGRES_PASSWORD

docker compose -f docker-compose.prod.yml up -d --build
```

Первый запуск создаёт контейнеры, но база пустая — нужно накатить миграции и наполнить каталог ассистентов:

```bash
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec api npx tsx prisma/seed.ts
```

Открыть `http://<IP-сервера>:8092/login.html`, зарегистрировать первого пользователя.

## Обновление после изменений в репозитории

```bash
cd gk_vmeste
git pull
docker compose -f docker-compose.prod.yml up -d --build
# если менялась схема prisma/schema.prisma:
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy
```

## Проверка, что всё живо

```bash
docker compose -f docker-compose.prod.yml ps
curl http://localhost:8092/api/health   # {"status":"ok"}
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
```

## TLS / нормальный домен (по желанию, позже)

Сейчас сервис отвечает по обычному HTTP на порту 8092 — этого достаточно для проверки функциональности. Если решите повесить домен/поддомен, самый чистый вариант на этом сервере — **новый** vhost-файл в `/etc/nginx/sites-enabled/` (по образцу уже существующих под другие проекты), который проксирует на `127.0.0.1:8092`, плюс `certbot` для сертификата. Существующие конфиги других проектов при этом не трогаем.

## На что обратить внимание после деплоя

- **STT_PROVIDER=stub** в `.env` — расшифровка аудио в транскрибаторе пока заглушка (см. [backend/README.md](backend/README.md), раздел про `speechToText.ts`). Саммари/поручения из Claude при этом уже работают на реальном (хоть и заглушечном) тексте.
- **SMTP не заполнен** — рассылка протоколов встреч тихо пропускается (в логах `api` будет warning), само приложение не падает.
- **Циан/Авито** — доступны только через ручной сценарий (вставка ссылки/текста), см. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). `POST /api/land/objects/search-torgi` (открытые данные torgi.gov.ru) — первая реальная проверка в интернете будет именно на этом сервере, в песочнице разработки интернета не было.
- Файлы (аудио, экспортированные `.docx`) живут в docker-томе `vmeste_uploads` — переживают пересборку контейнеров, но не `docker compose down -v`.
