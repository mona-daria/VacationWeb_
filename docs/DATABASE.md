# PostgreSQL: подключение и связи

Есть три разных адреса:
- APP_ORIGIN — адрес сайта для сотрудников, например https://vacation.company.example, без завершающего слеша.
- HOST и PORT — где слушает Node, обычно 127.0.0.1:3080 за HTTPS-прокси.
- DATABASE_URL — соединение Node с PostgreSQL. Этот адрес не виден сотрудникам.

## Создание выделенной БД
Администратор PostgreSQL выполняет в psql (имена примерные):
```sql
CREATE ROLE vacation_app LOGIN;
\password vacation_app
CREATE DATABASE vacation_planner OWNER vacation_app;
```
Команда `\password` запрашивает пароль интерактивно. Выделенная БД должна принадлежать роли приложения; суперпользователь приложению не нужен.
Для первоначального создания таблиц роли нужны права создания объектов в public. Если политика вашей БД их изменила, администратор должен выдать CREATE и USAGE на public в этой выделенной БД.
Текущий сервер выполняет bootstrap схемы при запуске, поэтому отдельная роль только DML без изменения механизма миграций не подойдет.

## Настройка .env
Скопируйте .env.example → .env (рабочий сервер), либо .env.local.example (локальная тестовая БД).
```dotenv
DATABASE_URL=postgresql://vacation_app:URL_ENCODED_PASSWORD@db.company.example:5432/vacation_planner
DATABASE_SSL=verify-full
DATABASE_CA_FILE=C:/certificates/company-postgres-ca.pem
HOST=127.0.0.1
PORT=3080
APP_ORIGIN=https://vacation.company.example
COOKIE_SECURE=true
```
Замените все примеры своими данными. Спецсимволы в логине/пароле URL кодируйте процентным кодированием (например @ → %40, # → %23, % → %25).
Не передавайте URL с паролем в переписке и логи. В пути CA на Windows используйте прямые слеши.
verify-full проверяет цепочку сертификата и имя сервера; имя в DATABASE_URL должно совпадать с сертификатом. Если сертификат доверен системным хранилищем Node, DATABASE_CA_FILE оставьте пустым.
Не добавляйте sslmode/sslcert/sslrootcert в DATABASE_URL одновременно с DATABASE_SSL — конфигурация это запрещает.
disable допустим для изолированной локальной тестовой БД. В корпоративной сети согласуйте шифрование с администратором. HTTPS сайта и TLS БД — разные соединения и сертификаты.

PostgreSQL должен слушать нужный интерфейс (listen_addresses), firewall пропускать только сервер приложения, pg_hba.conf разрешать нужную БД/роль с адреса сервера приложения, например hostssl + scram-sha-256. Конкретные адреса задает ваш администратор; открывать БД всем ПК сотрудников не требуется.

## Проверка и инициализация
```sh
node --env-file=.env server/check-db.mjs
node --env-file=.env server/admin.mjs
node --env-file=.env server/index.mjs
```
Перед init задайте BOOTSTRAP_LOGIN, BOOTSTRAP_NAME, BOOTSTRAP_PASSWORD (12–128 символов). Команда создает первого кадровика. После успешного создания удалите временный пароль из .env.
db:check ничего не создает: показывает БД/роль/версию сервера/SSL и наличие таблиц. init и рабочий запуск создают отсутствующие таблицы, но не обновляют существующие определения.

## Таблицы и связи
| Таблица | Что хранит / связи |
|---|---|
| users | Пользователи; manager_id → users.id; department — строка |
| sessions | Хеш токена, CSRF, срок; user_id → users.id |
| plans | План на год; hr_by/director_by → users.id |
| requests | Одна заявка на пользователя и год; user_id → users, year → plans; periods JSONB |
| conflict_decisions | Решение кадровика по ключу пересечения; year → plans, actor_id → users |
| audit | Журнал; actor_id → users; request_id и year сохранены без внешних ключей |
| plan_snapshots | Снимок JSONB; year → plans, actor_id → users |
| schema_version | Маркер первоначальной схемы 1; полноценного движка миграций нет |

Пример periods: [{"start":"2027-07-01","end":"2027-07-14"}]. Формат дат — YYYY-MM-DD, даты включительны. Это календарные интервалы, автоматического расчета праздничных дней/прав на отпуск нет.
Справочник сотрудников изменяется через API кадровика, а не ручной записью паролей в SQL.

## Типовые ошибки
ECONNREFUSED/таймаут: адрес, порт, listen_addresses, firewall, маршрут.
28P01: логин/пароль, percent-encoding URL, правила pg_hba.
Сертификат: имя сервера, доверенный CA, срок сертификата; не отключайте проверку для обхода ошибки.
permission denied: владелец БД и права public.
relation does not exist: выполните init, проверьте имя БД.
403 при отправке формы: открытый адрес должен точно совпадать с APP_ORIGIN, включая протокол и порт.

Официальные справочники: [соединение pg](https://node-postgres.com/features/connecting), [SSL pg](https://node-postgres.com/features/ssl), [PostgreSQL authentication](https://www.postgresql.org/docs/current/client-authentication.html).
