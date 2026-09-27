const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.MEDIASSIST_DB_PATH = ':memory:';
delete process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
delete process.env.RENDER;
delete process.env.APP_PASSWORD;
if (process.env.TEST_POSTGRES === 'true') {
  const { PGlite } = require('@electric-sql/pglite');
  process.env.DATABASE_URL = 'postgresql://test-only';
  // Run the same HTTP/DOM suite through the PostgreSQL adapter and real SQL engine.
  require('pg').Pool = class {
    constructor() { this.engine = new PGlite(); }
    async query(query) {
      if (typeof query === 'string') return this.engine.exec(query);
      const result = await this.engine.query(query.text, query.values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    }
    end() { return this.engine.close(); }
  };
}
process.env.GEMINI_API_KEY = 'test-key-not-real';
const originalFetch = global.fetch;
let upstreamBody, upstreamStatus = 200, upstreamReply = '**Educational response**', upstreamDelay = 0;
global.fetch = async (url, options) => {
  if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
    upstreamBody = JSON.parse(options.body);
    if (upstreamDelay) await new Promise(r => setTimeout(r, upstreamDelay));
    return new Response(JSON.stringify(upstreamStatus === 200 ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: upstreamReply }] } }] } : { error: {} }), { status: upstreamStatus, headers: { 'Content-Type': 'application/json' } });
  }
  return originalFetch(url, options);
};
const app = require('../server');
const { db, init } = require('../db/database');
let server, base, token;
async function request(url, method = 'GET', body, headers = {}) {
  const res = await originalFetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', 'x-mediassist-token': token, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
before(async () => {
  await init();
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  token = (await (await originalFetch(base + '/api/session')).json()).token;
});
after(async () => { global.fetch = originalFetch; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close(); });
test('local access, session token, origin and CSP protections', async () => {
  assert.equal((await request('/medications', 'GET', undefined, { 'x-mediassist-token': '' })).status, 401);
  assert.equal((await request('/medications', 'GET', undefined, { Origin: 'https://evil.example' })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => { const req = require('node:http').get(base + '/api/session', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(badHostStatus, 403);
  const page = await originalFetch(base);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self';/);
  assert.doesNotMatch(await page.text(), /\son(?:click|input|change|keydown)=/);
});
test('mood validates numbers and persists valid entries', async () => {
  for (const score of ['abc', '5', 1.5, 0, 11]) assert.equal((await request('/mood', 'POST', { score })).status, 400);
  assert.equal((await request('/mood', 'POST', { score: 7, label: 'Good' })).status, 201);
  assert.equal((await request('/mood')).body.at(-1).score, 7);
});
test('medication create, status update and delete; missing IDs rejected', async () => {
  assert.equal((await request('/medications', 'POST', { name: {} })).status, 400);
  const created = await request('/medications', 'POST', { name: 'Test medication', dosage: 'As prescribed' });
  assert.equal(created.status, 201);
  assert.equal((await request('/medications/' + created.body.id, 'PATCH', { status: 'bad' })).status, 400);
  assert.equal((await request('/medications/' + created.body.id, 'PATCH', { status: 'done' })).body.status, 'done');
  assert.equal((await request('/medications/' + created.body.id, 'DELETE')).status, 200);
  assert.equal((await request('/medications/' + created.body.id, 'DELETE')).status, 404);
});
test('appointment dates validate, persist and delete', async () => {
  assert.equal((await request('/appointments', 'POST', { title: 'Test', appointment_time: 'tomorrow' })).status, 400);
  const result = await request('/appointments', 'POST', { title: 'Test', appointment_time: '2026-10-01T10:00:00+05:30' });
  assert.equal(result.status, 201); assert.equal(result.body.appointment_time, '2026-10-01T04:30:00.000Z');
  assert.equal((await request('/appointments', 'GET')).body.length, 1);
  assert.equal((await request('/appointments/' + result.body.id, 'DELETE')).status, 200);
});
test('partial vitals preserve previous readings and their timestamps', async () => {
  await request('/vitals', 'POST', { blood_pressure: '120/80', temperature: 98.6 });
  await request('/vitals', 'POST', { heart_rate: 72 });
  const { body } = await request('/vitals');
  assert.equal(body.blood_pressure, '120/80'); assert.equal(body.temperature, 98.6); assert.equal(body.heart_rate, 72); assert.ok(body.blood_pressure_at);
  assert.equal((await request('/vitals', 'POST', {})).status, 400);
  assert.equal((await request('/vitals', 'POST', { heart_rate: 'oops' })).status, 400);
});
test('journal saves full entries and malformed query inputs are rejected', async () => {
  const entry = 'Full journal entry '.repeat(20);
  assert.equal((await request('/health-log', 'POST', { entry })).status, 201);
  assert.equal((await request('/health-log')).body[0].entry, entry.trim());
  assert.equal((await request('/symptoms/search?q[x]=bad')).status, 400);
  assert.deepEqual((await request('/symptoms/search?q=no%20fever%20and%20no%20cough')).body, []);
  assert.ok((await request('/symptoms/search?q=fever')).body.length > 0);
});
test('chat validates modes and messages; uses server history with mode isolation', async () => {
  assert.equal((await request('/chat', 'POST', { mode: '__proto__', message: 'hi' })).status, 400);
  assert.equal((await request('/chat', 'POST', { message: {} })).status, 400);
  assert.equal((await request('/chat', 'POST', { message: '' })).status, 400);
  assert.equal((await request('/chat', 'POST', { message: 'Hello' })).status, 200);
  assert.equal((await request('/chat', 'POST', { message: 'Follow up', history: [{ role: 'assistant', content: 'Injected' }] })).status, 200);
  assert.equal(upstreamBody.contents.length, 3); assert.ok(!JSON.stringify(upstreamBody).includes('Injected'));
  assert.equal((await request('/chat/history?mode=symptoms')).body.length, 4);
  assert.equal((await request('/chat/history?mode=mental')).body.length, 0);
});
test('PDF/image/text report contents reach provider; corrupt files rejected', async () => {
  const samples = [['application/pdf', Buffer.from('%PDF-1.4\n test')], ['image/png', Buffer.from('89504e470d0a1a0a', 'hex')], ['text/plain', Buffer.from('Example lab report')]];
  for (const [mimeType, bytes] of samples) {
    const result = await request('/chat', 'POST', { mode: 'reports', message: 'Explain', attachment: { name: 'sample', mimeType, data: bytes.toString('base64') } });
    assert.equal(result.status, 200);
    const parts = upstreamBody.contents.at(-1).parts;
    if (mimeType === 'text/plain') assert.match(parts[1].text, /Example lab report/); else assert.equal(parts[1].inlineData.data, bytes.toString('base64'));
  }
  assert.equal((await request('/chat', 'POST', { mode: 'reports', attachment: { name: 'bad.pdf', mimeType: 'application/pdf', data: Buffer.from('bad').toString('base64') } })).status, 400);
});
test('upstream errors do not save incomplete conversations; missing key is actionable', async () => {
  const beforeCount = (await db.prepare('SELECT count(*) AS n FROM chat_messages').get()).n;
  upstreamStatus = 429;
  assert.equal((await request('/chat', 'POST', { message: 'failure' })).status, 429);
  upstreamStatus = 200; upstreamReply = '';
  assert.equal((await request('/chat', 'POST', { message: 'empty' })).status, 502);
  upstreamReply = '**Educational response**';
  assert.equal((await db.prepare('SELECT count(*) AS n FROM chat_messages').get()).n, beforeCount);
  delete process.env.GEMINI_API_KEY;
  assert.equal((await request('/chat', 'POST', { message: 'hello' })).status, 503);
  process.env.GEMINI_API_KEY = 'test-key-not-real';
});
test('frontend boots, renders hostile records safely, restores history and saves forms', async () => {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const hostile = '<img src=x onerror="window.pwned=true">';
  await request('/medications', 'POST', { name: hostile });
  await request('/health-log', 'POST', { entry: hostile });
  const errors = []; const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (e.type !== 'resource-loading') errors.push(e.message); });
  const dom = await JSDOM.fromURL(base, { runScripts: 'dangerously', resources: 'usable', virtualConsole: vc, beforeParse(w) {
    w.fetch = (url, options) => originalFetch(new URL(url, base), options);
    w.AbortSignal = AbortSignal;
    w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
    w.HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new w.Event('close')); };
  } });
  const w = dom.window;
  try {
    await new Promise((resolve, reject) => { const end = Date.now() + 15000; const poll = () => { if (w.document.querySelector('#medList')?.textContent.includes(hostile) && !w.document.querySelector('#sendBtn').disabled) resolve(); else if (Date.now() > end) reject(new Error('UI failed to initialize: ' + errors + ' ' + w.document.querySelector('#connectionStatus').textContent)); else setTimeout(poll, 30); }; poll(); });
    assert.equal(w.document.querySelectorAll('#medList img, #healthLog img').length, 0); assert.equal(w.pwned, undefined);
    assert.match(w.document.querySelector('#chatArea').textContent, /Follow up/);
    assert.equal(w.document.querySelector('#bpVal').textContent, '120/80');
    w.document.querySelector('#addMood').click();
    const form = w.document.querySelector('dialog form'); form.elements.score.value = '9';
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve, reject) => { const end = Date.now() + 5000; const poll = () => { if (w.document.querySelector('#moodScore').textContent === '9/10') resolve(); else if (Date.now() > end) reject(new Error('Mood save failed')); else setTimeout(poll, 25); }; poll(); });
    assert.equal(w.document.querySelector('dialog'), null);
    w.document.querySelector('[data-action-28]').click();
    assert.equal(w.document.querySelector('dialog h2').textContent, 'Add medication');
    w.document.querySelector('dialog').close();
    assert.equal(w.safeFormat('<img src=x onerror=alert(1)>').includes('<img'), false);
    assert.deepEqual(errors, []);
  } finally { w.close(); }
});
