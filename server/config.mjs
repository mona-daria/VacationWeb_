// server/config.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function loadJsonConfig() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');

  // Можно переопределить путь через: node server/index.mjs --config path/to/appsettings.json
  const idx = process.argv.indexOf('--config');
  const configPath =
    idx !== -1
      ? path.resolve(root, process.argv[idx + 1])
      : path.join(root, 'config', 'appsettings.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${configPath}. Create config/appsettings.json or pass --config <path>.`
    );
  }

  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function parseDotNetConnString(input) {
  const obj = {};
  for (const part of String(input || '').split(';')) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf('=');
    if (i === -1) continue;
    const key = p.slice(0, i).trim().toLowerCase();
    const val = p.slice(i + 1).trim();
    obj[key] = val;
  }
  return obj;
}

function toPgUrlFromDotNet(connString) {
  const c = parseDotNetConnString(connString);

  const host = c.host || c.server || c['data source'];
  const port = c.port || '5432';
  const database = c.database || c['initial catalog'];
  const username = c.username || c.user || c.userid || c['user id'];
  const password = c.password || c.pwd || '';

  if (!host || !database || !username) {
    throw new Error(
      'Invalid ConnectionStrings.DefaultConnection. Expected: Host, Port, Database, Username, Password.'
    );
  }

  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

/**
 * Основная конфигурация приложения (host/port/origin/cookies + db url).
 * Её использует server/index.mjs при создании HTTP сервера.
 */
export function appConfig() {
  const json = loadJsonConfig();

  const connString = json?.ConnectionStrings?.DefaultConnection;
  if (!connString) throw new Error('Missing ConnectionStrings.DefaultConnection in JSON config.');

  const app = json.App || {};

  const host = app.Host ?? '127.0.0.1';
  const port = Number(app.Port ?? 3080);
  if (!Number.isFinite(port) || port <= 0 || port >= 65536) throw new Error('Invalid App.Port');

  const origin = app.Origin ?? `http://${host}:${port}`;
  const cookieSecure = app.CookieSecure ?? origin.startsWith('https://');

  return {
    host,
    port,
    origin,
    cookieSecure
  };
}

/**
 * Опции подключения к Postgres.
 * ЭТОТ экспорт нужен, потому что server/db.mjs делает:
 *   import { postgresOptions } from './config.mjs'
 */
export function postgresOptions() {
  const json = loadJsonConfig();

  const connString = json?.ConnectionStrings?.DefaultConnection;
  if (!connString) throw new Error('Missing ConnectionStrings.DefaultConnection in JSON config.');

  // SSL режимы оставим такими же, как в проекте, только читаем из JSON.
  // Рекомендуется добавить секцию App: DatabaseSsl/DatabaseCaFile, но дадим дефолты.
  const app = json.App || {};
  const sslMode = app.DatabaseSsl ?? 'verify-full'; // 'verify-full' | 'disable'
  const caFile = app.DatabaseCaFile ?? '';

  // ВАЖНО: мы возвращаем DATABASE_URL уже в формате URL, который понимает pg
  const databaseUrl = toPgUrlFromDotNet(connString);

  // Возвращаем структуру, которую ожидает db.mjs.
  // Точное наполнение зависит от db.mjs, но минимум — connectionString/url + ssl настройки.
  return {
    databaseUrl,
    sslMode,
    caFile
  };
}
