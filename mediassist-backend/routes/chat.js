const router = require('express').Router();
const { db } = require('../db/database');
const { findMatches } = require('../db/symptomMatcher');
const { MODE_PROMPTS } = require('../modePrompts');
const v = require('../validation');
let busy = false;
let requests = [];
function modeOf(mode = 'symptoms') {
  if (typeof mode !== 'string' || !Object.hasOwn(MODE_PROMPTS, mode)) v.bad('Unknown chat mode');
  return mode;
}
router.get('/chat/history', async (req, res) => {
  const mode = modeOf(req.query.mode);
  res.json(await db.prepare('SELECT * FROM (SELECT * FROM chat_messages WHERE mode=? ORDER BY id DESC LIMIT 200) ORDER BY id').all(mode));
});
router.post('/chat', async (req, res, next) => {
  let ownsLock = false;
  try {
    const mode = modeOf(req.body.mode);
    let message = v.text(req.body.message, 'Message', false, 20000) || '';
    const attachment = req.body.attachment;
    const parts = [];
    if (attachment != null) {
      if (mode !== 'reports' || typeof attachment !== 'object') v.bad('Use Report mode for attachments');
      const name = v.text(attachment.name, 'Filename', true, 200);
      const mime = attachment.mimeType;
      if (!['application/pdf', 'image/png', 'image/jpeg', 'text/plain'].includes(mime)) v.bad('Upload a PDF, PNG, JPG or TXT file');
      const data = attachment.data;
      if (typeof data !== 'string' || !data.length || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) v.bad('Invalid attachment encoding');
      const bytes = Buffer.from(data, 'base64');
      if (bytes.length > 5 * 1024 * 1024) v.bad('Report must be at most 5 MB');
      if ((mime === 'application/pdf' && bytes.subarray(0,5).toString() !== '%PDF-') || (mime === 'image/png' && bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') || (mime === 'image/jpeg' && bytes.subarray(0,3).toString('hex') !== 'ffd8ff')) v.bad('File contents do not match its type');
      if (!message) message = 'Please explain this report.';
      if (mime === 'text/plain') {
        if (bytes.length > 100000) v.bad('Text reports must be at most 100 KB');
        parts.push({ text: 'Uploaded report text:\n' + bytes.toString('utf8') });
      } else parts.push({ inlineData: { mimeType: mime, data } });
      message += `\n[Attached report: ${name}]`;
    }
    if (!message) v.bad('Enter a message or attach a report');
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('your-')) return res.status(503).json({ error: 'AI is not configured. Add GEMINI_API_KEY to mediassist-backend/.env and restart. Trackers work without a key.' });
    if (busy) return res.status(429).json({ error: 'A reply is still being generated. Please wait.' });
    requests = requests.filter(t => Date.now() - t < 60000);
    if (requests.length >= 10) return res.status(429).json({ error: 'Please wait a minute before sending more messages.' });
    requests.push(Date.now()); busy = true; ownsLock = true;
    const history = await db.prepare('SELECT role,content FROM (SELECT id,role,content FROM chat_messages WHERE mode=? ORDER BY id DESC LIMIT 20) ORDER BY id').all(mode);
    const matched = mode === 'symptoms' ? await findMatches(message, 3) : [];
    const system = MODE_PROMPTS[mode] + (matched.length ? '\nIllustrative keyword matches (not diagnostic):\n' + matched.map(d => `${d.name}: ${d.symptoms}`).join('\n') : '');
    parts.unshift({ text: message });
    const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), { role: 'user', parts }], generationConfig: { maxOutputTokens: 4096 } })
    });
    if (!response.ok) return res.status(response.status === 429 ? 429 : 502).json({ error: response.status === 429 ? 'Gemini quota reached. Try again later or check your API quota.' : 'Gemini could not answer. Check the API key and GEMINI_MODEL configuration.' });
    const data = await response.json();
    const candidate = data.candidates?.[0];
    let reply = (candidate?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
    if (!reply || (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason))) return res.status(502).json({ error: 'The AI returned no usable answer. Try rephrasing your question.' });
    if (candidate.finishReason === 'MAX_TOKENS') reply += '\n\nResponse reached its length limit. Ask a focused follow-up for more detail.';
    await db.prepare('INSERT INTO chat_messages (mode,role,content) VALUES (?,?,?),(?,?,?)').run(mode, 'user', message, mode, 'assistant', reply);
    res.json({ reply });
  } catch (err) {
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'The AI took too long. Please try again.' });
    next(err);
  } finally { if (ownsLock) busy = false; }
});
module.exports = router;
