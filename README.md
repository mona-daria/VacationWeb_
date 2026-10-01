# План отпусков — комплект без скачивания библиотек

Версия 1.2.0, 21.09.2026. Подготовлен по условиям из файла программиста: Visual Studio Community 2019 16.11.50, Node.js 24.21.0 LTS, npm 11.19.0, .NET Framework 4.8.

**Открывать [VacationWeb.sln](VacationWeb.sln).**
Внутри — проект JavaScript/Node.js [VacationWeb.njsproj](VacationWeb.njsproj).
Полный перечень языков и технологий — [TECHNOLOGIES.txt](TECHNOLOGIES.txt).

## Начало работы
1. Распакуйте весь архив, включая node_modules.
2. Запустите Check-Environment.cmd, дождитесь PASS.
3. Откройте VacationWeb.sln, Ctrl+F5. Альтернатива — Start-Demo.cmd.
4. Откройте http://127.0.0.1:3080/.
5. Демо: employee, manager, manager2, hr, director; пароль DemoVacation2027!.

**npm install и npm ci не требуются. npm ci удаляет готовые библиотеки перед установкой.**
Node.exe в архиве отсутствует: используйте уже установленный Node.js 24.21.0.
Демо использует базу в памяти; данные сбрасываются при остановке. index.html отдельно не запускайте.

## Рабочий сервер
Создайте .env по шаблону, настройте PostgreSQL, выполните Check-Database.cmd и Initialize-Database.cmd. Запуск — Start-Server.cmd или команда Node под службой.
Сотрудники открывают HTTPS-адрес приложения в браузере; ПО разработчика на их ПК не требуется.
Полные инструкции: [DATABASE.md](docs/DATABASE.md) и [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Состав
| Файл | Назначение |
|---|---|
| [START-HERE.txt](START-HERE.txt) | Первое открытие и запуск |
| [TECHNOLOGIES.txt](TECHNOLOGIES.txt) | Языки, версии, технологии и среда |
| [LIBRARIES.txt](LIBRARIES.txt) | Все 112 записей библиотек из lock-файла |
| [VS2019.md](docs/VS2019.md) | Настройки и диагностика Visual Studio |
| [DEVELOPER.md](docs/DEVELOPER.md) | Структура и редактирование кода |
| [CODE-MAP.html](docs/CODE-MAP.html) | Построчный просмотр исходников |
| [ORG-AND-USERS.md](docs/ORG-AND-USERS.md) | Сотрудники, руководители, пароли |
| [API.md](docs/API.md) | Запросы API и статусы согласования |
| [ACCEPTANCE.md](docs/ACCEPTANCE.md) | Приемка на корпоративном сервере |
| [TEST-REPORT.md](docs/TEST-REPORT.md) | Фактические проверки и ограничения |

Бизнес-логика версии 1.1 сохранена. Подразделение — текстовое поле, один руководитель и одна роль на учетную запись; массовый импорт, редактирование сотрудников через UI, AD/LDAP, автоматическая рассылка не реализованы.
В комплекте нет рабочей .env, корпоративных паролей или данных БД. Лицензии зависимостей находятся в их каталогах node_modules.
