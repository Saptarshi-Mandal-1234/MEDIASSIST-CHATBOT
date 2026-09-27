const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { hostingConfig, accessControl } = require('../security');
const env = { NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://example.onrender.com', APP_PASSWORD: 'test-only-long-password', DATABASE_URL: 'postgresql://test-only' };
test('hosted configuration fails closed and requires explicit ephemeral opt-in', () => {
  assert.throws(() => hostingConfig({ NODE_ENV: 'production' }), /APP_ORIGIN/);
  assert.throws(() => hostingConfig({ ...env, APP_PASSWORD: '' }), /APP_PASSWORD/);
  assert.throws(() => hostingConfig({ ...env, DATABASE_URL: '' }), /DATABASE_URL/);
  assert.throws(() => hostingConfig({ ...env, APP_ORIGIN: 'http://example.com' }), /HTTPS/);
  assert.equal(hostingConfig({ ...env, DATABASE_URL: '', ALLOW_EPHEMERAL_STORAGE: 'true' }).ephemeral, true);
  assert.equal(hostingConfig({}).hosted, false);
});
test('hosted authentication protects HTML, API session and records; health stays public', async () => {
  const app = express(); app.get('/healthz', (req, res) => res.json({ status: 'ok' })); app.use(accessControl(hostingConfig(env))); app.use((req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const request = (url, headers = {}) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path: url, headers: { Host: 'example.onrender.com', ...headers } }, res => { res.resume(); resolve({ status: res.statusCode, headers: res.headers }); }); req.on('error', reject);
  });
  const auth = 'Basic ' + Buffer.from('owner:' + env.APP_PASSWORD).toString('base64');
  try {
    assert.equal((await request('/healthz')).status, 200);
    for (const url of ['/', '/api/session', '/api/medications']) assert.equal((await request(url)).status, 401);
    assert.equal((await request('/', { Authorization: auth })).status, 200);
    assert.equal((await request('/', { Authorization: auth, Origin: 'https://example.onrender.com' })).status, 200);
    assert.equal((await request('/', { Authorization: auth, Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/', { Authorization: auth, Host: 'evil.example' })).status, 403);
    assert.equal((await request('/', { Authorization: 'Basic ' + Buffer.from('owner:wrong').toString('base64') })).status, 401);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
