'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const roles = {
    employee: 'Сотрудник',
    manager: 'Руководитель',
    hr: 'Кадровик',
    director: 'Генеральный директор'
};

// Статусы заявок (как в БД/сервере)
const statuses = {
    'отправлено': ['На согласовании', 'blue'],
    'согласовано': ['Согласовано руководителем', 'ok'],
    'пересмотр': ['Пересмотр дат', 'warn']
};

// Статусы плана (как в БД/сервере)
const planStatuses = {
    'открыт': 'Подготовка плана',
    'согласован_кадрами': 'На утверждении директора',
    'утвержден': 'План утвержден'
};

const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Тексты истории (audit.action)
const actionsText = {
    submitted: 'Отправлены даты руководителю',
    manager_approved: 'Руководитель согласовал даты',
    revision_requested: 'Запрошен пересмотр дат',
    conflict_accepted: 'Совпадение принято кадровиком',
    conflict_reopened: 'Пересечение возвращено на проверку',
    hr_approve: 'Кадровик согласовал сводный план',
    director_approve: 'Генеральный директор утвердил план',
    return: 'План возвращен на доработку',
    user_created: 'Создан пользователь'
};

let me, csrf, data;
let tab = 'calendar';
let year = new Date().getFullYear() + 1;
let month = 6;
let department = '';
let search = '';
let onlyUnresolved = false;
let busy = false;

const dialog = $('#dialog');

const date = s => s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—';
const range = p => `${date(p.start)} — ${date(p.end)}`;
const dayCount = p => Math.round((Date.parse(p.end) - Date.parse(p.start)) / 86400000) + 1;

const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;
const status = r => badge(...statuses[r.status]);
const empty = (title, detail) => `<div class="empty"><strong>${esc(title)}</strong>${esc(detail || '')}</div>`;

function toast(text, error = false) {
    const el = $('#toast');
    el.textContent = text;
    el.className = 'show' + (error ? ' error' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.className = '', 6000);
}

