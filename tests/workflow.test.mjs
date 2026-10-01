import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { embedded, migrate } from '../server/db.mjs';
import { hashPassword, conflicts, validatePeriods } from '../server/domain.mjs';
import { createServer } from '../server/http.mjs';
test('Inclusive overlaps: all departments, self-overlaps, stale decisions and leap dates', () => {
    const r = (id, periods) => ({ id, user_id: id, name: id, department: id, status: 'manager_approved', version: 1, periods });
    const a = r('a', [{ start: '2028-02-28', end: '2028-02-29' }]), b = r('b', [{ start: '2028-02-29', end: '2028-03-03' }]);
    assert.equal(conflicts([a, b])[0].days, 1);
    const old = conflicts([a, b])[0].key;
    b.version = 2;
    assert.equal(conflicts([a, b], [{ key: old }])[0].decision, null);
    a.periods.push({ ...a.periods[0] });
    assert.equal(conflicts([a])[0].same_employee, true);
    assert.equal(conflicts([{ ...a, status: 'submitted' }, b]).length, 0);
    assert.throws(() => validatePeriods([{ start: '2027-02-29', end: '2027-03-01' }], 2027));
    assert.throws(() => validatePeriods([{ start: '2027-12-30', end: '2028-01-03' }], 2027));
    assert.throws(() => validatePeriods([{ start: '2027-07-10', end: '2027-07-09' }], 2027));
});
test('HTTP workflow with actual PostgreSQL engine, permissions and archived exports', async (t) => {
    const db = await embedded();
    await migrate(db);
    const password = 'TestingPassword2027!';
    for (const [id, role, manager] of [['m', 'manager', null], ['m2', 'manager', null], ['hr', 'hr', null], ['ceo', 'director', null], ['a', 'employee', 'm'], ['b', 'employee', 'm2']])
        await db.query('INSERT INTO users(id,login,name,department,role,manager_id,password_hash,must_change_password) VALUES($1,$1,$1,$1,$2,$3,$4,false)', [id, role, manager, hashPassword(password)]);
    const origin = 'http://127.0.0.1:3091';
    const server = createServer(db, { origin, secure: false });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    t.after(async () => { await new Promise(r => server.close(r)); await db.close(); });
    const clients = {};
    async function call(who, path, body, override = {}) {
        const client = clients[who] || {};
        const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: client.cookie || '', 'X-CSRF-Token': client.csrf || '', ...override }, body: body === undefined ? undefined : JSON.stringify(body) });
        const content = res.headers.get('content-type') || '';
        return { status: res.status, data: content.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), cookie: res.headers.get('set-cookie')?.split(';')[0] };
    }
    async function login(who, pw = password) { const r = await call(who, '/login', { login: who, password: pw }); assert.equal(r.status, 200); clients[who] = { cookie: r.cookie, csrf: r.data.csrf }; return r; }
    const state = async (who = 'hr') => (await call(who, '/state?year=2027')).data;
    const period = (start, end) => [{ start: '2027-' + start, end: '2027-' + end }];
    let a, b;
    await t.test('Authentication and request forgery protection', async () => {
        assert.equal((await call('anonymous', '/state?year=2027')).status, 401);
        assert.equal((await call('bad', '/login', { login: 'nobody', password })).status, 401);
        for (const id of ['m', 'm2', 'hr', 'ceo', 'a', 'b'])
            await login(id);
        assert.equal((await call('a', '/requests', { year: 2027, version: 0, periods: period('07-01', '07-14') }, { Origin: 'http://attacker.example' })).status, 403);
        assert.equal((await call('a', '/requests', { year: 2027, version: 0, periods: period('07-01', '07-14') }, { 'X-CSRF-Token': 'bad' })).status, 403);
    });
    await t.test('Employees submit; concurrent stale changes are rejected', async () => {
        assert.equal((await call('a', '/requests', { year: 2027, version: 0, periods: period('07-01', '07-14') })).status, 200);
        assert.equal((await call('b', '/requests', { year: 2027, version: 0, periods: period('07-14', '07-28') })).status, 200);
        a = (await state('a')).requests[0];
        b = (await state('b')).requests[0];
        assert.equal((await state('a')).requests.length, 1);
        assert.equal((await call('a', '/requests', { year: 2027, version: 0, periods: period('08-01', '08-14') })).status, 409);
    });
    await t.test('Only assigned managers approve; dates reach common plan afterwards', async () => {
        assert.equal((await state()).conflicts.length, 0);
        assert.equal((await call('a', '/requests/' + a.id, { action: 'approve', version: a.version })).status, 403);
        assert.equal((await call('m2', '/requests/' + a.id, { action: 'approve', version: a.version })).status, 403);
        assert.equal((await call('hr', '/requests/' + a.id, { action: 'approve', version: a.version })).status, 403);
        assert.equal((await call('m', '/requests/' + a.id, { action: 'approve', version: a.version })).status, 200);
        assert.equal((await call('m2', '/requests/' + b.id, { action: 'approve', version: b.version })).status, 200);
        const s = await state();
        assert.equal(s.conflicts.length, 1);
        assert.equal(s.conflicts[0].days, 1);
        assert.equal((await state('m')).requests.length, 1);
        assert.equal((await call('hr', '/plan', { year: 2027, revision: 1, action: 'hr_approve' })).status, 400);
        assert.equal((await call('ceo', '/plan', { year: 2027, revision: 1, action: 'director_approve' })).status, 409);
    });
    await t.test('Accepted overlaps remain visible; revisions invalidate the prior decision', async () => {
        let s = await state();
        const old = s.conflicts[0].key;
        assert.equal((await call('hr', '/conflicts', { year: 2027, key: old, action: 'accept', comment: 'Допустимое совпадение' })).status, 200);
        assert.ok((await state()).conflicts[0].decision);
        a = (await state('a')).requests[0];
        assert.equal((await call('hr', '/requests/' + a.id, { action: 'return', version: a.version, comment: 'Уточните даты с руководителем' })).status, 200);
        a = (await state('a')).requests[0];
        assert.equal(a.status, 'revision');
        assert.equal((await call('hr', '/plan', { year: 2027, revision: 1, action: 'hr_approve' })).status, 400);
        assert.equal((await call('a', '/requests', { year: 2027, version: a.version, periods: period('07-02', '07-14') })).status, 200);
        a = (await state('a')).requests[0];
        assert.equal(a.status, 'submitted');
        assert.equal((await call('m', '/requests/' + a.id, { action: 'approve', version: a.version })).status, 200);
        s = await state();
        assert.notEqual(s.conflicts[0].key, old);
        assert.equal(s.conflicts[0].decision, null);
        assert.equal((await call('hr', '/conflicts', { year: 2027, key: old, action: 'accept', comment: 'Старое решение' })).status, 409);
    });
    await t.test('HR then CEO approval freezes the exact plan, producing valid Excel', async () => {
        let s = await state();
        await call('hr', '/conflicts', { year: 2027, key: s.conflicts[0].key, action: 'accept', comment: 'Повторно согласовано кадровиком' });
        assert.equal((await call('hr', '/plan', { year: 2027, revision: 1, action: 'hr_approve' })).status, 200);
        a = (await state('a')).requests[0];
        assert.equal((await call('hr', '/requests/' + a.id, { action: 'return', version: a.version, comment: 'После согласования' })).status, 409);
        assert.equal((await call('ceo', '/plan', { year: 2027, revision: 1, action: 'director_approve' })).status, 200);
        s = await state();
        assert.equal(s.plan.status, 'approved');
        assert.equal(s.snapshots.length, 2);
        const out = await call('hr', '/export?year=2027');
        assert.equal(out.status, 200);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(out.data);
        assert.equal(book.getWorksheet('Все пересечения').rowCount, 2);
        assert.equal(book.getWorksheet('План отпусков').getCell('C2').value, '2027-07-02');
        assert.equal((await call('a', '/export?year=2027')).status, 403);
    });
    await t.test('Reopening creates a new revision and preserves the approved snapshot', async () => {
        const before = (await state()).snapshots.find(s => s.kind === 'director_approve');
        assert.equal((await call('hr', '/plan', { year: 2027, revision: 1, action: 'return', comment: 'Изменение после утверждения' })).status, 200);
        assert.equal((await state()).plan.revision, 2);
        assert.equal((await call('hr', '/plan', { year: 2027, revision: 1, action: 'hr_approve' })).status, 409);
        a = (await state('a')).requests[0];
        await call('hr', '/requests/' + a.id, { action: 'return', version: a.version, comment: 'Перенос на август' });
        a = (await state('a')).requests[0];
        await call('a', '/requests', { year: 2027, version: a.version, periods: period('08-01', '08-14') });
        const out = await call('hr', '/snapshots/' + before.id);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(out.data);
        assert.equal(book.getWorksheet('План отпусков').getCell('C2').value, '2027-07-02');
        assert.equal((await call('a', '/snapshots/' + before.id)).status, 403);
        assert.ok((await state()).history.some(e => e.action === 'revision_requested'));
    });
    await t.test('New accounts must replace temporary passwords and prior sessions expire', async () => {
        const newUser = { name: 'Новый сотрудник', login: 'new', department: 'Отдел', role: 'employee', manager_id: 'm', password };
        assert.equal((await call('a', '/users', newUser)).status, 403);
        assert.equal((await call('hr', '/users', newUser)).status, 200);
        assert.equal((await call('hr', '/users', newUser)).status, 409);
        await login('new');
        assert.equal((await call('new', '/state?year=2027')).status, 403);
        assert.equal((await call('new', '/password', { current: password, password: 'UpdatedPassword2027!' })).status, 200);
        assert.equal((await call('new', '/me')).status, 401);
        await login('new', 'UpdatedPassword2027!');
        assert.equal((await call('new', '/state?year=2027')).status, 200);
    });
    await t.test('Successful logins from a shared proxy address do not exhaust the failure limit', async () => {
        for (let i = 0; i < 105; i++)
            await login('hr');
        assert.equal((await call('hr', '/state?year=2027')).status, 200);
    });
});
