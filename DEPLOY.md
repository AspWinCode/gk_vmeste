# Деплой на VPS

Репозиторий: [github.com/AspWinCode/gk_vmeste](https://github.com/AspWinCode/gk_vmeste)

## Требования к серверу

- Ubuntu 22.04+ (или любой дистрибутив с Docker)
- Docker + Docker Compose plugin: `curl -fsSL https://get.docker.com | sh`
- Открытый порт 80 (443, если добавите TLS — см. ниже)
- Минимум 2 ГБ RAM

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

Открыть `http://<IP-сервера>/login.html`, зарегистрировать первого пользователя.

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
curl http://localhost/api/health   # {"status":"ok"}
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
```

## TLS (домен + HTTPS)

Проще всего — Caddy или certbot перед nginx-контейнером, либо заменить `nginx/default.conf` + добавить том с сертификатами. В этом репозитории TLS не настроен — по умолчанию сервис отвечает по HTTP на порту 80. Если есть домен, скажите — донастрою.

## На что обратить внимание после деплоя

- **STT_PROVIDER=stub** в `.env` — расшифровка аудио в транскрибаторе пока заглушка (см. [backend/README.md](backend/README.md), раздел про `speechToText.ts`). Саммари/поручения из Claude при этом уже работают на реальном (хоть и заглушечном) тексте.
- **SMTP не заполнен** — рассылка протоколов встреч тихо пропускается (в логах `api` будет warning), само приложение не падает.
- **Циан/Авито** — доступны только через ручной сценарий (вставка ссылки/текста), см. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). `POST /api/land/objects/search-torgi` (открытые данные torgi.gov.ru) — первая реальная проверка в интернете будет именно на этом сервере, в песочнице разработки интернета не было.
- Файлы (аудио, экспортированные `.docx`) живут в docker-томе `vmeste_uploads` — переживают пересборку контейнеров, но не `docker compose down -v`.