async function api(path, body) {
    const res = await fetch('/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    const value = await res.json().catch(() => ({}));

    if (!res.ok) {
        if (res.status === 401 && path !== '/login') {
            me = null;
            login();
        }
        throw Error(value.error || 'Не удалось выполнить действие.');
    }
    return value;
}

function showDialog(html) {
    dialog.innerHTML = html;
    dialog.showModal();
}

function footer(label = 'Сохранить') {
    return `<div class="form-error" role="alert"></div><div class="dialog-footer"><button type="button" data-action="close">Отмена</button><button class="primary" type="submit">${label}</button></div>`;
}

function login() {
    $('#app').innerHTML = `
  <div class="login-page">
    <section class="login-art">
      <div class="brand"><img src="/favicon.svg" alt="">План отпусков</div>
      <h1>От личных дат —<br>к общему плану.</h1>
      <p>Согласование отпусков, все пересечения и единый утвержденный график.</p>
      <div class="mini-cal" aria-hidden="true">${Array.from({ length: 28 }, () => '<span></span>').join('')}</div>
    </section>
    <section class="login-panel">
      <div class="login-form">
        <h2>Вход в приложение</h2>
        <p>Используйте учетную запись, которую выдал сотрудник кадров.</p>
        <form id="login-form">
          <label>Логин<input name="login" autocomplete="username" required maxlength="80"></label>
          <label>Пароль<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>
          <div class="form-error" role="alert"></div>
          <button class="primary" type="submit">Войти</button>
        </form>
      </div>
    </section>
  </div>`;
}

async function load() {
    data = await api('/state?year=' + year);
    me = data.me;
    render();
}

function render() {
    const nav = [
        ['mine', '◷', 'Мой отпуск'],
        ...(me.role !== 'employee' ? [['calendar', '▦', 'Общий календарь'], ['requests', '☷', 'Заявки']] : []),
        ...(['hr', 'director'].includes(me.role) ? [['conflicts', '⇄', 'Пересечения'], ['approval', '✓', 'Сводный план'], ['history', '◴', 'История']] : []),
        ...(me.role === 'hr' ? [['people', '♙', 'Сотрудники']] : [])
    ];

    if (!nav.some(n => n[0] === tab))
        tab = nav[0][0];

    $('#app').innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div>
        <div class="brand"><img src="/favicon.svg" alt="">План отпусков</div>
      </div>

      <nav class="nav" aria-label="Разделы">
        ${nav.map(([key, icon, title]) =>
        `<button data-action="tab" data-tab="${key}" class="${tab === key ? 'active' : ''}" ${tab === key ? 'aria-current="page"' : ''}>
            <span class="icon" aria-hidden="true">${icon}</span>${title}
          </button>`
    ).join('')}
      </nav>

      <div class="side-bottom">
        <strong>${esc(me.name)}</strong>${roles[me.role]}<br>${esc(me.department)}<br>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div>
          <span class="eyebrow">Планирование отпусков</span>
          <strong>${esc(me.name)} · ${roles[me.role]}</strong>
        </div>

        <div class="top-actions">
          <label class="sr-only" for="year">Год плана</label>
          <input id="year" type="number" min="2000" max="2200" value="${year}" style="width:108px" aria-label="Год плана">
          <button class="small" data-action="refresh" title="Обновить данные">Обновить</button>
          <button class="small" data-action="logout">Выйти</button>
        </div>
      </header>

      <main class="workspace">${page()}</main>
    </div>
  </div>`;
}

function head(title, subtitle, buttons = '') {
    return `<div class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${buttons}</div></div>`;
}

function exportButton() {
    return `<a class="button" href="/api/export?year=${year}">↓ Скачать Excel</a>`;
}

function filters(includeMonth = false) {
    const departments = [...new Set(data.people.map(p => p.department).filter(Boolean))].sort();
    return `<div class="filters">
    ${includeMonth ? `<label>Месяц<select id="month">${months.map((m, i) => `<option value="${i}" ${month === i ? 'selected' : ''}>${m}</option>`).join('')}</select></label>` : ''}
    <label>Подразделение<select id="department"><option value="">Все подразделения</option>${departments.map(d => `<option ${department === d ? 'selected' : ''} value="${esc(d)}">${esc(d)}</option>`).join('')}</select></label>
    <label>Сотрудник<input id="search" placeholder="Поиск по имени" value="${esc(search)}"></label>
  </div>`;
}

function matches(r) {
    return (!department || r.department === department) && (!search || r.name.toLowerCase().includes(search.toLowerCase()));
}

function metrics() {
    const unresolved = data.conflicts.filter(c => !c.decision).length;
    const employeeIds = new Set(data.requests.map(r => r.user_id));
    const missing = data.people.filter(p => p.active && p.role === 'employee' && !employeeIds.has(p.id)).length;
    return `<div class="metrics">
    <div class="metric"><span>Заявок в плане</span><strong>${data.requests.length}</strong><small>${year} год</small></div>
    <div class="metric"><span>Согласовано руководителями</span><strong>${data.requests.filter(r => r.status === 'согласовано').length}</strong><small>В общем предварительном плане</small></div>
    <div class="metric alert"><span>Все пересечения</span><strong>${data.conflicts.length}</strong><small>${unresolved} требуют решения</small></div>
    <div class="metric"><span>Не подали даты</span><strong>${missing}</strong><small>Действующих сотрудников</small></div>
  </div>`;
}

function page() {
    switch (tab) {
        case 'mine': return mine();
        case 'calendar': return calendar();
        case 'requests': return requests();
        case 'conflicts': return overlapPage();
        case 'approval': return approval();
        case 'history': return history();
        case 'people': return people();
    }
}

function mine() {
    const r = data.requests.find(r => r.user_id === me.id);
    const editable = data.plan.status === 'открыт' && (!r || r.status !== 'согласовано');

    return head('Мой отпуск', `Планируемые даты на ${year} год`,
        editable && me.manager_id ? `<button class="primary" data-action="edit-dates">${r ? 'Изменить даты' : 'Указать даты'}</button>` : ''
    )
        + (!me.manager_id ? '<div class="notice">Для подачи собственного отпуска вам необходимо назначить руководителя. Обратитесь к кадровику.</div>' : '')
        + `<div class="steps">
      <div class="step ${r ? 'done' : 'current'}">Шаг 1<b>Даты сотрудника</b></div>
      <div class="step ${r?.status === 'согласовано' ? 'done' : 'current'}">Шаг 2<b>Руководитель</b></div>
      <div class="step ${data.plan.status !== 'открыт' ? 'done' : 'current'}">Шаг 3<b>Кадровик</b></div>
      <div class="step ${data.plan.status === 'утвержден' ? 'done' : ''}">Шаг 4<b>Генеральный директор</b></div>
    </div>`
        + (r ? `<section class="card">
      <div class="card-head"><h2>Мои периоды отпуска</h2>${status(r)}</div>
      <div class="card-body">
        ${r.comment ? `<div class="notice warning"><b>Запрос на пересмотр</b><br>${esc(r.comment)}</div>` : ''}
        <div class="table-wrap">
          <table><thead><tr><th>Начало</th><th>Окончание</th><th>Календарных дней</th></tr></thead>
            <tbody>${r.periods.map(p => `<tr><td>${date(p.start)}</td><td>${date(p.end)}</td><td>${dayCount(p)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="muted">${r.status === 'отправлено'
                ? 'Даты направлены руководителю. После согласования они появятся в общем плане.'
                : r.status === 'пересмотр'
                    ? 'Исправьте даты и отправьте их руководителю повторно.'
                    : 'Даты включены в общий план. Пересмотр доступен после запроса ответственного.'
            }</p>
      </div>
    </section>`
            : empty('Вы еще не указали даты', 'Добавьте один или несколько периодов планируемого отпуска.'))
        + `<div class="notice">Общий план: <b>${planStatuses[data.plan.status]}</b> · версия ${data.plan.revision}</div>`;
}

function calendar() {
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const rows = data.requests.filter(r => r.status === 'согласовано' && matches(r));

    const dayHeaders = Array.from({ length: count }, (_, i) => {
        const dt = new Date(Date.UTC(year, month, i + 1));
        const day = dt.getUTCDay();
        return `<th class="day ${day === 0 || day === 6 ? 'weekend' : ''}">${i + 1}<small>${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][day]}</small></th>`;
    }).join('');

    const cells = r => Array.from({ length: count }, (_, i) => {
        const d = prefix + String(i + 1).padStart(2, '0');
        const periods = r.periods.filter(p => p.start <= d && p.end >= d);
        const cs = data.conflicts.filter(c => (c.a === r.id || c.b === r.id) && c.start <= d && c.end >= d);
        const weekend = [0, 6].includes(new Date(Date.UTC(year, month, i + 1)).getUTCDay());

        return `<td class="cell ${weekend ? 'weekend' : ''}">${periods.length ? `<div class="bar ${cs.length ? 'overlap' : ''} ${cs.length && cs.every(c => c.decision) ? 'accepted' : ''} ${periods.some(p => p.start === d) ? 'begin' : ''} ${periods.some(p => p.end === d) ? 'end' : ''}"
        title="${esc(r.name)}: ${date(d)}${cs.length ? ' · пересечение' + (cs.every(c => c.decision) ? ' принято' : ' требует решения') : ''}">
        <span class="sr-only">Отпуск${cs.length ? ', пересечение' : ''}</span>
      </div>` : ''
            }</td>`;
    }).join('');

    return head('Общий календарь', `Все согласованные руководителями отпуска · ${year}`, exportButton())
        + metrics()
        + `<section class="card">
        <div class="card-head">${filters(true)}</div>
        <div class="legend"><span>Отпуск</span><span class="red">Пересечение · штриховка означает принятое решение</span></div>
        ${rows.length ? `<div class="table-wrap"><table class="calendar">
          <thead><tr><th class="person">Сотрудник / ${months[month]}</th>${dayHeaders}</tr></thead>
          <tbody>${rows.map(r => `<tr><td class="person"><b>${esc(r.name)}</b><span class="sub">${esc(r.department)}</span></td>${cells(r)}</tr>`).join('')}</tbody>
        </table></div>` : empty('Нет согласованных отпусков', 'Измените фильтры или дождитесь согласования заявок руководителями.')}
      </section>
      <p class="muted">Совпадения учитываются включительно по обеим датам, в том числе между подразделениями. Ожидающие согласования заявки доступны в разделе «Заявки».</p>`;
}

function requestButtons(r) {
    if (data.plan.status !== 'открыт') return '';
    const manage = me.role === 'manager' && r.manager_id === me.id && r.user_id !== me.id;
    return `<div class="actions">
    ${manage && r.status === 'отправлено' ? `<button class="small primary" data-action="approve-request" data-id="${r.id}">Согласовать</button>` : ''}
    ${(manage || me.role === 'hr') && r.status !== 'пересмотр' ? `<button class="small" data-action="return-request" data-id="${r.id}">Пересмотр</button>` : ''}
  </div>`;
}

function requests() {
    const rows = data.requests.filter(matches);
    const ids = new Set(data.requests.map(r => r.user_id));
    const missing = data.people.filter(p => p.active && p.role === 'employee' && !ids.has(p.id) && matches(p));

    return head('Заявки на отпуск', 'Рассмотрение дат и повторное согласование после изменений', exportButton())
        + `<section class="card">
        <div class="card-head">${filters()}</div>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Сотрудник</th><th>Периоды отпуска</th><th>Статус</th><th>Действия</th></tr></thead>
        <tbody>${rows.map(r => `<tr class="${r.status === 'пересмотр' ? 'row-return' : ''}">
          <td><b>${esc(r.name)}</b><span class="sub">${esc(r.department)}</span></td>
          <td>${r.periods.map(p => `<div class="nowrap">${range(p)}</div>`).join('')}
            <span class="sub">${r.periods.reduce((s, p) => s + dayCount(p), 0)} календарных дней по периодам</span>
          </td>
          <td>${status(r)}${r.comment ? `<span class="sub">${esc(r.comment)}</span>` : ''}</td>
          <td>${requestButtons(r)}</td>
        </tr>`).join('')}</tbody></table></div>`
            : empty('Заявок пока нет', 'Поданные сотрудниками даты появятся здесь.')}
      </section>
      ${missing.length ? `<section class="card">
        <div class="card-head"><h2>Еще не подали даты · ${missing.length}</h2></div>
        <div class="card-body">${missing.map(p => esc(p.name) + ' <span class="muted">(' + esc(p.department) + ')</span>').join('<br>')}</div>
      </section>` : ''}`;
}

function overlapPage() {
    const rows = data.conflicts.filter(c =>
        (!department || c.a_department === department || c.b_department === department) &&
        (!search || (c.a_name + ' ' + c.b_name).toLowerCase().includes(search.toLowerCase())) &&
        (!onlyUnresolved || !c.decision)
    );

    return head('Все пересечения', 'Включая совпадения между подразделениями и принятые кадровиком', exportButton())
        + metrics()
        + `<section class="card">
        <div class="card-head">${filters()}
          <label style="display:flex;align-items:center;margin:0">
            <input type="checkbox" id="unresolved" ${onlyUnresolved ? 'checked' : ''} style="width:18px;min-height:18px">Только требующие решения
          </label>
        </div>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Сотрудники</th><th>Общие даты</th><th>Дней</th><th>Решение кадровика</th>${me.role === 'hr' ? '<th>Действия</th>' : ''}</tr></thead>
        <tbody>${rows.map(c => `<tr>
          <td><b>${esc(c.a_name)}</b><span class="sub">${esc(c.a_department)}</span><br><b>${esc(c.b_name)}</b><span class="sub">${esc(c.b_department)}${c.same_employee ? ' · периоды одного сотрудника' : ''}</span></td>
          <td class="nowrap">${range(c)}</td>
          <td><b>${c.days}</b></td>
          <td>${badge(c.decision ? 'Совпадение принято' : 'Требует решения', c.decision ? 'ok' : 'red')}
            <span class="sub">${esc(c.decision?.comment || '')}</span>${c.decision ? `<span class="sub">${esc(c.decision.actor_name)}</span>` : ''}</td>
          ${me.role === 'hr' ? `<td>${data.plan.status === 'открыт' ? `<div class="actions">
            <button class="small ${c.decision ? '' : 'primary'}" data-action="conflict" data-key="${esc(c.key)}" data-mode="${c.decision ? 'reopen' : 'accept'}">${c.decision ? 'Повторная проверка' : 'Принять совпадение'}</button>
            <button class="small" data-action="resolve" data-key="${esc(c.key)}">Запросить пересмотр</button>
          </div>` : '—'}</td>` : ''}
        </tr>`).join('')}</tbody></table></div>`
            : empty('Пересечений по выбранным условиям нет', onlyUnresolved ? 'Все показанные ранее пересечения имеют решение.' : 'Проверяются все периоды, согласованные руководителями.')}
      </section>`;
}

function approval() {
    const pending = data.requests.filter(r => r.status !== 'согласовано').length;
    const unresolved = data.conflicts.filter(c => !c.decision).length;
    const ids = new Set(data.requests.map(r => r.user_id));
    const missing = data.people.filter(p => p.active && p.role === 'employee' && !ids.has(p.id)).length;

    const buttons =
        me.role === 'hr' && data.plan.status === 'открыт'
            ? '<button class="primary" data-action="plan" data-mode="hr_approve">Согласовать и направить директору</button>'
            : me.role === 'director' && data.plan.status === 'согласован_кадрами'
                ? '<button class="primary" data-action="plan" data-mode="director_approve">Утвердить итоговый план</button>'
                : '';

    return head('Сводный план отпусков', `${year} год · версия ${data.plan.revision}`, exportButton())
        + `<section class="card">
        <div class="card-head"><h2>${planStatuses[data.plan.status]}</h2>${badge(data.plan.status === 'утвержден' ? 'Утвержден' : 'В работе', data.plan.status === 'утвержден' ? 'ok' : 'blue')}</div>
        <div class="card-body">
          <div class="steps">
            <div class="step done">1<b>Даты сотрудников</b></div>
            <div class="step ${!pending && !missing && data.requests.length ? 'done' : 'current'}">2<b>Руководители</b></div>
            <div class="step ${data.plan.status !== 'открыт' ? 'done' : 'current'}">3<b>Кадровик</b></div>
            <div class="step ${data.plan.status === 'утвержден' ? 'done' : ''}">4<b>Генеральный директор</b></div>
          </div>

          <p>${data.requests.length} заявок · ${pending} ожидают согласования или пересмотра · ${missing} сотрудников не подали даты · ${unresolved} пересечений требуют решения.</p>

          ${data.plan.hr_at ? `<p>Кадровик: ${esc(data.people.find(p => p.id === data.plan.hr_by)?.name)} · ${date(data.plan.hr_at)}</p>` : ''}
          ${data.plan.director_at ? `<p>Генеральный директор: ${esc(data.people.find(p => p.id === data.plan.director_by)?.name)} · ${date(data.plan.director_at)}</p>` : ''}

          <div class="actions">${buttons}${(me.role === 'hr' && data.plan.status !== 'открыт') || (me.role === 'director' && data.plan.status === 'согласован_кадрами') ? '<button data-action="plan" data-mode="return">Вернуть на доработку</button>' : ''}</div>

          <p class="muted">После согласования кадровиком даты блокируются. Возврат на доработку открывает новую версию плана; предыдущая сохраняется в архиве.</p>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Сохраненные версии</h2></div>
        ${data.snapshots.length ? `<div class="card-body">${data.snapshots.map(s => `<p><a href="/api/snapshots/${s.id}">Версия ${s.revision} · ${esc(actionsText[s.kind] || s.kind)} · ${date(s.created_at)} ↓ Excel</a></p>`).join('')}</div>` : empty('Архив пока пуст', 'Версии сохраняются при согласовании, утверждении и возврате плана.')}
      </section>`;
}

function history() {
    return head('История изменений', 'Последние 500 событий выбранного года')
        + `<section class="card"><div class="card-body">${data.history.length ? `<ul class="timeline">${data.history.map(e => `<li><b>${esc(actionsText[e.action] || e.action)}</b>${e.request_id ? ` · ${esc(data.requests.find(r => r.id === e.request_id)?.name || 'Сотрудник')}` : ''}${e.payload?.comment ? `<div>${esc(e.payload.comment)}</div>` : ''}${e.payload?.periods ? `<div>${e.payload.periods.map(range).join(', ')}</div>` : ''}<small>${esc(e.actor_name || 'Система')} · ${new Date(e.created_at).toLocaleString('ru-RU')}</small></li>`).join('')}</ul>` : empty('Изменений пока нет', 'Действия участников будут сохранены здесь.')}</div></section>`;
}

function people() {
    return head('Сотрудники', 'Учетные записи и назначенные руководители', '<button class="primary" data-action="add-user">Добавить сотрудника</button>')
        + `<section class="card"><div class="table-wrap"><table><thead><tr><th>Сотрудник</th><th>Логин</th><th>Подразделение</th><th>Роль</th><th>Руководитель</th></tr></thead><tbody>${data.people.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.login)}</td><td>${esc(p.department)}</td><td>${roles[p.role]}</td><td>${esc(data.people.find(u => u.id === p.manager_id)?.name || '—')}</td></tr>`).join('')}</tbody></table></div></section><p class="muted">Сначала создайте руководителей, затем сотрудников.</p>`;
}

function periodRow(p = { start: '', end: '' }) {
    return `<div class="period-row"><label>Начало<input type="date" name="start" min="${year}-01-01" max="${year}-12-31" required value="${p.start || ''}"></label><label>Окончание<input type="date" name="end" min="${year}-01-01" max="${year}-12-31" required value="${p.end || ''}"></label><button type="button" data-action="remove-period" aria-label="Удалить период">×</button></div>`;
}

document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || busy) return;
    const action = el.dataset.action;

    try {
        if (action === 'close') { dialog.close(); return; }

        if (action === 'tab') {
            tab = el.dataset.tab;
            department = '';
            search = '';
            render();
            return;
        }

        if (action === 'logout') {
            await api('/logout', {});
            me = null;
            csrf = null;
            login();
            return;
        }

        if (action === 'refresh') {
            await load();
            toast('Данные обновлены');
            return;
        }

        if (action === 'edit-dates') {
            const r = data.requests.find(r => r.user_id === me.id);
            showDialog(`<h2>Даты планируемого отпуска</h2><p class="muted">${year} год. Все даты включительно. Периоды на границе годов укажите отдельно в каждом году.</p><form id="dates-form" data-version="${r?.version || 0}"><div class="periods">${(r?.periods || [{}]).map(periodRow).join('')}</div><button type="button" data-action="add-period">+ Добавить период</button>${footer('Отправить руководителю')}</form>`);
            return;
        }

        if (action === 'add-period') {
            if (dialog.querySelectorAll('.period-row').length < 24)
                dialog.querySelector('.periods').insertAdjacentHTML('beforeend', periodRow());
            return;
        }

        if (action === 'remove-period') {
            if (dialog.querySelectorAll('.period-row').length > 1)
                el.closest('.period-row').remove();
            return;
        }

        if (action === 'approve-request') {
            const r = data.requests.find(r => String(r.id) === String(el.dataset.id));
            await mutate('/requests/' + r.id, { action: 'approve', version: r.version }, 'Даты согласованы');
            return;
        }

        if (action === 'return-request') {
            const r = data.requests.find(r => String(r.id) === String(el.dataset.id));
            showDialog(`<h2>Запросить пересмотр дат</h2><p>${esc(r.name)} · ${r.periods.map(range).join(', ')}</p><form id="return-form" data-id="${r.id}" data-version="${r.version}"><label>Причина и пожелания к новым датам<textarea name="comment" required minlength="3" maxlength="2000"></textarea></label>${footer('Направить запрос')}</form>`);
            return;
        }

        if (action === 'conflict') {
            const c = data.conflicts.find(c => c.key === el.dataset.key);
            showDialog(`<h2>${el.dataset.mode === 'accept' ? 'Принять совпадение' : 'Повторная проверка'}</h2><p>${esc(c.a_name)} и ${esc(c.b_name)}<br>${range(c)} · ${c.days} дней</p><form id="conflict-form" data-key="${esc(c.key)}" data-mode="${el.dataset.mode}"><label>Комментарий к решению<textarea name="comment" required minlength="3" maxlength="2000"></textarea></label>${footer('Сохранить решение')}</form>`);
            return;
        }

        if (action === 'resolve') {
            const c = data.conflicts.find(c => c.key === el.dataset.key);
            const ids = [...new Set([c.a, c.b])];
            showDialog(`<h2>Запросить пересмотр дат</h2><p>Пересечение ${range(c)} · ${c.days} дней.</p><form id="resolve-form"><label>Кому направить запрос<select name="request">${ids.map(id => { const r = data.requests.find(r => r.id === id); return `<option value="${id}">${esc(r.name)}</option>`; }).join('')}</select></label><label>Причина и пожелания к новым датам<textarea name="comment" required minlength="3" maxlength="2000">Пересечение отпуска с ${esc(c.a_name)} / ${esc(c.b_name)}: ${range(c)}. Просьба пересмотреть даты.</textarea></label>${footer('Направить запрос')}</form>`);
            return;
        }

        if (action === 'plan') {
            const mode = el.dataset.mode;
            showDialog(`<h2>${mode === 'return' ? 'Вернуть план на доработку' : mode === 'hr_approve' ? 'Согласование кадровиком' : 'Утверждение итогового плана'}</h2><p>План ${year} года, версия ${data.plan.revision}. ${mode === 'return' ? 'Предыдущая версия сохранится в архиве.' : 'Решение будет сохранено вместе с текущей версией всего плана.'}</p><form id="plan-form" data-mode="${mode}" data-revision="${data.plan.revision}">${mode === 'return' ? '<label>Замечания к плану<textarea name="comment" required minlength="3" maxlength="2000"></textarea></label>' : ''}${footer(mode === 'return' ? 'Вернуть на доработку' : 'Подтвердить согласование')}</form>`);
            return;
        }

        if (action === 'add-user') {
            showDialog(`<h2>Новый сотрудник</h2><form id="user-form"><label>ФИО<input name="name" required maxlength="150"></label><div class="field-row"><label>Логин<input name="login" required pattern="[a-zA-Z0-9._@-]{2,80}" autocomplete="off"></label><label>Подразделение<input name="department" required maxlength="150"></label></div><div class="field-row"><label>Роль<select name="role">${Object.entries(roles).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label>Руководитель<select name="manager_id"><option value="">Не назначен</option>${data.people.filter(p => p.role === 'manager' && p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label></div><label>Пароль · минимум 4 символа<input name="password" type="password" required minlength="4" maxlength="128" autocomplete="new-password"></label>${footer('Создать учетную запись')}</form>`);
            return;
        }
    }
    catch (err) {
        toast(err.message, true);
    }
});

async function mutate(path, body, message) {
    busy = true;
    document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = true);
    try {
        await api(path, body);
        dialog.close();
        await load();
        toast(message);
    }
    finally {
        busy = false;
        document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = false);
    }
}

document.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;

    const form = e.target;
    const b = Object.fromEntries(new FormData(form));
    const error = form.querySelector('.form-error');
    if (error) error.textContent = '';

    try {
        if (form.id === 'login-form') {
            busy = true;
            form.querySelector('button[type="submit"]').disabled = true;
            const result = await api('/login', b);
            me = result.me;
            csrf = result.csrf;
            tab = me.role === 'employee' ? 'mine' : 'calendar';
            await load(); // важно
            return;
        }

        if (form.id === 'dates-form') {
            const periods = [...form.querySelectorAll('.period-row')].map(r => ({
                start: r.querySelector('[name=start]').value,
                end: r.querySelector('[name=end]').value
            }));
            await mutate('/requests', { year, version: Number(form.dataset.version), periods }, 'Даты направлены руководителю');
            return;
        }

        if (form.id === 'return-form') {
            await mutate('/requests/' + form.dataset.id, { action: 'return', version: Number(form.dataset.version), comment: b.comment }, 'Запрос на пересмотр направлен сотруднику');
            return;
        }

        if (form.id === 'resolve-form') {
            const r = data.requests.find(r => String(r.id) === String(b.request));
            await mutate('/requests/' + r.id, { action: 'return', version: r.version, comment: b.comment }, 'Запрос на пересмотр направлен сотруднику');
            return;
        }

        if (form.id === 'conflict-form') {
            await mutate('/conflicts', { year, key: form.dataset.key, action: form.dataset.mode, comment: b.comment }, 'Решение сохранено');
            return;
        }

        if (form.id === 'plan-form') {
            await mutate('/plan', { year, revision: Number(form.dataset.revision), action: form.dataset.mode, comment: b.comment || '' }, 'Решение по плану сохранено');
            return;
        }

        if (form.id === 'user-form') {
            await mutate('/users', b, 'Учетная запись создана');
            return;
        }
    }
    catch (err) {
        if (error) error.textContent = err.message;
        else toast(err.message, true);
    }
    finally {
        busy = false;
        const button = form.querySelector('button[type="submit"]');
        if (button) button.disabled = false;
    }
});

document.addEventListener('change', async (e) => {
    try {
        if (e.target.id === 'year') {
            const next = Number(e.target.value);
            if (!Number.isInteger(next) || next < 2000 || next > 2200)
                throw Error('Год должен быть от 2000 до 2200.');
            year = next;
            await load();
        }
        if (e.target.id === 'month') { month = Number(e.target.value); render(); }
        if (e.target.id === 'department') { department = e.target.value; render(); }
        if (e.target.id === 'unresolved') { onlyUnresolved = e.target.checked; render(); }
        if (e.target.id === 'search') { search = e.target.value; render(); }
    }
    catch (err) { toast(err.message, true); }
});

(async () => {
    if (location.protocol === 'file:') {
        $('#app').innerHTML = '<div class="login-panel" style="min-height:100vh"><div style="max-width:660px"><h1>Откройте приложение по адресу сервера</h1><p>Файл index.html содержит только интерфейс.</p></div></div>';
        return;
    }

    try {
        const auth = await api('/me');
        me = auth.me;
        csrf = auth.csrf;
        tab = me.role === 'employee' ? 'mine' : 'calendar';
        await load(); // важно
    }
    catch {
        login();
    }
})();
