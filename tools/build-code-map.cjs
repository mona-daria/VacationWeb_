'use strict';
// Обновить карту после изменения исходников: node tools/build-code-map.cjs
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = ['package.json', 'VacationWeb.njsproj', '.env.example', '.env.local.example'];
for (const folder of ['launcher','server','public','tools','tests']) {
    for (const name of fs.readdirSync(path.join(root, folder))) {
        if (/\.(js|mjs|cjs|sql|html|css|json)$/.test(name)) files.push(folder + '/' + name);
    }
}
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function explain(line) {
    const s = line.trim();
    if (!s) return 'Пустая строка разделяет блоки.';
    if (/^(\/\/|#|\/\*)/.test(s)) return 'Комментарий или пояснение.';
    if (/^import |require\(/.test(s)) return 'Подключение модуля.';
    if (/function |=>/.test(s)) return 'Функция или обработчик; назначение — в DEVELOPER.md.';
    if (/\bcheck\(/.test(s)) return 'Проверка условия и отказ при нарушении.';
    if (/\bawait\b/.test(s)) return 'Ожидание асинхронной операции с файлом, сетью или БД.';
    if (/^return\b/.test(s)) return 'Возврат результата из функции.';
    if (/^if\b|^else\b/.test(s)) return 'Выбор действия по условию.';
    if (/^(for|while)\b/.test(s)) return 'Обработка элементов в цикле.';
    if (/^(try|catch|finally|throw)\b/.test(s)) return 'Обработка ошибок или завершение операции.';
    if (/^(const|let|var)\b/.test(s)) return 'Подготовка значения или объявления.';
    if (/CREATE TABLE|REFERENCES|PRIMARY KEY/.test(s)) return 'SQL: таблица, ограничение или связь.';
    if (/^[{}()[\];, ]+$/.test(s)) return 'Граница блока или выражения.';
    return 'Продолжение выражения, шаблон интерфейса или параметр. Читайте в контексте соседних строк.';
}
const sections = files.map(file => '<details><summary>'+esc(file)+'</summary><table>'+fs.readFileSync(path.join(root,file),'utf8').split('\n').map((line,i)=>'<tr><td>'+(i+1)+'</td><td><pre>'+esc(line)+'</pre></td><td>'+esc(explain(line))+'</td></tr>').join('')+'</table></details>');
fs.writeFileSync(path.join(root,'docs/CODE-MAP.html'),'<!doctype html><html lang="ru"><meta charset="utf-8"><title>Карта кода 1.2.0</title><style>body{font:15px system-ui;margin:24px}summary{cursor:pointer;background:#eaf0f7;padding:12px}details{margin:12px 0}table{border-collapse:collapse;width:100%}td{border:1px solid #ddd;padding:6px;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px Consolas;margin:0}td:last-child{width:28%}</style><h1>Карта исходников 1.2.0</h1><p>Каждая строка приведена с номером и автоматической подсказкой. Полное назначение функций и правила: DEVELOPER.md. После изменений обновите карту командой node tools/build-code-map.cjs. Редактировать нужно исходные файлы.</p>'+sections.join('')+'</html>');
console.log('Code map generated: '+files.length+' files');
