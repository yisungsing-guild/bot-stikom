const { query, validateEntityConsistency } = require('../src/engine/ragEngine');
const q = 'Apa itu Teknologi Informasi?';
function normalizeProgramLabel(label) {
  const t = String(label || '').toLowerCase();
  if (/\b(ti|teknologi\s+informasi|teknologi\s+informasi)\b/.test(t)) return 'TI';
  if (/\b(si|sistem\s+informasi|sistem\s+informasi)\b/.test(t)) return 'SI';
  if (/\b(bd|bisnis\s+digital|bisnis\s+digital)\b/.test(t)) return 'BD';
  if (/\b(sk|sistem\s+komputer|sistem\s+komputer)\b/.test(t)) return 'SK';
  return null;
}
(async () => {
  try {
    const result = await query(q, 12, { answerQuestion: q, minScore: 0, strict: false, returnDebug: true });
    const contexts = result.contexts || [];
    const extracted = contexts.map(c => {
      const text = String(c.chunk || '').toLowerCase();
      const programs = [];
      const re = /(bisnis\s+digital|bd|sistem\s+informasi|si|teknologi\s+informasi|ti|sistem\s+komputer|sk)/gi;
      let m;
      while ((m = re.exec(text))) {
        programs.push({ raw: m[1], canon: normalizeProgramLabel(m[1]) });
      }
      return { id: c.id, filename: c.filename || null, score: c.score, programs, chunk: c.chunk ? c.chunk.slice(0, 280) : '' };
    }).filter(c => c.programs.length > 0);
    console.log(JSON.stringify({ result: { source: result.source, debug: result.debug }, extracted }, null, 2));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
  }
})();