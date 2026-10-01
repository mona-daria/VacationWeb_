import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Problem, check, hashToken, verifyPassword, publicUser } from './domain.mjs';
import * as service from './service.mjs';
import { workbook } from './export.mjs';

async function body(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    check(Buffer.byteLength(data) <= 64000, 'Слишком большой запрос.', 413);
  }
  try { return JSON.parse(data || '{}'); }
  catch { throw new Problem(400, 'Некорректный формат запроса.'); }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml']
};

export function createServer(db, config) {
  const { origin, cookieSecure = true } = config;
  check(origin, 'Не задан Origin.');

  const attempts = new Map();
  const cookie = token =>
    `vacation_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 28800 : 0}${cookieSecure ? '; Secure' : ''}`;

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");

    if (cookieSecure)
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');

    try {
      const url = new URL(req.url, origin);
      const path = url.pathname;

      if (req.method === 'GET' && files[path]) {
        const [file, type] = files[path];
        res.writeHead(200, { 'Content-Type': type });
        res.end(await readFile(new URL('../public/' + file, import.meta.url)));
        return;
      }

      if (path === '/api/health' && req.method === 'GET') {
        await db.query('SELECT 1');
        return json(res, 200, { ok: true });
      }

      if (!path.startsWith('/api/'))
        throw new Problem(404, 'Страница не найдена.');

      // Origin-check только на не-GET
      if (!['GET', 'HEAD'].includes(req.method)) {
        check(req.headers.origin === origin, 'Запрос с другого адреса запрещен.', 403);
        check(req.headers['content-type']?.startsWith('application/json'), 'Ожидается JSON.', 415);
      }

      if (path === '/api/login' && req.method === 'POST') {
        const b = await body(req);
        check(typeof b.login === 'string' && typeof b.password === 'string' && b.password.length <= 128, 'Укажите логин и пароль.');

        const now = Date.now();
        for (const [k, v] of attempts)
          if (v.until < now) attempts.delete(k);

        const login = b.login.toLowerCase().trim();
        const keys = ['ip:' + req.socket.remoteAddress, 'login:' + login];

        for (const key of keys)
          check((attempts.get(key)?.count || 0) < (key.startsWith('ip:') ? 100 : 10),
            'Слишком много попыток. Повторите через 15 минут.', 429);

        const user = (await db.query('SELECT * FROM users WHERE login=$1 AND active=true', [login])).rows[0];

        // Constant-cost verification even for unknown login
        const fallback = '00000000000000000000000000000000:' + ('00'.repeat(64));
        const valid = verifyPassword(b.password, user?.password_hash || fallback) && user;

        if (!valid)
          for (const key of keys) {
            const v = attempts.get(key) || { count: 0, until: now + 900000 };
            v.count++;
            attempts.set(key, v);
          }

        check(valid, 'Неверный логин или пароль.', 401);
        attempts.delete('login:' + login);

        const token = randomBytes(32).toString('hex');
        const csrf = randomBytes(24).toString('hex');

        await db.query('DELETE FROM sessions WHERE expires_at < now()');
        await db.query(
          "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
          [hashToken(token), user.id, csrf]
        );

        res.setHeader('Set-Cookie', cookie(token));
        return json(res, 200, { me: publicUser(user), csrf });
      }

      const token = (req.headers.cookie || '')
        .split(';').map(s => s.trim())
        .find(s => s.startsWith('vacation_session='))?.slice(17) || '';

      const session = (await db.query(
        `SELECT s.csrf,u.*
         FROM sessions s
         JOIN users u ON u.id=s.user_id
         WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
        [hashToken(token)]
      )).rows[0];

      check(session, 'Войдите в приложение.', 401);

      if (req.method !== 'GET')
        check(req.headers['x-csrf-token'] === session.csrf, 'Сессия изменилась. Обновите страницу.', 403);

      if (path === '/api/me' && req.method === 'GET')
        return json(res, 200, { me: publicUser(session), csrf: session.csrf });

      if (path === '/api/logout' && req.method === 'POST') {
        await db.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token)]);
        res.setHeader('Set-Cookie', cookie(''));
        return json(res, 200, { ok: true });
      }

      if (path === '/api/state' && req.method === 'GET')
        return json(res, 200, await service.state(db, session, url.searchParams.get('year')));

      if (path === '/api/export' && req.method === 'GET') {
        check(['hr', 'director', 'manager'].includes(session.role), 'Выгрузка доступна руководителю, кадровику и директору.', 403);
        const data = await service.state(db, session, url.searchParams.get('year'));
        const buffer = await workbook(data);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="vacation-plan-${data.year}.xlsx"`
        });
        res.end(Buffer.from(buffer));
        return;
      }

      const snapshot = path.match(/^\/api\/snapshots\/(\d+)$/);
      if (snapshot && req.method === 'GET') {
        check(['hr', 'director'].includes(session.role), 'Недостаточно прав.', 403);
        const row = (await db.query('SELECT * FROM plan_snapshots WHERE id=$1', [snapshot[1]])).rows[0];
        check(row, 'Версия не найдена.', 404);
        const buffer = await workbook({ year: row.year, ...row.data });
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="vacation-plan-${row.year}-v${row.revision}-${row.kind}.xlsx"`
        });
        res.end(Buffer.from(buffer));
        return;
      }

      if (req.method === 'POST') {
        const b = await body(req);
        let value;

        if (path === '/api/requests')
          value = await service.submit(db, session, b);
        else if (/^\/api\/requests\/[^/]+$/.test(path))
          value = await service.requestAction(db, session, path.split('/').at(-1), b);
        else if (path === '/api/conflicts')
          value = await service.conflictAction(db, session, b);
        else if (path === '/api/plan')
          value = await service.planAction(db, session, b);
        else if (path === '/api/users')
          value = await service.saveUser(db, session, b);
        else
          throw new Problem(404, 'Действие не найдено.');

        return json(res, 200, value);
      }

      throw new Problem(404, 'Действие не найдено.');
    }
    catch (e) {
      if (!e.status && e.code !== '23505')
        console.error('Request failed:', e.message);

      if (!res.headersSent)
        json(res, e.status || (e.code === '23505' ? 409 : 500), {
          error: e.status ? e.message : e.code === '23505'
            ? 'Запись с таким логином уже существует.'
            : 'Ошибка сервера. Обратитесь к администратору.'
        });
      else res.end();
    }
  });
}
