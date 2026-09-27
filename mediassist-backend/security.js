const crypto = require('crypto');
function hostingConfig(env = process.env) {
  const hosted = env.NODE_ENV === 'production' || env.RENDER === 'true';
  const originText = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL;
  let origin;
  if (originText) {
    const url = new URL(originText);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('APP_ORIGIN must be an HTTPS origin, for example https://your-app.onrender.com');
    origin = url.origin;
  }
  if (hosted && !origin) throw new Error('Hosted mode requires APP_ORIGIN or RENDER_EXTERNAL_URL.');
  if (env.APP_PASSWORD && env.APP_PASSWORD.length < 16) throw new Error('APP_PASSWORD must be at least 16 characters when configured.');
  if (hosted && !env.DATABASE_URL && env.ALLOW_EPHEMERAL_STORAGE !== 'true') throw new Error('Set DATABASE_URL for persistent storage, or explicitly set ALLOW_EPHEMERAL_STORAGE=true for a disposable demo.');
  const username = env.APP_USERNAME || 'owner';
  if (username.includes(':')) throw new Error('APP_USERNAME cannot contain a colon.');
  return { hosted, origin, username, password: env.APP_PASSWORD || '', ephemeral: hosted && !env.DATABASE_URL };
}
function accessControl(config) {
  const expected = crypto.createHash('sha256').update(config.username + ':' + config.password).digest();
  let failures = 0, resetAt = Date.now() + 60000;
  return (req, res, next) => {
    const host = req.headers.host || '';
    const expectedOrigin = config.hosted ? config.origin : 'http://' + host;
    if (config.hosted ? host !== new URL(config.origin).host : !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return res.status(403).json({ error: 'Host not allowed' });
    // A normal page navigation from the Render dashboard is cross-site.  Only
    // reject cross-site API calls; those require the page-specific session token.
    if (req.path.startsWith('/api/') && ((req.headers.origin && req.headers.origin !== expectedOrigin) || req.headers['sec-fetch-site'] === 'cross-site')) return res.status(403).json({ error: 'Cross-origin API requests are blocked' });
    if (!config.password) return next();
    if (Date.now() > resetAt) { failures = 0; resetAt = Date.now() + 60000; }
    if (failures >= 30) return res.status(429).set('Retry-After', '60').json({ error: 'Too many login attempts. Try again in a minute.' });
    const match = /^Basic ([A-Za-z0-9+/]+=*)$/.exec(req.headers.authorization || '');
    const supplied = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
    const digest = crypto.createHash('sha256').update(supplied).digest();
    if (!match || !crypto.timingSafeEqual(expected, digest)) {
      if (match) failures++;
      return res.status(401).set('WWW-Authenticate', 'Basic realm="MediAssist private workspace", charset="UTF-8"').json({ error: 'Sign in with the owner username and password.' });
    }
    next();
  };
}
module.exports = { hostingConfig, accessControl };
