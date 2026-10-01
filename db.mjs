import { readFile } from 'node:fs/promises';
import { postgresOptions } from './config.mjs';
export async function postgres(url) {
    if (!url)
        throw new Error('Задайте DATABASE_URL в .env');
    const { default: pg } = await import('pg');
    const pool = new pg.Pool(await postgresOptions(url));
    pool.on('error', error => console.error('Ошибка простаивающего подключения PostgreSQL:', error.code || 'UNKNOWN'));
    return { query: (...args) => pool.query(...args), close: () => pool.end(), transaction: async (fn) => {
            const c = await pool.connect();
            try {
                await c.query('BEGIN');
                const value = await fn(c);
                await c.query('COMMIT');
                return value;
            }
            catch (e) {
                await c.query('ROLLBACK');
                throw e;
            }
            finally {
                c.release();
            }
        } };
}
export async function embedded(path) {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(path);
    await db.waitReady;
    return { query: (...args) => db.query(...args), close: () => db.close(), transaction: fn => db.transaction(fn), exec: s => db.exec(s) };
}
export async function migrate(db) {
    const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    // Each statement is compatible with both PostgreSQL and the embedded PostgreSQL test engine.
    await db.transaction(async (tx) => { for (const statement of sql.split(';').filter(s => s.trim()))
        await tx.query(statement); });
}
