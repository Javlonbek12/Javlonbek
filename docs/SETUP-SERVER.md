# Установка Assistant на сервер (VPS)

Инструкция для человека без опыта администрирования. Всё делается копированием команд.
Время: примерно 30 минут.

Что получится: приложение на вашем домене с HTTPS, Telegram-бот, напоминания, распознавание
голоса, ежедневные резервные копии и уведомление вам в Telegram, если что-то сломалось.

Есть два способа:

- **Способ 1 — автоматически через GitHub (рекомендуется).** Вы один раз создаёте ключ на сервере
  и вписываете секреты на GitHub, дальше установку запускает кнопка (или Claude по вашей просьбе).
- **Способ 2 — вручную**, командами на сервере (разделы 0–12 ниже).

---

## Способ 1. Автоматическая установка через GitHub

GitHub заходит на сервер по ключу, который хранится в секретах репозитория (его никто не видит,
даже в журналах), и выполняет установку. Процедура — `.github/workflows/server.yml`.

### 1.1. Ключ на сервере (≈ 3 минуты)

На своём компьютере откройте терминал (Windows — PowerShell, Mac — «Терминал»):

```bash
ssh root@IP_СЕРВЕРА
```

(`yes` на вопрос о подключении, затем пароль от сервера — при вводе он не виден.) На сервере:

```bash
ssh-keygen -t ed25519 -N "" -C github-actions -f ~/.ssh/github_actions
cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/github_actions
```

Последняя команда покажет **закрытый ключ** — все строки от `-----BEGIN OPENSSH PRIVATE KEY-----`
до `-----END OPENSSH PRIVATE KEY-----` включительно. Скопируйте их. **Никому его не пересылайте** —
только в секрет GitHub на следующем шаге.

### 1.2. Секреты на GitHub (≈ 5 минут)

Репозиторий на GitHub → **Settings** → **Secrets and variables** → **Actions** →
вкладка **Secrets** → **New repository secret**. Создайте по одному:

| Имя секрета | Что вписать | Обязательно |
|---|---|---|
| `VPS_HOST` | IP сервера, например `5.182.33.60` | да |
| `VPS_USER` | `root` | да |
| `VPS_SSH_KEY` | закрытый ключ из шага 1.1 целиком | да |
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather | для бота |
| `TELEGRAM_BOT_USERNAME` | имя бота без @ | для бота |
| `ANTHROPIC_API_KEY` | ключ Claude | для ИИ |

Свой домен (необязательно): на той же странице вкладка **Variables** → **New repository
variable** → имя `DOMAIN`, значение `assistant.ваш-домен.uz` (A-запись домена должна указывать на
IP сервера). Без своего домена используется бесплатный адрес вида `5-182-33-60.sslip.io` —
он уже указывает на ваш сервер, HTTPS тоже работает.

### 1.3. Запуск установки (≈ 15 минут)

GitHub → вкладка **Actions** → слева **Server** → **Run workflow** → `action`: **setup** →
**Run workflow**. Через 10–15 минут — зелёная галочка; в конце журнала написан адрес сайта.

Пароли базы и сессий создаются на сервере автоматически и при повторном запуске не меняются.
Если секрет поменялся (например, новый токен бота) — снова запустите **setup**.

Другие действия той же кнопкой:

| `action` | Что делает |
|---|---|
| `status` | что запущено, память, диск, бэкапы, последние строки журналов (ничего не меняет) |
| `setup` | установка или повторная настройка |
| `deploy` | обновить код и перезапустить (после слияния в `main` — само) |
| `logs` | 200 последних строк журнала службы из поля `service` |
| `backup` | сделать бэкап сейчас |
| `backup-export` | последний бэкап (база + файлы), зашифрованный вашим открытым ключом, — файлом `backup` этого запуска на 1 день; в поле `data`: `{"key": "<открытый ключ PEM>"}`. Открыть может только закрытый ключ на вашем компьютере (см. раздел 10) |
| `restart` | перезапустить все службы |
| `demo-add` | добавить тестовые задачи (≈ 20) и 4 тестовых сотрудников — проект «Тестовые данные» |
| `demo-remove` | удалить все тестовые задачи и тестовых сотрудников (настоящие данные не трогаются) |

