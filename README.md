# Assistant

Платформа «личный помощник + команда + рабочие утилиты». Полное техническое задание — в [SPEC.md](SPEC.md), текущий прогресс — в [STATUS.md](STATUS.md).

## Что нужно установить на компьютер

1. **Node.js 22** (или новее) — https://nodejs.org (кнопка «LTS»).
2. **Docker Desktop** — https://www.docker.com/products/docker-desktop (нужен, чтобы запустить базу данных одной командой).
3. **Git** — https://git-scm.com.

## Первый запуск (пошагово)

Все команды вводятся в терминале, в папке проекта.

1. Скачать проект:
   ```
   git clone https://github.com/Javlonbek12/Javlonbek.git
   cd Javlonbek
   ```
2. Создать файл настроек из образца:
   ```
   cp .env.example .env
   ```
   Для локального запуска ничего менять не нужно.
3. Установить зависимости (займёт пару минут):
   ```
   npm install
   ```
4. Запустить базу данных (Docker Desktop должен быть открыт):
   ```
   docker compose up -d
   ```
5. Применить миграции и тестовые данные:
   ```
   npm run db:migrate
   npm run db:seed
   ```
6. Запустить приложение:
   ```
   npm run dev
   ```
   Открыть в браузере http://localhost:3000 — должна появиться страница «Assistant».

Остановить приложение: `Ctrl + C` в терминале. Остановить базу: `docker compose down` (данные сохраняются).

## Полезные команды

| Команда | Что делает |
|---|---|
| `npm run dev` | Запуск в режиме разработки (http://localhost:3000) |
| `npm run build` / `npm start` | Сборка и запуск «боевой» версии |
| `npm test` | Все тесты (нужна запущенная база) |
| `npm run lint` | Проверка кода и форматирования |
| `npm run format` | Автоматически исправить форматирование |
| `npm run typecheck` | Проверка типов TypeScript |
| `npm run db:migrate` | Применить изменения схемы базы данных |
| `npm run db:seed` | Заполнить базу тестовыми данными |
| `http://localhost:3000/api/health` | Проверка, что приложение и база работают |

## Структура проекта

```
app/          страницы и API (Next.js)
components/   общие UI-компоненты (shadcn/ui)
lib/          общие утилиты: i18n (тексты интерфейса), env, подключение к базе
modules/      модули платформы (появятся с этапа 1)
prisma/       схема базы данных, миграции, тестовые данные
docs/         решения (DECISIONS.md), описание планограмм и др.
public/       иконки, service worker
```

## Проверки на GitHub

При каждом push GitHub Actions автоматически запускает lint, typecheck, тесты и сборку (файл `.github/workflows/ci.yml`). Результат виден на вкладке **Actions** репозитория.
