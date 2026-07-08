const q = 'hoby saya suka ngoding cocok jurusan apa?';
let t = q.toLowerCase();
 t = t.replace(/[\u200B-\u200D\uFEFF]/g, '');
 t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
 t = t.replace(/\s{2,}/g, ' ').trim();
 const repl = [
   [/\byg\b/g, 'yang'],[/\bdmn\b/g, 'di mana'],[/\bgmn\b/g, 'bagaimana'],[/\bbrp\b/g, 'berapa'],[/\butk\b/g, 'untuk'],[/\bdr\b/g, 'dari'],[/\bdpt\b/g, 'dapat'],[/\btdk\b/g, 'tidak'],[/\bgk\b/g, 'tidak'],[/\bga\b/g, 'tidak'],[/\bgak\b/g, 'tidak'],[/\bnggak\b/g, 'tidak'],[/\benggak\b/g, 'tidak'],[/\btrs\b/g, 'terus'],[/\btrus\b/g, 'terus'],[/\budh\b/g, 'sudah'],[/\budah\b/g, 'sudah'],[/\baja\b/g, 'saja'],[/\bbgt\b/g, 'banget'],[/\bpls\b/g, 'tolong'],[/\bplis\b/g, 'tolong'],[/\bpliss\b/g, 'tolong'],[/\bmin\b/g, 'admin'],[/\bngoding\b/g, 'coding'],[/\bngod\b/g, 'coding']
 ];
 for (const [re,to] of repl) t = t.replace(re,to);
 t = t.replace(/([a-z])\1{2,}/g,'$1$1');
 t = t.replace(/\b(kak|kakak|kaka|dong|deh|nih|yaa|ya|yah|hehe|wkwk|admin)\b/g,' ').replace(/\s{2,}/g,' ').trim();
 console.log('normal:', t);
 console.log('count:', t.split(/\s+/).filter(Boolean).length);
