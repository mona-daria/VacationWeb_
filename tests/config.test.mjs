import test from 'node:test';
import assert from 'node:assert/strict';
import { appConfig, postgresOptions } from '../server/config.mjs';
test('App origin must match the actual browser origin', () => {
    assert.equal(appConfig({ APP_ORIGIN: 'https://vacation.example' }).secure, true);
    assert.equal(appConfig({ APP_ORIGIN: 'http://127.0.0.1:3080', COOKIE_SECURE: 'false' }).secure, false);
    for (const env of [{ APP_ORIGIN: 'https://vacation.example/' }, { APP_ORIGIN: 'https://vacation.example/path' }, { APP_ORIGIN: 'http://vacation.example', COOKIE_SECURE: 'false' }, { APP_ORIGIN: 'https://vacation.example', COOKIE_SECURE: 'false' }, { APP_ORIGIN: 'https://vacation.example', PORT: 'bad' }, { APP_ORIGIN: 'http://127.0.0.1:3080' }])
        assert.throws(() => appConfig(env));
});
test('PostgreSQL configuration keeps certificate checks and rejects ambiguous settings', async () => {
    const url = 'postgresql://test:placeholder@db.example:5432/test';
    const secure = await postgresOptions(url, { DATABASE_SSL: 'verify-full' });
    assert.equal(secure.ssl.rejectUnauthorized, true);
    assert.equal(secure.connectionTimeoutMillis, 5000);
    assert.equal((await postgresOptions(url, { DATABASE_SSL: 'disable' })).ssl, false);
    await assert.rejects(postgresOptions(url + '?sslmode=require', { DATABASE_SSL: 'verify-full' }));
    await assert.rejects(postgresOptions(url, { DATABASE_SSL: 'disable', DATABASE_CA_FILE: 'missing.pem' }));
    await assert.rejects(postgresOptions(url, { DATABASE_SSL: 'invalid' }));
    await assert.rejects(postgresOptions('invalid-secret-value', {}), e => !e.message.includes('invalid-secret-value'));
});
