import {
  check, Problem, yearValue, validatePeriods, conflicts,
  publicUser, validatePassword, hashPassword
} from './domain.mjs';

export async function event(tx, actor, year, request, action, payload) {
  await tx.query(
    'INSERT INTO audit(actor_id,year,request_id,action,payload) VALUES($1,$2,$3,$4,$5)',
    [actor, year, request, action, JSON.stringify(payload)]
  );
}

async function lockPlan(tx, year) {
  await tx.query('INSERT INTO plans(year) VALUES($1) ON CONFLICT DO NOTHING', [year]);
  return (await tx.query('SELECT * FROM plans WHERE year=$1 FOR UPDATE', [year])).rows[0];
}

async function allRequests(tx, year) {
  return (await tx.query(
    `SELECT r.*, u.name,u.department,u.manager_id,u.active,m.name AS manager_name
     FROM requests r
     JOIN users u ON u.id=r.user_id
     LEFT JOIN users m ON m.id=r.manager_by
     WHERE r.year=$1
     ORDER BY u.department,u.name`,
    [year]
  )).rows;
}

function canManage(user, r) {
  return user.role === 'manager' && r.manager_id === user.id && r.user_id !== user.id;
}
const isHR = u => u.role === 'hr';

const requireComment = b => {
  check(typeof b.comment === 'string' && b.comment.trim().length >= 3 && b.comment.length <= 2000,
    'Добавьте комментарий от 3 до 2000 символов.');
  return b.comment.trim();
};

async function planData(tx, year) {
  const requests = await allRequests(tx, year);
  const decisions = (await tx.query(
    'SELECT d.*,u.name AS actor_name FROM conflict_decisions d JOIN users u ON u.id=d.actor_id WHERE year=$1',
    [year]
  )).rows;
  return { requests, conflicts: conflicts(requests, decisions) };
}

export async function state(db, user, year) {
  year = yearValue(year);
  return db.transaction(async (tx) => {
    let { requests, conflicts: overlaps } = await planData(tx, year);

    const full = ['hr', 'director'].includes(user.role);
    if (!full) {
      requests = requests.filter(r => r.user_id === user.id || canManage(user, r));
      const ids = new Set(requests.map(r => r.id));
      overlaps = overlaps.filter(c => ids.has(c.a) && ids.has(c.b));
    }

    let people = (await tx.query(
      'SELECT id,login,name,department,role,manager_id,active FROM users ORDER BY name'
    )).rows;

    if (!full)
      people = people.filter(p =>
        p.id === user.id ||
        p.id === user.manager_id ||
        (user.role === 'manager' && p.manager_id === user.id)
      );

    const logs = (await tx.query(
      `SELECT a.*,u.name AS actor_name
       FROM audit a LEFT JOIN users u ON u.id=a.actor_id
       WHERE a.year=$1 ORDER BY a.id DESC LIMIT 500`,
      [year]
    )).rows.filter(e => full || e.actor_id === user.id || requests.some(r => r.id === e.request_id));

    const snapshots = full
      ? (await tx.query('SELECT id,year,revision,kind,created_at FROM plan_snapshots WHERE year=$1 ORDER BY id DESC', [year])).rows
      : [];

    return {
      me: publicUser(user),
      year,
      plan: (await tx.query('SELECT * FROM plans WHERE year=$1', [year])).rows[0]
        || { year, revision: 1, status: 'открыт' },
      requests,
      conflicts: overlaps,
      people,
      history: logs,
      snapshots
    };
  });
}

