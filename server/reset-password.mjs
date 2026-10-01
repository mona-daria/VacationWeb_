import { postgres } from './db.mjs';
import { validatePassword, hashPassword, check } from './domain.mjs';
import { event } from './service.mjs';
validatePassword(process.env.RESET_PASSWORD);
check(process.env.RESET_LOGIN, 'Задайте RESET_LOGIN и RESET_PASSWORD в защищенном .env.');
const db = await postgres(process.env.DATABASE_URL);
try {
    await db.transaction(async (tx) => {
        const user = (await tx.query('SELECT * FROM users WHERE login=$1 FOR UPDATE', [process.env.RESET_LOGIN.toLowerCase()])).rows[0];
        check(user, 'Учетная запись не найдена.', 404);
        await tx.query('UPDATE users SET password_hash=$1,must_change_password=true WHERE id=$2', [hashPassword(process.env.RESET_PASSWORD), user.id]);
        await tx.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
        await event(tx, null, null, null, 'password_reset_by_administrator', { user_id: user.id });
    });
    console.log('Временный пароль установлен; активные сессии завершены.');
}
finally {
    await db.close();
}
