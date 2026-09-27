const router = require('express').Router();
const { db } = require('../db/database');
const v = require('../validation');
const get = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
router.get('/mood', async (req, res) => res.json((await db.prepare('SELECT * FROM mood_logs ORDER BY id DESC LIMIT 7').all()).reverse()));
router.post('/mood', async (req, res) => {
  const score = v.number(req.body.score, 'Mood', 1, 10, true);
  const r = await db.prepare('INSERT INTO mood_logs (score,label,note) VALUES (?,?,?)').run(score, v.text(req.body.label, 'Label'), v.text(req.body.note, 'Note', false, 2000));
  res.status(201).json(await get('mood_logs', r.lastInsertRowid));
});
router.get('/medications', async (req, res) => res.json(await db.prepare('SELECT * FROM medications ORDER BY id DESC').all()));
router.post('/medications', async (req, res) => {
  const b = req.body;
  const r = await db.prepare('INSERT INTO medications (name,dosage,frequency,time_of_day) VALUES (?,?,?,?)').run(v.text(b.name, 'Name', true, 200), v.text(b.dosage, 'Dosage'), v.text(b.frequency, 'Frequency'), v.text(b.time_of_day, 'Time'));
  res.status(201).json(await get('medications', r.lastInsertRowid));
});
router.patch('/medications/:id', async (req, res) => {
  const id = v.id(req.params.id);
  if (!['due', 'done'].includes(req.body.status)) v.bad('Status must be due or done');
  if (!(await db.prepare('UPDATE medications SET status=? WHERE id=?').run(req.body.status, id)).changes) return res.status(404).json({ error: 'Medication not found' });
  res.json(await get('medications', id));
});
router.get('/appointments', async (req, res) => res.json(await db.prepare('SELECT * FROM appointments ORDER BY appointment_time ASC').all()));
router.post('/appointments', async (req, res) => {
  const b = req.body;
  const date = v.text(b.appointment_time, 'Date', true, 100);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date))) v.bad('Choose a valid appointment date and time');
  const r = await db.prepare('INSERT INTO appointments (title,doctor,appointment_time,notes) VALUES (?,?,?,?)').run(v.text(b.title, 'Title', true, 200), v.text(b.doctor, 'Doctor'), new Date(date).toISOString(), v.text(b.notes, 'Notes', false, 2000));
  res.status(201).json(await get('appointments', r.lastInsertRowid));
});
for (const table of ['medications', 'appointments']) router.delete(`/${table}/:id`, async (req, res) => {
  if (!(await db.prepare(`DELETE FROM ${table} WHERE id=?`).run(v.id(req.params.id))).changes) return res.status(404).json({ error: 'Record not found' });
  res.json({ deleted: true });
});
router.get('/health-log', async (req, res) => res.json(await db.prepare('SELECT * FROM health_logs ORDER BY id DESC LIMIT 100').all()));
router.post('/health-log', async (req, res) => {
  const r = await db.prepare('INSERT INTO health_logs (entry,category) VALUES (?,?)').run(v.text(req.body.entry, 'Entry', true, 4000), v.text(req.body.category, 'Category'));
  res.status(201).json(await get('health_logs', r.lastInsertRowid));
});
const fields = ['blood_pressure', 'heart_rate', 'blood_sugar', 'temperature'];
async function latestVitals() {
  const result = {};
  for (const field of fields) {
    const row = await db.prepare(`SELECT ${field} AS value,created_at FROM vitals WHERE ${field} IS NOT NULL ORDER BY id DESC LIMIT 1`).get();
    if (row) { result[field] = row.value; result[field + '_at'] = row.created_at; }
  }
  return result;
}
router.get('/vitals', async (req, res) => res.json(await latestVitals()));
router.post('/vitals', async (req, res) => {
  const values = fields.map(f => req.body[f] ?? null);
  if (values.every(x => x === null)) v.bad('Enter at least one vital reading');
  if (values[0] !== null) {
    if (typeof values[0] !== 'string' || !/^\d{2,3}\/\d{2,3}$/.test(values[0])) v.bad('Blood pressure must look like 120/80');
    const [s, d] = values[0].split('/').map(Number);
    if (s <= d || s > 350 || d > 250) v.bad('Check the blood pressure reading');
  }
  if (values[1] !== null) v.number(values[1], 'Heart rate', 1, 350, true);
  if (values[2] !== null) v.number(values[2], 'Blood sugar', 1, 2000);
  if (values[3] !== null) v.number(values[3], 'Temperature in Fahrenheit', 50, 120);
  await db.prepare('INSERT INTO vitals (blood_pressure,heart_rate,blood_sugar,temperature) VALUES (?,?,?,?)').run(...values);
  res.status(201).json(await latestVitals());
});
module.exports = router;
