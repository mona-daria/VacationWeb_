import { postgres } from './db.mjs';
// Диагностика только читает базу. Здесь намеренно нет migrate() или INSERT.
let db;
try {
    db = await postgres(process.env.DATABASE_URL);
    const connection = (await db.query('SELECT current_database() AS database, current_user AS db_user, version() AS version')).rows[0];
    const tls = (await db.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0];
    const schema = (await db.query("SELECT to_regclass('public.users') AS users_table, to_regclass('public.plans') AS plans_table")).rows[0];
    console.log(JSON.stringify({ connected: true, ...connection, tls: tls?.ssl || false, schema }, null, 2));
    if (!schema.users_table)
        console.log('Подключение работает. Таблицы еще не созданы: следующий шаг — npm run init.');
}
catch (error) {
    console.error('Проверка подключения не пройдена:', error.code || 'CONFIGURATION', error.message);
    process.exitCode = 1;
}
finally {
    if (db)
        await db.close();
}
