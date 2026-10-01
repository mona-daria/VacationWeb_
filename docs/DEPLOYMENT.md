# Установка на сервер

1. Распакуйте исходники на сервер, установите Node.js 24 LTS и npm.
2. Выполните node tools/doctor.cjs (на Windows можно открыть Check-Environment.cmd). В архив уже включены библиотеки демонстрации и тестов.
3. Настройте .env и PostgreSQL по DATABASE.md. Выполните db:check и init.
4. Настройте HTTPS-прокси на корпоративный домен. Он передает запросы на 127.0.0.1:3080; приложение обслуживается в корне сайта, не /vacation/.
5. Запустите node --env-file=.env server/index.mjs под учетной записью службы с правом чтения исходников, .env и CA. Рабочая папка — корень проекта.
6. Проверьте /api/health, вход, смену пароля, выгрузку Excel и ACCEPTANCE.md.

На Windows используйте принятый в организации менеджер служб для Node, указав полный путь к node.exe и аргументы --env-file=.env server/index.mjs. На Linux аналогичные параметры можно задать systemd:
```ini
[Unit]
Description=Vacation web
After=network-online.target
Wants=network-online.target
[Service]
User=vacation
WorkingDirectory=/opt/vacation-web
ExecStart=/usr/bin/node --env-file=.env server/index.mjs
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
```
Создание учетной записи службы и пути выполняет администратор. Пример не устанавливается автоматически.

Пример блока nginx внутри настроенного HTTPS-сервера с корпоративным сертификатом:
```nginx
location / {
    proxy_pass http://127.0.0.1:3080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```
При IIS используйте принятый в компании reverse proxy; браузер должен получать сайт и API с одного HTTPS-адреса. Не открывайте порт Node внешней сети без необходимости.

## Резервное копирование и обновление
Включите регулярный pg_dump в формате custom, храните копии отдельно от сервера. Пароль используйте через защищенный pgpass/хранилище службы, не в аргументах команд.
Проверяйте восстановление pg_restore в отдельную БД; восстановление поверх рабочей БД здесь не автоматизировано.
Перед обновлением: резервная копия → проверка на отдельной БД → остановка службы → замена кода с сохранением .env → проверка Check-Environment.cmd → необходимые миграции → запуск → приемка.
Не удаляйте рабочую БД и не заменяйте ее демонстрационной.
Контролируйте ошибки службы, доступность /api/health и свободное место. Установите политику хранения аудита/сессий с учетом требований организации.

## Перед выдачей ссылки
HTTPS и secure cookie; корректный APP_ORIGIN; отдельные временные пароли; проверенная резервная копия; назначенные руководители; нагрузочное тестирование.
На ПК сотрудников достаточно браузера. PostgreSQL, Node и Visual Studio им устанавливать не нужно.
