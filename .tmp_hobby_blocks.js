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
    [/\byg\b/g, 'yang'],[/\bdmn\b/g, 'di mana'],[/\bgmn\b/g, 'bagaimana'],[/\bbrp\b/g, 'berapa'],[/\butk\b/g, 'untuk'],[/\bdr\b/g, 'dari'],[/\bdpt\b/g, 'dapat'],[/\btdk\b/g, 'tidak'],[/\bgk\b/g, 'tidak'],[/\bga\b/g, 'tidak'],[/\bgak\b/g, 'tidak'],[/\bnggak\b/g, 'tidak'],[/\benggak\b/g, 'tidak'],[/\btrs\b/g, 'terus'],[/\btrus\b/g, 'terus'],[/\budh\b/g, 'sudah'],[/\budah\b/g, 'sudah'],[/\baja\b/g, 'saja'],[/\bbgt\b/g, 'banget'],[/\bpls\b/g, 'tolong'],[/\bplis\b/g, 'tolong'],[/\bpliss\b/g, 'tolong'],[/\bmin\b/g, 'admin'],[/\bngoding\b/g, 'coding'],[/\bngod\b/g, 'coding']
  ];
  for (const [re,to] of repl) t = t.replace(re,to);
  t = t.replace(/([a-z])\1{2,}/g,'$1$1');
  t = t.replace(/\b(kak|kakak|kaka|dong|deh|nih|yaa|ya|yah|hehe|wkwk|admin)\b/g,' ').replace(/\s{2,}/g,' ').trim();
  return t;
}
function splitHobbyTextIntoProgramBlocks(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return [];
  const programs = [
    { key: 'bd', label: 'Bisnis Digital', names: ['bisnis digital', 'bd'] },
    { key: 'si', label: 'Sistem Informasi', names: ['sistem informasi', 'si'] },
    { key: 'ti', label: 'Teknologi Informasi', names: ['teknologi informasi', 'ti'] },
    { key: 'sk', label: 'Sistem Komputer', names: ['sistem komputer', 'sk'] }
  ];
  const headingRe = /(hobi\s+(?:siswa\s+)?yang\s+memilih\s+)(bisnis\s+digital|sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|bd\b|si\b|ti\b|sk\b)/ig;
  const hits = [];
  let m;
  while ((m = headingRe.exec(raw)) !== null) {
    hits.push({ idx: m.index, name: String(m[2] || '').toLowerCase() });
  }
  if (hits.length === 0) return [{ key: null, label: null, text: raw }];
  hits.sort((a,b)=>(a.idx-b.idx));
  const blocks = [];
  for (let i=0;i<hits.length;i++) {
    const start = hits[i].idx;
    const end = (i+1 < hits.length) ? hits[i+1].idx : raw.length;
    const slice = raw.slice(start, end).trim();
    const nm = hits[i].name;
    const pd = programs.find(p => p.names.some(n => nm === n || nm.includes(n)));
    blocks.push({ key: pd ? pd.key : null, label: pd ? pd.label : null, text: slice });
  }
  return blocks;
}
const index = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'rag_index.json'),'utf8'));
const hobbyNameRe = /\b(hobi|hoby)\b/i;
const strongHobbyContentRe = /\bhobi\s+(?:siswa\s+)?yang\s+memilih\b/i;
const hobbyItems = index.filter(it => it && it.chunk && ((it.filename && hobbyNameRe.test(it.filename)) || strongHobbyContentRe.test(String(it.chunk))));
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
const blocks = splitHobbyTextIntoProgramBlocks(combined);
console.log('blocks length', blocks.length);
for (const b of blocks) {
  console.log('block', b.key, b.label, b.text.slice(0,120).replace(/\n/g,' | '));
}