export async function submit(db, user, body) {
  const year = yearValue(body.year);
  const periods = validatePeriods(body.periods, year);

  return db.transaction(async (tx) => {
    const plan = await lockPlan(tx, year);
    check(plan.status === 'открыт', 'План закрыт для изменений. Кадровик должен вернуть его на доработку.', 409);

    const currentUser = (await tx.query('SELECT * FROM users WHERE id=$1', [user.id])).rows[0];
    check(currentUser.manager_id, 'Для вас не назначен руководитель. Обратитесь к кадровику.');

    const boss = (await tx.query('SELECT * FROM users WHERE id=$1', [currentUser.manager_id])).rows[0];
    check(boss?.active && boss.role === 'manager', 'Назначенный руководитель недоступен. Обратитесь к кадровику.');

    const current = (await tx.query('SELECT * FROM requests WHERE user_id=$1 AND year=$2', [user.id, year])).rows[0];
    check((current?.version || 0) === Number(body.version), 'Даты уже изменены. Обновите страницу.', 409);
    check(!current || current.status !== 'согласовано', 'Согласованные даты можно изменить после запроса кадровика или руководителя.', 409);

    let requestId = current?.id;

    if (current) {
      await tx.query(
        "UPDATE requests SET periods=$1,version=version+1,status='отправлено',comment='',manager_by=NULL,manager_at=NULL,updated_at=now() WHERE id=$2",
        [JSON.stringify(periods), requestId]
      );
    } else {
      requestId = (await tx.query(
        "INSERT INTO requests(user_id,year,periods,status) VALUES($1,$2,$3,'отправлено') RETURNING id",
        [user.id, year, JSON.stringify(periods)]
      )).rows[0].id;
    }

    await event(tx, user.id, year, requestId, 'submitted', { before: current?.periods || null, periods, version: (current?.version || 0) + 1 });
    return { id: requestId };
  });
}

export async function requestAction(db, user, requestId, body) {
  check(['approve', 'return'].includes(body.action), 'Неизвестное действие.');

  requestId = Number(requestId);
  const hint = (await db.query('SELECT year FROM requests WHERE id=$1', [requestId])).rows[0];
  check(hint, 'Заявка не найдена.', 404);

  return db.transaction(async (tx) => {
    const plan = await lockPlan(tx, hint.year);
    check(plan.status === 'открыт', 'План закрыт для изменений.', 409);

    const r = (await allRequests(tx, hint.year)).find(r => r.id === requestId);
    check(isHR(user) || canManage(user, r), 'Недостаточно прав.', 403);
    check(r.version === Number(body.version), 'Заявка уже изменена. Обновите страницу.', 409);

    if (body.action === 'approve') {
      check(canManage(user, r), 'Первое согласование выполняет назначенный руководитель.', 403);
      check(r.status === 'отправлено', 'Заявка не ожидает согласования руководителя.', 409);

      await tx.query(
        "UPDATE requests SET status='согласовано',version=version+1,manager_by=$1,manager_at=now(),comment='',updated_at=now() WHERE id=$2",
        [user.id, r.id]
      );
      await event(tx, user.id, r.year, r.id, 'manager_approved', { periods: r.periods, version: r.version + 1 });
    } else {
      check(r.status !== 'пересмотр', 'Заявка уже возвращена на пересмотр.', 409);
      const comment = requireComment(body);

      await tx.query(
        "UPDATE requests SET status='пересмотр',version=version+1,comment=$1,manager_by=NULL,manager_at=NULL,updated_at=now() WHERE id=$2",
        [comment, r.id]
      );
      await event(tx, user.id, r.year, r.id, 'revision_requested', { comment, periods: r.periods, version: r.version + 1 });
    }

    return { ok: true };
  });
}

export async function conflictAction(db, user, body) {
  check(isHR(user), 'Решения по пересечениям принимает кадровик.', 403);

  const year = yearValue(body.year);
  const comment = requireComment(body);

  return db.transaction(async (tx) => {
    const plan = await lockPlan(tx, year);
    check(plan.status === 'открыт', 'План закрыт для изменений.', 409);

    const data = await planData(tx, year);
    const c = data.conflicts.find(c => c.key === body.key);
    check(c, 'Пересечение изменилось. Обновите страницу.', 409);

    if (body.action === 'reopen') {
      await tx.query('DELETE FROM conflict_decisions WHERE year=$1 AND key=$2', [year, c.key]);
    } else {
      check(body.action === 'accept', 'Неизвестное действие.');
      await tx.query(
        `INSERT INTO conflict_decisions(year,key,comment,actor_id)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(year,key) DO UPDATE
         SET comment=excluded.comment,actor_id=excluded.actor_id,created_at=now()`,
        [year, c.key, comment, user.id]
      );
    }

    await event(tx, user.id, year, null, body.action === 'accept' ? 'conflict_accepted' : 'conflict_reopened', { key: c.key, comment });
    return { ok: true };
  });
}

