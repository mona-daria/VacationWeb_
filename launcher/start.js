// Совместимая с VS2019 точка запуска; основное приложение использует модули .mjs.
'use strict';
var path = require('node:path');
var url = require('node:url');
var fs = require('node:fs');
var root = path.resolve(__dirname, '..');
process.chdir(root);
var major = Number(process.versions.node.split('.')[0]);
if (major !== 24) {
    console.error('Use Node.js 24 LTS. Target environment: 24.21.0. Selected: ' + process.version);
    process.exit(1);
}
var mode = process.argv[2] || '--demo';
Promise.resolve().then(function () {
    if (mode !== '--demo' && mode !== '--postgres') throw new Error('Use --demo or --postgres.');
    if (!fs.existsSync(path.join(root, 'node_modules', 'pg', 'package.json'))) {
        throw new Error('Libraries missing. Extract the WHOLE offline ZIP including node_modules. Do not run npm ci.');
    }
    if (mode === '--postgres') {
        if (!fs.existsSync(path.join(root, '.env'))) throw new Error('Create .env from .env.example and configure PostgreSQL first.');
        process.loadEnvFile(path.join(root, '.env'));
    }
    var file = mode === '--demo' ? 'demo.mjs' : 'index.mjs';
    return import(url.pathToFileURL(path.join(root, 'server', file)).href);
}).catch(function (error) {
    console.error(error.message);
    process.exitCode = 1;
});
