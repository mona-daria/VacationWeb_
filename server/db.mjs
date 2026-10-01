// server/db.mjs
import pg from 'pg';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { postgresOptions } from './config.mjs';

const { Pool } = pg;

export async function postgres() {
  const opt = postgresOptions();

  if (!opt?.databaseUrl) {
    throw new Error(
      'Не найдена строка подключения в config/appsettings.json (ConnectionStrings.DefaultConnection).'
    );
  }

  // SSL настройка:
  // если sslMode=disable — НЕ передаём ssl вообще, иначе PostgreSQL без SSL ответит ошибкой
  let ssl = undefined;
  if (String(opt.sslMode || '').toLowerCase() !== 'disable') {
    ssl = { rejectUnauthorized: true };
    if (opt.caFile) ssl.ca = fs.readFileSync(opt.caFile, 'utf8');
  }

  const pool = new Pool({
    connectionString: opt.databaseUrl,
    ssl
  });

  // Проверка подключения
  await pool.query('SELECT 1');
  // МСК для текущих соединений пула
await pool.query("SET TIME ZONE 'Europe/Moscow'");
  return {
    // Запросы вне транзакций
    query(text, params) {
      return pool.query(text, params);
    },

    // Транзакции — ЭТОГО НЕ ХВАТАЛО
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // tx с таким же интерфейсом query, как ожидает остальной код
        const tx = {
          query: (text, params) => client.query(text, params)
        };

        const result = await fn(tx);

        await client.query('COMMIT');
        return result;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // не скрываем исходную ошибку
        }
        throw e;
      } finally {
        client.release();
      }
    },

    // Закрытие пула
    close() {
      return pool.end();
    }
  };
}

export async function migrate(db) {
  // ВАЖНО: ./schema.sql значит файл должен быть в server/schema.sql
  // Если schema.sql лежит в корне проекта — поменяйте на '../schema.sql'
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.query(sql);
}