export async function planAction(db, user, body) {
  const year = yearValue(body.year);

  return db.transaction(async (tx) => {
    const plan = await lockPlan(tx, year);
    check(Number(body.revision) === plan.revision, 'Версия плана изменилась. Обновите страницу.', 409);

    const data = await planData(tx, year);

    if (body.action === 'hr_approve') {
      check(isHR(user), 'Недостаточно прав.', 403);
      check(plan.status === 'открыт', 'План уже передан на утверждение.', 409);
      check(data.requests.length > 0, 'В плане пока нет заявок.');
      check(data.requests.every(r => r.status === 'согласовано'), 'Сначала завершите согласование всех заявок у руководителей.');

      const missing = (await tx.query(
        "SELECT name FROM users WHERE active=true AND role='employee' AND id NOT IN (SELECT user_id FROM requests WHERE year=$1)",
        [year]
      )).rows;

      check(!missing.length, 'Не подали даты: ' + missing.map(u => u.name).join(', '));
      check(data.conflicts.every(c => c.decision), 'По каждому пересечению нужно принять решение или пересмотреть даты.');

      await tx.query(
        "UPDATE plans SET status='согласован_кадрами',hr_by=$1,hr_at=now(),director_by=NULL,director_at=NULL WHERE year=$2",
        [user.id, year]
      );
    }
    else if (body.action === 'director_approve') {
      check(user.role === 'director', 'Утверждение доступно генеральному директору.', 403);
      check(plan.status === 'согласован_кадрами', 'Сначала требуется согласование кадровика.', 409);

      await tx.query(
        "UPDATE plans SET status='утвержден',director_by=$1,director_at=now() WHERE year=$2",
        [user.id, year]
      );
    }
    else if (body.action === 'return') {
      check(
        (user.role === 'director' && plan.status === 'согласован_кадрами') ||
        (isHR(user) && plan.status !== 'открыт'),
        'Вернуть план на доработку сейчас нельзя.',
        403
      );

      requireComment(body);

      await tx.query(
        "UPDATE plans SET status='открыт',revision=revision+1,hr_by=NULL,hr_at=NULL,director_by=NULL,director_at=NULL WHERE year=$1",
        [year]
      );
    }
    else throw new Problem(400, 'Неизвестное действие.');

    const updated = (await tx.query('SELECT * FROM plans WHERE year=$1', [year])).rows[0];
    const people = (await tx.query('SELECT id,name FROM users')).rows;

    await tx.query(
      'INSERT INTO plan_snapshots(year,revision,kind,actor_id,data) VALUES($1,$2,$3,$4,$5)',
      [year, plan.revision, body.action, user.id, JSON.stringify({ plan: body.action === 'return' ? plan : updated, ...data, people, comment: body.comment || '' })]
    );

    await event(tx, user.id, year, null, body.action, { revision: plan.revision, comment: body.comment || '' });
    return { ok: true };
  });
}

export async function saveUser(db, user, body) {
  check(isHR(user), 'Управление сотрудниками доступно кадровику.', 403);

  check(typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.length <= 150, 'Укажите имя сотрудника.');
  check(typeof body.login === 'string' && /^[a-zA-Z0-9._@-]{2,80}$/.test(body.login), 'Логин: от 2 до 80 латинских букв, цифр или символов . _ @ -');
  check(['employee', 'manager', 'hr', 'director'].includes(body.role), 'Неизвестная роль.');
  check(typeof body.department === 'string' && body.department.length <= 150, 'Некорректное подразделение.');

  validatePassword(body.password);

  return db.transaction(async (tx) => {
    let managerId = body.manager_id ? Number(body.manager_id) : null;

    if (managerId) {
      const manager = (await tx.query(
        "SELECT * FROM users WHERE id=$1 AND role='manager' AND active=true",
        [managerId]
      )).rows[0];
      check(manager, 'Выберите действующего руководителя.');
    }

    check(body.role !== 'employee' || managerId, 'Для сотрудника необходимо назначить руководителя.');

    const created = (await tx.query(
      `INSERT INTO users(login,name,department,role,manager_id,password_hash,active)
       VALUES($1,$2,$3,$4,$5,$6,true)
       RETURNING id`,
      [
        body.login.toLowerCase(),
        body.name.trim(),
        body.department.trim(),
        body.role,
        managerId,
        hashPassword(body.password)
      ]
    )).rows[0];

    await event(tx, user.id, null, null, 'user_created', { id: created.id, name: body.name, role: body.role });
    return { ok: true };
  });
}
