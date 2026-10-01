'use strict';
// Читает версии и файлы локально. Не подключается к сети и не читает пароль БД.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
let errors = 0;
function check(ok, message) { console.log((ok ? 'OK   ' : 'FAIL ') + message); if (!ok) errors++; }
console.log('Vacation Web offline 1.2.0');
console.log('Node: ' + process.version + '; ' + process.platform + ' ' + process.arch);
check(Number(process.versions.node.split('.')[0]) === 24, 'Node.js 24 LTS (target 24.21.0)');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
let count = 0;
for (const [location, info] of Object.entries(lock.packages)) {
    if (!location) continue;
    const filename = path.join(root, location, 'package.json');
    try {
        const actual = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (actual.version !== info.version) throw new Error('version ' + actual.version + ' != ' + info.version);
        count++;
    } catch (e) { check(false, location + ': ' + e.message); }
}
console.log('Library entries checked: ' + count);
check(fs.existsSync(path.join(root, 'VacationWeb.sln')), 'VacationWeb.sln');
check(fs.existsSync(path.join(root, 'VacationWeb.njsproj')), 'VacationWeb.njsproj');
check(fs.existsSync(path.join(root, 'launcher/start.js')), 'Visual Studio startup file');
const manifest = path.join(root, 'DEPENDENCIES-SHA256.json');
if (fs.existsSync(manifest)) {
    let checked = 0;
    for (const [file, digest] of Object.entries(JSON.parse(fs.readFileSync(manifest, 'utf8')))) {
        try {
            const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
            if (actual !== digest) throw new Error('checksum differs');
            checked++;
        } catch (e) { check(false, file + ': ' + e.message); }
    }
    console.log('Library file hashes checked: ' + checked);
} else check(false, 'DEPENDENCIES-SHA256.json missing');
console.log(errors ? 'FAILED: restore complete offline ZIP. Do not download individual missing libraries.' : 'PASS. Run Start-Demo.cmd or open VacationWeb.sln.');
process.exitCode = errors ? 1 : 0;
