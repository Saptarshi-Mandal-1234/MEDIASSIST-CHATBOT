const { test } = require('node:test');
const { spawn } = require('node:child_process');
const path = require('node:path');
test('full application suite on PostgreSQL SQL engine', { timeout: 90000 }, () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--test', path.join(__dirname, 'app.test.js')], { env: { ...process.env, TEST_POSTGRES: 'true' } });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(output)));
}));
