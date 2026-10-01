import { postgres, migrate } from './db.mjs';
import { createServer } from './http.mjs';
import { appConfig } from './config.mjs';
const config = appConfig();
const db = await postgres(process.env.DATABASE_URL);
await migrate(db);
const server = createServer(db, config);
server.on('error', async (error) => { console.error('Не удалось запустить HTTP-сервер:', error.code || error.message); await db.close(); process.exitCode = 1; });
server.listen(config.port, config.host, () => console.log('План отпусков запущен: ' + config.origin));
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.close(async () => { await db.close(); process.exit(0); }));
