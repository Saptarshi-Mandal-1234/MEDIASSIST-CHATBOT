const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const express = require('express');
const crypto = require('crypto');
const { hostingConfig, accessControl } = require('./security');
const config = hostingConfig();
const { init, db } = require('./db/database');
const app = express();
const token = crypto.randomBytes(32).toString('hex');
app.disable('x-powered-by');
// Render must reach this endpoint without the owner's credentials.
app.get('/healthz', async (req, res) => {
  try { await db.prepare('SELECT 1 AS ok').get(); res.json({ status: 'ok' }); }
  catch { res.status(503).json({ status: 'unavailable' }); }
});
app.use(accessControl(config));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.get('/api/session', (req, res) => res.json({ token, hosted: config.hosted, ephemeralStorage: config.ephemeral, aiConfigured: Boolean(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your-')) }));
app.use('/api', (req, res, next) => {
  if (req.headers['x-mediassist-token'] !== token) return res.status(401).json({ error: 'Reload this page to reconnect securely.' });
  next();
});
app.use(express.json({ limit: '8mb' }));
app.use('/api', (req, res, next) => {
  if (['POST', 'PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({ error: 'A JSON object is required.' });
  next();
});
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'dompurify', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
for (const route of ['chat', 'records', 'symptoms']) app.use('/api', require(`./routes/${route}`));
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Could not complete the request.' : status === 413 ? 'Request too large. Report files must be at most 5 MB.' : err.message });
});
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  init().then(() => {
    const host = config.hosted ? '0.0.0.0' : '127.0.0.1';
    const server = app.listen(port, host, () => console.log(`MediAssist ready on port ${port} (${config.hosted ? 'hosted' : 'local'} mode)`));
    server.on('error', err => { console.error('Could not start server: ' + err.code); process.exit(1); });
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
      server.close(async () => { await db.close(); process.exit(0); });
      setTimeout(() => process.exit(1), 10000).unref();
    });
  }).catch(() => { console.error('Database initialization failed. Check DATABASE_URL and database availability.'); process.exit(1); });
}
module.exports = app;