### 1.4. После установки

1. В @BotFather: `/setdomain` → ваш бот → адрес сайта без `https://`.
2. Откройте сайт → «Войти через Telegram». **Первый вошедший становится владельцем.**
3. Дальше — проверка из раздела 9 ниже (пункты 2–5).

Забрать у GitHub доступ к серверу: удалите секрет `VPS_SSH_KEY` или на сервере строку с
`github-actions` в файле `~/.ssh/authorized_keys`.

---

# Способ 2. Установка вручную

## 0. Что нужно заранее

1. **Сервер (VPS)** с Ubuntu 24.04: минимум 2 ядра, 4 ГБ памяти, 40 ГБ диска
   (если голос распознаётся на своём сервере — лучше 8 ГБ памяти).
   У провайдера вы получите **IP-адрес** и пароль пользователя `root`.
2. **Домен или поддомен**, например `assistant.example.uz`. В панели, где куплен домен, создайте
   **A-запись**: имя `assistant` (или `@` для домена целиком) → IP-адрес сервера.
   Изменение начинает работать за 5–60 минут.
3. **Telegram-бот**: в Telegram откройте @BotFather → `/newbot` → придумайте имя → получите
   **токен** (длинная строка с двоеточием) и **имя бота** (заканчивается на `bot`).
   Затем там же: `/setdomain` → выберите бота → введите ваш домен (без https://).
   Это нужно для кнопки «Войти через Telegram» на сайте.
4. **Ключ Claude** (для разбора задач из сообщений): https://console.anthropic.com → API Keys.
   Без ключа всё работает, но бот сохраняет сообщение как одну задачу «как есть».
5. **Ваш компьютер**: на Windows откройте «Терминал» (PowerShell), на Mac — «Терминал».

---

## 1. Первый вход на сервер

На своём компьютере (вместо `1.2.3.4` — IP вашего сервера):

```bash
ssh root@1.2.3.4
```

На вопрос `Are you sure you want to continue connecting` ответьте `yes`, затем введите пароль
(при вводе символы не видны — это нормально).

## 2. Обновление системы и отдельный пользователь

Работать под `root` небезопасно. Создадим пользователя `assistant`:

```bash
apt update && apt upgrade -y
adduser --disabled-password --gecos "" assistant
usermod -aG sudo assistant
mkdir -p /home/assistant/.ssh
cp ~/.ssh/authorized_keys /home/assistant/.ssh/ 2>/dev/null || true
chown -R assistant:assistant /home/assistant/.ssh
passwd assistant
```

Последняя команда попросит дважды придумать пароль для пользователя `assistant` — запишите его.

## 3. Firewall (открыть только нужные порты)

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
ufw status
```

Должны быть видны строки `22`, `80`, `443` с `ALLOW`.

## 4. Установка Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker assistant
docker --version
docker compose version
```

Обе последние команды должны показать номер версии.

## 5. Скачать проект

Переключитесь на пользователя `assistant` и скачайте код:

```bash
su - assistant
git clone https://github.com/Javlonbek12/Javlonbek.git assistant
cd assistant
```

> Если репозиторий приватный: на GitHub откройте Settings → Developer settings → Personal access
> tokens → Fine-grained → создайте токен с доступом «Contents: Read» к этому репозиторию и
> используйте команду `git clone https://<ТОКЕН>@github.com/Javlonbek12/Javlonbek.git assistant`.

## 6. Заполнить настройки (`.env`)

```bash
cp .env.example .env
openssl rand -hex 32   # скопируйте результат — это SESSION_SECRET
openssl rand -hex 24   # это POSTGRES_PASSWORD
openssl rand -hex 16   # это TELEGRAM_WEBHOOK_SECRET
nano .env
```

В редакторе `nano` заполните (стрелками перемещаться, вставка — правая кнопка мыши):

| Строка | Что вписать |
|---|---|
| `APP_URL` | `https://assistant.example.uz` (ваш домен с https://) |
| `SESSION_SECRET` | первая сгенерированная строка |
| `ALLOW_DEV_LOGIN` | `false` |
| `TELEGRAM_BOT_TOKEN` | токен от @BotFather |
| `TELEGRAM_BOT_USERNAME` | имя бота без @ |
| `TELEGRAM_WEBHOOK_SECRET` | третья сгенерированная строка |
| `ANTHROPIC_API_KEY` | ключ Claude (можно оставить пустым) |
| `STT_PROVIDER` | `whisper` (свой сервер распознавания) или `openai` |
| `WHISPER_URL` | `http://whisper:8000` (если `whisper`) |
| `UPLOAD_DIR` | оставить как есть (на сервере задаётся автоматически) |
| `DOMAIN` | `assistant.example.uz` (без https://) |
| `POSTGRES_PASSWORD` | вторая сгенерированная строка |
| `COMPOSE_PROFILES` | `whisper` (если `STT_PROVIDER=whisper`), иначе пусто |

Строку `DATABASE_URL` на сервере трогать не нужно — она не используется.
Сохранить: `Ctrl+O`, `Enter`; выйти: `Ctrl+X`.

## 7. Первый запуск

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Первая сборка занимает 5–10 минут. Миграции базы данных применяются автоматически
(служба `migrate`). Проверить, что всё запущено:

```bash
docker compose -f docker-compose.prod.yml ps
```

У `app`, `worker`, `watchdog`, `postgres`, `caddy` (и `whisper`, если включён) статус `Up`,
у `migrate` — `Exited (0)` (это нормально: она сделала работу и завершилась).

Если включено своё распознавание голоса (`COMPOSE_PROFILES=whisper`), один раз заранее скачайте
модель (около 1,6 ГБ, 2–5 минут), чтобы первое голосовое не ждало загрузки:

```bash
docker compose -f docker-compose.prod.yml exec whisper uv run --no-sync python -c "from faster_whisper import WhisperModel; WhisperModel('deepdml/faster-whisper-large-v3-turbo-ct2', compute_type='int8')"
```

Откройте в браузере `https://ваш-домен/api/health` — должно быть `{"status":"ok","database":"ok"}`.

> Сертификат HTTPS выдаётся автоматически в первые 1–2 минуты. Если сайт не открывается,
> проверьте, что A-запись домена указывает на IP сервера: `docker compose -f docker-compose.prod.yml logs caddy`.

## 8. Подключить бота (webhook)

```bash
docker compose -f docker-compose.prod.yml run --rm app npm run bot:set-webhook
```

Должно появиться `Webhook set to https://ваш-домен/api/telegram/webhook`.

## 9. Первый вход и проверка

1. Откройте `https://ваш-домен` → «Войти через Telegram». **Первый вошедший становится владельцем
   (OWNER).** Поэтому войдите сразу сами.
2. Откройте своего бота в Telegram → `/start`, чтобы бот мог присылать вам уведомления.
3. Напишите боту: «Завтра подготовить отчёт» → появится карточка задачи → «✅ Сохранить».
4. Отправьте голосовое сообщение с задачей → бот распознает текст и покажет карточку.
5. В приложении «Команда» → выберите роль → «Создать приглашение» → отправьте ссылку сотруднику.
6. Необязательно, для пробы: тестовое оборудование, SKU и планограммы —
   `docker compose -f docker-compose.prod.yml run --rm app npx prisma db seed`.
   Тестовые SKU потом можно убрать в архив или заменить импортом из Excel.

## 10. Резервные копии (каждый день)

Скрипт `scripts/backup.sh` сохраняет базу и загруженные файлы в папку `~/assistant-backups`
и удаляет копии старше 14 дней. Включить ежедневный запуск в 03:00:

```bash
crontab -e
```

(если спросит редактор — выберите `1`, nano) и добавьте в конец строку:

```
0 3 * * * /home/assistant/assistant/scripts/backup.sh >> /home/assistant/backup.log 2>&1
```

Проверить вручную прямо сейчас: `./scripts/backup.sh` и `ls ~/assistant-backups`.

> Копии лежат на том же сервере. Раз в неделю скачивайте свежую копию к себе:
> `scp assistant@1.2.3.4:~/assistant-backups/db-*.sql.gz .` (команда на вашем компьютере).

Без SSH-доступа с вашего компьютера — через GitHub, зашифрованно (репозиторий открытый, поэтому
бэкап туда кладётся только так):

```bash
# один раз, на вашем компьютере: пара ключей; backup-key.pem никому не отдавайте
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out backup-key.pem
openssl pkey -in backup-key.pem -pubout          # этот открытый ключ — в поле data
```

GitHub → Actions → Server → `backup-export`, `data`: `{"key": "-----BEGIN PUBLIC KEY-----\n…"}`.
Скачайте файл `backup` со страницы запуска, распакуйте и расшифруйте:

```bash
openssl pkeyutl -decrypt -inkey backup-key.pem -pkeyopt rsa_padding_mode:oaep -in backup-*.tar.enc.key -out pass
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:pass -in backup-*.tar.enc | tar -xf -
rm pass
```

Получатся те же `db-….sql.gz` и `uploads-….tar.gz`, что лежат на сервере.

### Восстановление из копии

**Внимание: текущие данные будут заменены данными из копии.**

```bash
cd ~/assistant
ls ~/assistant-backups          # выберите нужную дату
./scripts/restore.sh ~/assistant-backups/db-2026-10-05_0300.sql.gz ~/assistant-backups/uploads-2026-10-05_0300.tar.gz
```

Скрипт попросит ввести `yes`, остановит приложение, восстановит базу и файлы и запустит всё снова.

## 11. Автоматическое обновление через GitHub

После этого каждый push в ветку `main` (когда проверки CI зелёные) сам обновляет сервер,
а кнопкой **Actions → Server** можно смотреть состояние и журналы.

1. Создайте ключ на сервере — как в шаге 1.1 способа 1 (под пользователем `assistant`).
2. Впишите секреты `VPS_HOST`, `VPS_USER` (= `assistant`), `VPS_SSH_KEY` — как в шаге 1.2.
3. Проверка: GitHub → Actions → **Server** → Run workflow → `action`: **status**.

Обновить вручную (на сервере): `cd ~/assistant && ./scripts/deploy.sh`.

## 12. Мониторинг

- `https://ваш-домен/api/health` — работает ли сайт и база.
- Служба `watchdog` раз в 5 минут проверяет сайт, планировщик напоминаний и бота. Если что-то
  сломалось — **владельцу приходит сообщение в Telegram**, когда починится — ещё одно.
- Посмотреть журналы: `docker compose -f docker-compose.prod.yml logs --tail 100 app`
  (вместо `app` — `worker`, `watchdog`, `caddy`, `whisper`).
- Перезапустить всё: `docker compose -f docker-compose.prod.yml restart`.

## Частые проблемы

| Что видно | Что сделать |
|---|---|
| Сайт не открывается | `docker compose -f docker-compose.prod.yml ps` — все ли `Up`? Проверьте A-запись домена. |
| «Войти через Telegram» пишет «Bot domain invalid» | В @BotFather `/setdomain` → ваш домен. |
| Бот молчит | Повторите шаг 8; проверьте `TELEGRAM_BOT_TOKEN` в `.env`, затем `./scripts/deploy.sh`. |
| Голосовые не распознаются | `STT_PROVIDER=whisper`, `WHISPER_URL=http://whisper:8000`, `COMPOSE_PROFILES=whisper`, затем `docker compose -f docker-compose.prod.yml up -d`. |
| Изменили `.env` | `docker compose -f docker-compose.prod.yml up -d` — службы перезапустятся с новыми настройками. |
| Кончается место на диске | `docker system prune -f` и проверьте папку `~/assistant-backups`. |
