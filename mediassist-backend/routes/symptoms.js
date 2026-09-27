// routes/symptoms.js
const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { findMatches } = require('../db/symptomMatcher');

// List all diseases in the reference database
router.get('/diseases', async (req, res) => {
  res.json(await db.prepare('SELECT * FROM diseases ORDER BY name ASC').all());
});

// Search diseases by free-text symptom description
// e.g. GET /api/symptoms/search?q=fever%20and%20sore%20throat
router.get('/symptoms/search', async (req, res) => {
  if (Object.keys(req.query).some(key => key !== 'q')) return res.status(400).json({ error: 'Only the q text query is supported' });
  const q = req.query.q || '';
  if (typeof q !== 'string' || q.length > 20000) return res.status(400).json({ error: 'Query must be text under 20,000 characters' });
  if (!q.trim()) return res.json([]);
  res.json(await findMatches(q, 5));
});

module.exports = router;
