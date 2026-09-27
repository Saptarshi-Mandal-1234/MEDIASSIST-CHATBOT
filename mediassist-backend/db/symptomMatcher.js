// db/symptomMatcher.js
// Very simple keyword-overlap matcher: takes free text from the user,
// compares it against the symptoms column of every seeded disease,
// and returns the best few matches. This is intentionally simple
// (no ML/embeddings) — just word-overlap scoring — but it's enough
// to ground the AI's answer in real reference data rather than letting
// it guess from training knowledge alone.

const { db } = require('./database');

const STOPWORDS = new Set([
  'i', 'a', 'an', 'the', 'and', 'or', 'but', 'have', 'has', 'had',
  'my', 'me', 'is', 'are', 'was', 'were', 'feel', 'feeling', 'felt',
  'since', 'for', 'with', 'of', 'in', 'on', 'to', 'it', 'this', 'that',
  'be', 'been', 'very', 'really', 'also', 'some', 'days', 'day', 'past'
]);

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z]+/g) || [])
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

async function findMatches(userText, limit = 3) {
  // Conservatively skip reference suggestions when negation is present.
  // Keyword overlap cannot safely determine its clinical scope.
  if (/\b(no|not|without|denies|deny|never|don't|doesn't|haven't|hasn't)\b/i.test(userText)) return [];
  const userTokens = new Set(tokenize(userText));
  if (userTokens.size === 0) return [];

  const diseases = await db.prepare('SELECT * FROM diseases').all();

  const scored = diseases.map(d => {
    const symptomTokens = new Set(tokenize(d.symptoms));
    let overlap = 0;
    for (const t of symptomTokens) if (userTokens.has(t)) overlap++;
    return { ...d, score: overlap };
  });

  return scored
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { findMatches };
