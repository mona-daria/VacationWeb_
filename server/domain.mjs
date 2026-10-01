import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const check = (condition, message, status = 400) => {
  if (!condition) throw new Problem(status, message);
};

export const hashToken = s => createHash('sha256').update(s).digest('hex');

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password, hash) {
  try {
    const [salt, key] = String(hash || '').split(':');
    const expected = Buffer.from(key, 'hex');
    const actual = scryptSync(String(password || ''), salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Пароль минимум 4 символа
export function validatePassword(p) {
  check(typeof p === 'string' && p.length >= 4 && p.length <= 128, 'Пароль должен содержать от 4 до 128 символов.');
}

export function yearValue(value) {
  const n = Number(value);
  check(Number.isInteger(n) && n >= 2000 && n <= 2200, 'Укажите год от 2000 до 2200.');
  return n;
}

export function validatePeriods(periods, year) {
  check(Array.isArray(periods) && periods.length > 0 && periods.length <= 24, 'Укажите от 1 до 24 периодов отпуска.');
  const valid = s =>
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;

  return periods.map(p => {
    check(p && valid(p.start) && valid(p.end), 'Некорректная дата.');
    check(p.start <= p.end, 'Окончание отпуска не может быть раньше начала.');
    check(Number(p.start.slice(0, 4)) === year && Number(p.end.slice(0, 4)) === year,
      'Период должен находиться в выбранном году. Отпуск на границе годов внесите двумя частями.');
    return { start: p.start, end: p.end };
  }).sort((a, b) => a.start.localeCompare(b.start));
}

export const days = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;

// ВНИМАНИЕ: здесь статус на русском: "согласовано"
export function conflicts(requests, decisions = []) {
  const accepted = new Map(decisions.map(d => [d.key, d]));
  const periods = [];

  for (const r of requests.filter(r => r.status === 'согласовано'))
    r.periods.forEach((p, i) => periods.push({ ...p, r, i }));

  const result = [];
  for (let i = 0; i < periods.length; i++)
    for (let j = i + 1; j < periods.length; j++) {
      let a = periods[i], b = periods[j];
      const start = a.start > b.start ? a.start : b.start;
      const end = a.end < b.end ? a.end : b.end;
      if (start > end) continue;

      if (`${a.r.id}:${a.i}` > `${b.r.id}:${b.i}`) [a, b] = [b, a];
      const key = `${a.r.id}:${a.r.version}:${a.i}|${b.r.id}:${b.r.version}:${b.i}`;

      result.push({
        key,
        a: a.r.id, b: b.r.id,
        a_name: a.r.name, b_name: b.r.name,
        a_department: a.r.department, b_department: b.r.department,
        start, end,
        days: days(start, end),
        same_employee: a.r.user_id === b.r.user_id,
        decision: accepted.get(key) || null
      });
    }

  return result.sort((a, b) => a.start.localeCompare(b.start) || a.a_name.localeCompare(b.a_name));
}

export const publicUser = u => ({
  id: u.id,
  login: u.login,
  name: u.name,
  department: u.department,
  role: u.role,
  manager_id: u.manager_id,
  active: u.active
});
