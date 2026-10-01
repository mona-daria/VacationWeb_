import { readFile } from 'node:fs/promises';
// Чистая проверка адреса сайта; выполняется до подключения к базе.
export function appConfig(env = process.env) {
    let parsed;
    try {
        parsed = new URL(env.APP_ORIGIN);
    }
    catch {
        throw new Error('Задайте APP_ORIGIN, например https://vacation.company.example');
    }
    if (env.APP_ORIGIN !== parsed.origin)
        throw new Error('APP_ORIGIN должен содержать только протокол, имя и необязательный порт, без пути и завершающего /.');
    if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('APP_ORIGIN должен быть HTTP или HTTPS.');
    if (env.COOKIE_SECURE !== undefined && !['true', 'false'].includes(env.COOKIE_SECURE))
        throw new Error('COOKIE_SECURE: допустимы true или false.');
    const secure = env.COOKIE_SECURE !== 'false';
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol === 'http:' && (!local || secure))
        throw new Error('HTTP разрешен только для localhost с COOKIE_SECURE=false. Для сотрудников используйте HTTPS.');
    if (parsed.protocol === 'https:' && !secure)
        throw new Error('При HTTPS установите COOKIE_SECURE=true.');
    const port = Number(env.PORT || 3080);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('PORT должен быть целым числом от 1 до 65535.');
    return { origin: parsed.origin, secure, host: env.HOST || '127.0.0.1', port };
}
// Пароль и полный URL не попадают в диагностические сообщения.
export async function postgresOptions(url, env = process.env) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error('Задайте корректный DATABASE_URL в .env.');
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2)
        throw new Error('DATABASE_URL: нужен адрес postgresql://пользователь:пароль@сервер:порт/база.');
    const options = { connectionString: url, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 };
    const mode = env.DATABASE_SSL;
    if (mode !== undefined) {
        if (!['disable', 'verify-full'].includes(mode))
            throw new Error('DATABASE_SSL: допустимы disable или verify-full.');
        if ([...parsed.searchParams.keys()].some(k => k.toLowerCase().startsWith('ssl')))
            throw new Error('Не совмещайте SSL-параметры DATABASE_URL и DATABASE_SSL. Настройте SSL только через DATABASE_SSL и DATABASE_CA_FILE.');
        if (mode === 'disable') {
            if (env.DATABASE_CA_FILE)
                throw new Error('DATABASE_CA_FILE задан, но DATABASE_SSL=disable.');
            options.ssl = false;
        }
        else {
            options.ssl = { rejectUnauthorized: true };
            if (env.DATABASE_CA_FILE)
                options.ssl.ca = await readFile(env.DATABASE_CA_FILE, 'utf8');
        }
    }
    else if (env.DATABASE_CA_FILE)
        throw new Error('Для DATABASE_CA_FILE требуется DATABASE_SSL=verify-full.');
    return options;
}
