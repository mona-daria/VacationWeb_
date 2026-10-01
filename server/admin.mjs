import { postgres, migrate } from './db.mjs';
import { id, hashPassword, validatePassword } from './domain.mjs';
const password = process.env.BOOTSTRAP_PASSWORD;
validatePassword(password);
const db = await postgres(process.env.DATABASE_URL);
try {
    await migrate(db);
    const login = (process.env.BOOTSTRAP_LOGIN || 'hr').toLowerCase();
    await db.query("INSERT INTO users(id,login,name,department,role,password_hash) VALUES($1,$2,$3,'Кадры','hr',$4)", [id(), login, process.env.BOOTSTRAP_NAME || 'Сотрудник кадров', hashPassword(password)]);
    console.log('Учетная запись кадровика создана. При первом входе потребуется смена пароля.');
}
finally {
    await db.close();
}
