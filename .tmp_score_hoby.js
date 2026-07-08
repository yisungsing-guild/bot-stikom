const fs = require('fs');
const path = require('path');
function normalizeIndonesianQuestionText(raw) {
  let t = String(raw || '').toLowerCase();
  if (!t.trim()) return '';
  t = t
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const repl = [
    [/\byg\b/g, 'yang'],
    [/\bdmn\b/g, 'di mana'],
    [/\bgmn\b/g, 'bagaimana'],
    [/\bbrp\b/g, 'berapa'],
    [/\butk\b/g, 'untuk'],
    [/\bdr\b/g, 'dari'],
    [/\bdpt\b/g, 'dapat'],
    [/\btdk\b/g, 'tidak'],
    [/\bgk\b/g, 'tidak'],
    [/\bga\b/g, 'tidak'],
    [/\bgak\b/g, 'tidak'],
    [/\bnggak\b/g, 'tidak'],
    [/\benggak\b/g, 'tidak'],
    [/\btrs\b/g, 'terus'],
    [/\btrus\b/g, 'terus'],
    [/\budh\b/g, 'sudah'],
    [/\budah\b/g, 'sudah'],
    [/\baja\b/g, 'saja'],
    [/\bbgt\b/g, 'banget'],
    [/\bpls\b/g, 'tolong'],
    [/\bplis\b/g, 'tolong'],
    [/\bpliss\b/g, 'tolong'],
    [/\bmin\b/g, 'admin'],
    [/\bngoding\b/g, 'coding'],
    [/\bngod\b/g, 'coding'],
  ];
  for (const [re, to] of repl) t = t.replace(re, to);
  t = t.replace(/([a-z])\1{2,}/g, '$1$1');
  t = t.replace(/\b(kak|kakak|kaka|dong|deh|nih|yaa|ya|yah|hehe|wkwk|admin)\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t;
}
function tokenizeForRelevanceGuard(text) {
  const t = normalizeIndonesianQuestionText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!t) return [];
  const stop = new Set(['yang','dan','atau','di','ke','dari','untuk','dengan','apa','itu','ini','itu','kak','min','dong','ya','yaa','yah','nih','nya','gimana','bagaimana','berapa','kapan','dimana','mana','tolong','mohon','saya','kami','aku','mau','ingin','pengen','pengin','bisa','boleh','tanya']);
  const specialTokens = new Set(['si','ti','bd','sk','mi','dkv','trpl','tk','mm','an','dg','rpl','dnui','utb','help','s2','d3']);
  const parts = t.split(' ').filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length < 3 && !specialTokens.has(p)) continue;
    if (stop.has(p)) continue;
    out.push(p);
  }
  return Array.from(new Set(out)).slice(0,12);
}
function scoreProgramsFromHobbyLines(hobbyText, questionText) {
  const text = String(hobbyText || '').replace(/\r\n/g, '\n');
  const qNorm = normalizeIndonesianQuestionText(questionText);
  const qTokens = tokenizeForRelevanceGuard(qNorm);
  if (!text.trim() || qTokens.length === 0) return null;
  const programs = [
    { key: 'bd', label: 'Bisnis Digital', names: ['bisnis digital', 'bd'] },
    { key: 'si', label: 'Sistem Informasi', names: ['sistem informasi', 'si'] },
    { key: 'ti', label: 'Teknologi Informasi', names: ['teknologi informasi', 'ti'] },
    { key: 'sk', label: 'Sistem Komputer', names: ['sistem komputer', 'sk'] }
  ];
  const scores = new Map(programs.map(p=>[p.key,0]));
  const evidences = new Map(programs.map(p=>[p.key,[]]));
  const lines = text.split('\n').map(s=>String(s||'').replace(/\s+/g,' ').trim()).filter(Boolean);
  for (const lineRaw of lines) {
    const line = normalizeIndonesianQuestionText(lineRaw);
    if (!line) continue;
    const abbrevHits = [' bd ', ' si ', ' ti ', ' sk '].filter(a => (` ${line} `).includes(a)).length;
    if (abbrevHits >= 3 && line.length < 40) continue;
    const matchedPrograms = programs.filter(p => p.names.some(nm => (` ${line} `).includes(` ${nm} `) || line.includes(nm)));
    if (matchedPrograms.length === 0) continue;
    let hit = 0;
    for (const t of qTokens) if (t && line.includes(t)) hit += 1;
    if (hit <= 0) continue;
    const cov = hit / Math.max(3, qTokens.length);
    const minCov = parseFloat(process.env.RAG_HOBY_LINE_MIN_COVERAGE || '0.18');
    if (!(cov >= minCov)) continue;
    for (const p of matchedPrograms) {
      scores.set(p.key, (scores.get(p.key) || 0) + cov);
      const evList = evidences.get(p.key) || [];
      if (evList.length < 6) evList.push(lineRaw);
      evidences.set(p.key, evList);
    }
  }
  const ranked = programs.map(p=>({p, score:scores.get(p.key)||0, ev:evidences.get(p.key)||[]})).sort((a,b)=>b.score-a.score);
  const best = ranked[0];
  const second = ranked[1];
  const margin = parseFloat(process.env.RAG_HOBY_LINE_MIN_MARGIN || '0.08');
  const minScore = parseFloat(process.env.RAG_HOBY_LINE_MIN_SCORE || '0.22');
  if (!best || best.score < minScore) return null;
  if (second && (best.score - second.score) < margin) return null;
  const ev = best.ev.map(s=>String(s||'').replace(/\s+/g,' ').trim()).filter(Boolean);
  return { key: best.p.key, label: best.p.label, evidence: ev.slice(0,3), scores: ranked.map(r=>({key:r.p.key,label:r.p.label,score:r.score,ev:r.ev})) };
}
const srcPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
const idx = JSON.parse(fs.readFileSync(srcPath,'utf8'));
const hobbyNameRe = /\b(hobi|hoby)\b/i;
const strongHobbyContentRe = /\bhobi\s+(?:siswa\s+)?yang\s+memilih\b/i;
const hobbyItems = idx.filter(it => it && it.chunk && ( (it.filename && hobbyNameRe.test(it.filename)) || strongHobbyContentRe.test(String(it.chunk)) ));
const exactHobyPdf = hobbyItems.filter(it => it && it.filename && /\bhoby\.pdf\b/i.test(String(it.filename)));
const byTraining = new Map();
for (const it of exactHobyPdf) {
  const tid = it.trainingId ? String(it.trainingId) : '';
  const key = tid ? `t:${tid}` : `f:${it.filename ? String(it.filename).toLowerCase() : 'unknown'}`;
  if (!byTraining.has(key)) byTraining.set(key, []);
  byTraining.get(key).push(it);
}
const groups = Array.from(byTraining.values()).map(items=>({items,n:items.length,latest:items.reduce((acc,it)=>{const ts=it.createdAt?Date.parse(String(it.createdAt)):0;return ts>acc?ts:acc;},0)}));
groups.sort((a,b)=>(b.n-a.n)||(b.latest-a.latest));
const best = groups[0];
const combined = best.items.map(it=>String(it.chunk||'')).join('\n');
console.log(scoreProgramsFromHobbyLines(combined, 'hoby saya suka ngoding cocok jurusan apa?'));
