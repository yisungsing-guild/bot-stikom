const fs = require('fs');
const path = require('path');

function walk(dir) {
  const results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fp = path.join(dir, file);
    let stat;
    try { stat = fs.statSync(fp); } catch (e) { continue; }
    if (stat && stat.isDirectory()) {
      if (file === 'node_modules' || file === '.git') continue;
      results.push(...walk(fp));
    } else {
      results.push(fp);
    }
  }
  return results;
}

const repoRoot = process.cwd();
const files = walk(repoRoot);
const targets = files.filter(f => {
  const lname = f.toLowerCase();
  return lname.endsWith('.json') || lname.endsWith('.jsonl') || lname.endsWith('.txt') || lname.endsWith('.bak') || lname.endsWith('.tmp') || lname.endsWith('.js') || lname.includes('rag_index') || lname.includes('trainingdata') || lname.includes('retrieval') || lname.includes('providerwebhook') || lname.includes('e2e_provider_output') || lname.includes('tmp');
});

const results = [];

function findMatchesInText(text, regex) {
  const out = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    out.push({ index: m.index, match: m[0] });
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
  return out;
}

const rxRp = /(?:Rp|RP|rp)\W*250(?:[.,]\s?000)?/g;
const rxPlain = /(^|[^0-9])250000(?![0-9])/g;

for (const f of targets) {
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  if (!raw) continue;
  // Try parse JSON lines
  const entries = [];
  const trimmed = raw.trim();
  const isJson = (f.toLowerCase().endsWith('.json') || f.toLowerCase().includes('rag_index')) && (trimmed.startsWith('{') || trimmed.startsWith('['));
  const isJsonl = f.toLowerCase().endsWith('.jsonl');

  if (isJson) {
    try {
      const obj = JSON.parse(raw);
      if (Array.isArray(obj)) {
        for (const it of obj) entries.push(it);
      } else if (obj && typeof obj === 'object') {
        if (Array.isArray(obj.rows)) entries.push(...obj.rows);
        else if (Array.isArray(obj.items)) entries.push(...obj.items);
        else entries.push(obj);
      }
    } catch (e) {
      // not parseable -> fall through to text search
    }
  } else if (isJsonl) {
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (const ln of lines) {
      try { entries.push(JSON.parse(ln)); } catch (e) { }
    }
  }

  if (entries.length) {
    for (const it of entries) {
      const textFields = [];
      if (it && typeof it === 'object') {
        for (const k of ['chunk', 'content', 'text', 'chunkPreview', 'preview', 'body']) {
          if (typeof it[k] === 'string') textFields.push({ key: k, txt: it[k] });
        }
      }
      for (const tf of textFields) {
        const t = tf.txt;
        rxRp.lastIndex = 0; rxPlain.lastIndex = 0;
        if (rxRp.test(t) || rxPlain.test(t)) {
          rxRp.lastIndex = 0; const m1 = findMatchesInText(t, rxRp)[0];
          rxPlain.lastIndex = 0; const m2 = findMatchesInText(t, rxPlain)[0];
          const m = m1 || m2;
          const idx = m ? m.index : -1;
          const before = idx >= 0 ? t.slice(Math.max(0, idx - 200), idx) : '';
          const val = m ? t.slice(m.index, m.index + (m.match || '').length) : null;
          const after = idx >= 0 ? t.slice(idx + (val ? val.length : 0), idx + (val ? val.length : 0) + 200) : '';
          results.push({
            file: path.relative(repoRoot, f),
            sourceType: isJson ? 'json' : (isJsonl ? 'jsonl' : 'structured'),
            object: it,
            textKey: tf.key,
            before, value: val, after
          });
        }
      }
    }
    continue;
  }

  rxRp.lastIndex = 0; rxPlain.lastIndex = 0;
  const matches = findMatchesInText(raw, rxRp).concat(findMatchesInText(raw, rxPlain));
  if (matches.length) {
    for (const m of matches) {
      const idx = m.index;
      const before = raw.slice(Math.max(0, idx - 200), idx);
      const value = raw.slice(idx, idx + (m.match || '').length);
      const after = raw.slice(idx + (m.match || '').length, idx + (m.match || '').length + 200);
      results.push({ file: path.relative(repoRoot, f), sourceType: 'text', before, value, after });
    }
  }
}

const normalized = results.map(r => {
  const obj = r.object || {};
  return {
    file: r.file,
    sourceType: r.sourceType,
    chunkId: obj.id || obj.chunkId || obj.chunk_id || null,
    trainingId: obj.trainingId || obj.training_id || obj.training || obj.trainingUuid || null,
    source: obj.source || obj.sourceType || null,
    filename: obj.filename || obj.file || obj.name || null,
    sourceFile: obj.sourceFile || obj.source_file || null,
    docCategory: obj.docCategory || obj.category || obj.chunkCategory || obj.categoryName || null,
    ocrQualityScore: obj.ocrQualityScore || obj.ocr_quality_score || obj.ocrScore || null,
    lowConfidence: typeof obj.lowConfidence === 'boolean' ? obj.lowConfidence : (obj.low_confidence === 1 || obj.low_confidence === true ? true : (obj.low_confidence === 0 ? false : (obj.lowConfidence === 1 ? true : (obj.lowConfidence === 0 ? false : null)))),
    before: r.before || null,
    value: r.value || null,
    after: r.after || null,
    rawObject: obj
  };
});

console.log(JSON.stringify({ count: normalized.length, items: normalized }, null, 2));
