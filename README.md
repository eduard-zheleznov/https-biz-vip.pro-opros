# Конструктор опросов 2.0

Monolith на `Next.js App Router + TypeScript + Prisma + PostgreSQL` для:

- конструктора опросов с версиями и откатом,
- ролей `admin/member`,
- публичного прохождения по ссылке,
- результатов, фильтров и экспорта XLSX,
- Telegram-уведомлений,
- AI-анализа результата через OpenAI Responses API,
- архива с автоочисткой через 30 дней.

## Что уже реализовано

- bootstrap администратора по env,
- инвайт участника по ссылке,
- кастомная админка с dashboard, builder, настройками, участниками и профилем,
- drag-and-drop блоков конструктора,
- медиа-ответы с загрузкой файлов в локальное хранилище,
- публикация, архив, восстановление, история версий и rollback,
- публичный runtime с таймером, branching и частичным сохранением,
- фоновые задания на `pg-boss` для Telegram/AI и очистки архива.

## Быстрый старт

1. Создайте PostgreSQL и задайте переменные из `.env.example`.
2. Скопируйте `.env.example` в `.env` и проверьте значения.
3. Установите зависимости:

```bash
npm install
```

4. Примените миграции и seed:

```bash
npm run db:migrate
npm run db:seed
```

5. Запустите web и worker:

```bash
npm run dev:all
```

Если нужен только frontend/API без воркера:

```bash
npm run dev
```

## Основные переменные

- `DATABASE_URL`: PostgreSQL connection string.
- `SESSION_SECRET`: секрет для cookie-сессий.
- `DEFAULT_ADMIN_EMAIL`: по умолчанию `info@biz-vip.ru`.
- `DEFAULT_ADMIN_PASSWORD`: по умолчанию `12345678`.
- `DEFAULT_MEMBER_PASSWORD`: по умолчанию `12345678`.
- `TELEGRAM_BOT_TOKEN`: токен бота для уведомлений.
- `OPENAI_API_KEY`: ключ OpenAI.
- `OPENAI_MODEL`: модель для AI-анализа, например `gpt-5.2`.

## Команды

```bash
npm run dev
npm run dev:worker
npm run dev:all
npm run build
npm run db:generate
npm run db:migrate
npm run db:push
npm run db:seed
npm run test
```

## Структура

- `src/app` — страницы, layout-ы и route handlers.
- `src/components` — UI и прикладные клиентские компоненты.
- `src/lib` — auth, доменная логика, storage, integrations, jobs.
- `prisma/schema.prisma` — основная схема Prisma.
- `prisma/migrations` — начальная SQL-миграция.

## Примечания по окружению

- В текущем рабочем окружении Docker отсутствовал, поэтому миграция добавлена в репозиторий вручную как `init` SQL для Postgres.
- Для локального запуска с Docker в проекте уже подготовлен `docker-compose.yml`, но сам Docker должен быть установлен на машине отдельно.
