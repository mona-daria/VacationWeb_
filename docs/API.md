# HTTP API

Все запросы с одного APP_ORIGIN. POST: Content-Type application/json и заголовок Origin; после входа также cookie vacation_session и X-CSRF-Token из login/me.
Все даты ISO YYYY-MM-DD. year — 2000–2200. Ошибка: {"error":"текст"}; 400 ввод, 401 вход, 403 права/CSRF, 404 отсутствие, 409 устаревшая версия/состояние, 415 формат, 429 лимит, 500 сервер.

| Метод и путь | Тело / ответ |
|---|---|
| GET /api/health | {ok:true}, проверяет БД |
| GET /api/config | {demo:boolean} |
| POST /api/login | {login,password} → {me,csrf}, cookie |
| GET /api/me | {me,csrf} |
| POST /api/logout | {} → {ok:true} |
| POST /api/password | {current,password} → {ok:true}, закрывает сессии |
| GET /api/state?year=2027 | me, year, plan, requests, conflicts, people, history, snapshots |
| POST /api/requests | {year,version,periods:[{start,end}]} → {id}; version=0 для новой |
| POST /api/requests/:id | {action:"approve" или "return",version,comment} |
| POST /api/conflicts | {year,key,action:"accept" или "reopen",comment} |
| POST /api/plan | {year,revision,action:"hr_approve"/"director_approve"/"return",comment} |
| POST /api/users | {login,name,department,role,manager_id,password} |
| GET /api/export?year=2027 | Excel текущего доступного свода |
| GET /api/snapshots/:id | Excel сохраненной версии, HR/директор |

approve заявки — только назначенный руководитель. return заявки — руководитель или HR; комментарий обязателен.
conflicts и users — HR; comment для решения/отмены решения обязателен.
HR согласует весь план, директор утверждает только после HR. Возврат плана требует комментария.
Комментарий 3–2000 символов, пароль 12–128, максимум 24 периода в заявке.
Сотрудник видит свои заявки, руководитель — свои и непосредственных подчиненных, HR/директор — все. Выгрузка сотруднику недоступна.
Перед изменением после 409 заново получите state и предложите пользователю повторно проверить действие; не подставляйте новую версию автоматически.

Заявка: submitted → manager_approved; return → revision; повторная подача → submitted.
План: open → hr_approved → approved; возврат → open с увеличением revision.
Ответы POST обычно {ok:true}; структура деталей state определяется service.state и domain.conflicts, эти файлы включены в построчную карту.
