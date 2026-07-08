const fs = require('fs');
const path = require('path');
const ragPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
function normalizeIndonesianQuestionText(raw) {
  let t = String(raw || '').toLowerCase();
  if (!t.trim()) return '';
  t = t
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const repl = [
    [/\byg\b/g, 'yang'],[/\bdmn\b/g, 'di mana'],[/\bgmn\b/g, 'bagaimana'],[/\bbrp\b/g, 'berapa'],[/\butk\b/g, 'untuk'],[/\bdr\b/g, 'dari'],[/\bdpt\b/g, 'dapat'],[/\btdk\b/g, 'tidak'],[/\bgk\b/g, 'tidak'],[/\bga\b/g, 'tidak'],[/\bgak\b/g, 'tidak'],[/\bnggak\b/g, 'tidak'],[/\benggak\b/g, 'tidak'],[/\btrs\b/g, 'terus'],[/\btrus\b/g, 'terus'],[/\budh\b/g, 'sudah'],[/\budah\b/g, 'sudah'],[/\baja\b/g, 'saja'],[/\bbgt\b/g, 'banget'],[/\bpls\b/g, 'tolong'],[/\bplis\b/g, 'tolong'],[/\bpliss\b/g, 'tolong'],[/\bmin\b/g, 'admin']
  ];
  for (const [re,to] of repl) t = t.replace(re,to);
  t = t.replace(/([a-z])\1{2,}/g,'$1$1');
  t = t.replace(/\b(kak|kakak|kaka|dong|deh|nih|yaa|ya|yah|hehe|wkwk|admin)\b/g,' ').replace(/\s{2,}/g,' ').trim();
  return t;
}
function tokenizeForRelevanceGuard(text) {
  const t = normalizeIndonesianQuestionText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!t) return [];
  const stop = new Set(['yang','dan','atau','di','ke','dari','untuk','dengan','apa','itu','ini','itu','kak','min','dong','ya','yaa','yah','nih','nya','gimana','bagaimana','berapa','kapan','dimana','mana','tolong','mohon','saya','kami','aku','mau','ingin','pengen','pengin','bisa','boleh','tanya']);
  const parts = t.split(' ').filter(Boolean);
  const specialTokens = new Set(['si','ti','bd','sk','mi','dkv','trpl','tk','mm','an','dg','rpl','dnui','utb','help','s2','d3']);
  const out = [];
  for (const p of parts) {
    if (p.length < 3 && !specialTokens.has(p)) continue;
    if (stop.has(p)) continue;
    out.push(p);
  }
  return Array.from(new Set(out)).slice(0,12);
}

(async function(){
  const raw = fs.readFileSync(ragPath, 'utf-8');
  const idx = JSON.parse(raw || '[]');
  const hobbyChunks = idx.filter(it => it && it.filename && /hobi|hoby|HOBY/i.test(it.filename));
  console.log('HOBY chunks found:', hobbyChunks.length);
  const q = 'Hobi saya suka ngoding cocok jurusan apa?';
  console.log('Query tokens:', tokenizeForRelevanceGuard(q));
  const lowers = ['ngoding','coding','ngod','programming','pemrograman'];
  for (const c of hobbyChunks.slice(0,20)) {
    const txt = String(c.chunk||'');
    const lower = txt.toLowerCase();
    for (const term of lowers) {
      if (lower.includes(term)) {
        console.log('\n--- CHUNK id=', c.id, 'program=', c.program, 'filename=', c.filename);
        const lines = txt.split('\n').map(s=>s.trim()).filter(Boolean);
        for (let i=0;i<lines.length;i++){
          if (lines[i].toLowerCase().includes(term)) console.log('LINE',i+1,':',lines[i].substring(0,300));
        }
        break;
      }
    }
  }
})();
