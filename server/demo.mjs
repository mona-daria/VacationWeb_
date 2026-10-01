import { embedded, migrate } from './db.mjs';
import { hashPassword } from './domain.mjs';
import { createServer } from './http.mjs';
import { mkdir } from 'node:fs/promises';
import { createServer as createProbe } from 'node:net';
const port = Number(process.env.PORT || 3080);
const origin = `http://127.0.0.1:${port}`;
try {
    const existing = await fetch(origin + '/api/config', { signal: AbortSignal.timeout(1500) });
    if (existing.ok && (await existing.json()).demo) {
        console.log('Демонстрация уже запущена: ' + origin);
        process.exit(0);
    }
}
catch { }
const portAvailable = await new Promise((resolve, reject) => { const probe = createProbe(); probe.once('error', e => e.code === 'EADDRINUSE' ? resolve(false) : reject(e)); probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true))); });
if (!portAvailable) {
    console.log('Порт ' + port + ' уже занят. Используйте открытое окно демонстрации или закройте предыдущий запуск.');
    process.exit(0);
}
// Demonstration data is ephemeral by default; production always uses PostgreSQL.
const dataDirectory = process.env.DEMO_DATA_DIR;
if (dataDirectory)
    await mkdir(dataDirectory, { recursive: true });
const db = await embedded(dataDirectory);
await migrate(db);
const people = [['manager', 'Елена Соколова', 'Разработка', 'manager', null], ['manager2', 'Павел Орлов', 'Продажи', 'manager', null], ['hr', 'Мария Ковалева', 'Кадры', 'hr', null], ['director', 'Александр Волков', 'Дирекция', 'director', null], ['employee', 'Анна Смирнова', 'Разработка', 'employee', 'manager'], ['employee2', 'Иван Петров', 'Разработка', 'employee', 'manager'], ['employee3', 'Ольга Морозова', 'Продажи', 'employee', 'manager2'], ['employee4', 'Дмитрий Лебедев', 'Продажи', 'employee', 'manager2']];
if (!(await db.query('SELECT id FROM users LIMIT 1')).rows.length) {
    await db.transaction(async (tx) => {
        for (const [login, name, department, role, manager] of people)
            await tx.query('INSERT INTO users(id,login,name,department,role,manager_id,password_hash,must_change_password) VALUES($1,$1,$2,$3,$4,$5,$6,false)', [login, name, department, role, manager, hashPassword('DemoVacation2027!')]);
        const year = new Date().getFullYear() + 1;
        await tx.query('INSERT INTO plans(year) VALUES($1)', [year]);
        const rows = [['employee', '07-05', '07-18', 'manager_approved'], ['employee2', '07-12', '07-25', 'manager_approved'], ['employee3', '07-19', '08-01', 'manager_approved'], ['employee4', '08-09', '08-22', 'submitted']];
        for (const [uid, start, end, status] of rows) {
            const manager = people.find(p => p[0] === uid)[4];
            await tx.query('INSERT INTO requests(id,user_id,year,periods,status,manager_by,manager_at) VALUES($1,$2,$3,$4,$5,$6,$7)', ['request-' + uid, uid, year, JSON.stringify([{ start: year + '-' + start, end: year + '-' + end }]), status, status === 'manager_approved' ? manager : null, status === 'manager_approved' ? new Date() : null]);
        }
    });
}
const server = createServer(db, { origin, secure: false, demo: true });
server.listen(port, '127.0.0.1', () => console.log('Демонстрационный режим: ' + origin + ' | Логины: employee, manager, hr, director | Пароль: DemoVacation2027!'));
server.on('error', async (error) => { console.error(error.code === 'EADDRINUSE' ? 'Порт ' + port + ' уже занят. Закройте предыдущую демонстрацию или задайте другой PORT.' : error.message); await db.close(); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.close(async () => { await db.close(); process.exit(0); }));
