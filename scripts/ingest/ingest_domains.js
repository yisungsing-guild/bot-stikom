const fs = require('fs');
const path = require('path');

// Try to use the project's chunker if available, otherwise use a simple fallback
let chunkText;
try {
  chunkText = require('../../src/engine/chunker').chunkText;
  if (typeof chunkText !== 'function') throw new Error('chunkText not a function');
} catch (e) {
  // simple fallback: split into paragraphs then join to approximate sizes
  chunkText = function simpleChunk(text, opts = {}) {
    const minSize = opts.minSize || 300;
    const maxSize = opts.maxSize || 800;
    const paras = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const out = [];
    let buffer = '';
    for (const p of paras) {
      if ((buffer + '\n\n' + p).length > maxSize && buffer) {
        out.push(buffer.trim());
        buffer = p;
      } else {
        buffer = buffer ? buffer + '\n\n' + p : p;
      }
    }
    if (buffer) out.push(buffer.trim());
    return out;
  };
}

function slugToCategory(slug) {
  return slug.replace(/\.md$/i, '').replace(/[^a-z0-9_]+/gi, '_');
}

function inferTypeFromSignals(topic, title, text) {
  const hay = `${String(topic || '')} ${String(title || '')} ${String(text || '')}`.toLowerCase();
  const catalogPattern = /\b(daftar\s+(?:program\s+studi|prodi|jurusan)|program\s+studi\s+yang\s+ada|program\s+yang\s+tersedia|katalog\s+prodi|katalog\s+jurusan|semua\s+jurusan)\b/;
  const curriculumPattern = /\b(apa\s+yang\s+dipelajari|belajar\s+apa|mata\s+kuliah|kurikulum|curriculum|silabus|kompetensi|skill\s+yang\s+dipelajari|materi)\b/;
  const careerPattern = /\b(prospek\s+kerja|karier|karir|career\s+path|career|pekerjaan|posisi\s+kerja|output\s+lulusan|setelah\s+lulus|lulusan\s+bisa\s+kerja)\b/;

  if (catalogPattern.test(hay)) return 'program_catalog';
  if (curriculumPattern.test(hay) && careerPattern.test(hay)) return 'program_detail';
  if (curriculumPattern.test(hay)) return 'curriculum';
  if (careerPattern.test(hay)) return 'career';
  return 'program_detail';
}

function defaultMetadataForFile(filePath) {
  const name = path.basename(filePath);
  const source = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  const topicFromProgramFile = String(name || '').toLowerCase().match(/^program_studi_(.+)\.md$/i);
  if (topicFromProgramFile && topicFromProgramFile[1]) {
    const topic = sanitizeTopic(topicFromProgramFile[1]);
    return {
      category: 'program_studi',
      topic,
      type: 'program_detail',
      audience: 'prospective_student',
      tags: ['program_studi', topic],
      source
    };
  }

  const category = slugToCategory(name);
  return {
    category,
    topic: category,
    type: 'program_detail',
    audience: 'prospective_student',
    tags: [category],
    source
  };
}

function splitByHeading(text) {
  // Split by H1/H2 headings, keep the heading line as the section title
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = { title: null, body: [] };
  for (const line of lines) {
    const m = line.match(/^\s{0,3}#{1,2}\s+(.*)/);
    if (m) {
      if (current.body.length) sections.push(current);
      current = { title: m[1].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length || current.title) sections.push(current);
  return sections.map(s => ({ title: s.title || null, text: (s.title ? ('# ' + s.title + '\n\n') : '') + s.body.join('\n') }));
}

function sanitizeTopic(topic) {
  if (!topic) return 'general';
  return String(topic).toLowerCase().replace(/[^a-z0-9_ ]+/g, '').trim().replace(/\s+/g, '_');
}

async function ingestDomains({inputDir, outputFile, priorityFiles}) {
  const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.md'));
  const chosen = files.filter(f => priorityFiles.includes(f)).concat(files.filter(f => !priorityFiles.includes(f)));

  const outStream = fs.createWriteStream(outputFile, { flags: 'w', encoding: 'utf8' });
  let idCounter = 1;

  for (const file of chosen) {
    const fp = path.join(inputDir, file);
    if (!fs.existsSync(fp)) continue;
    const raw = fs.readFileSync(fp, 'utf8');

    const baseMeta = defaultMetadataForFile(fp);
    const sections = splitByHeading(raw);

    for (const sec of sections) {
      const sectionTopic = sec.title ? sanitizeTopic(sec.title) : baseMeta.topic;
      const sectionType = inferTypeFromSignals(sectionTopic, sec.title, sec.text || '');
      const chunks = chunkText(sec.text || '', { minSize: 300, maxSize: 800 });
      for (const chunk of chunks) {
        const programName = baseMeta.topic
          ? baseMeta.topic.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          : 'Program Studi';
        const sectionAnchor = sec.title ? String(sec.title).trim() : sectionTopic.replace(/_/g, ' ');
        const anchoredChunk = `Program Studi ${programName} - ${sectionAnchor}\n${chunk}`;
        if (String(anchoredChunk).replace(/\s+/g, ' ').trim().length < 120) continue;
        const md = Object.assign({}, baseMeta, {
          topic: sectionTopic,
          type: sectionType,
          tags: Array.from(new Set([...(baseMeta.tags || []), sectionTopic, sectionType]))
        });
        const record = {
          id: `${baseMeta.category}-${idCounter++}`,
          text: anchoredChunk,
          metadata: md
        };
        outStream.write(JSON.stringify(record) + '\n');
      }
    }
  }

  outStream.end();
  console.log('Ingestion complete — output written to', outputFile);
}

if (require.main === module) {
  const inputDir = path.join(process.cwd(), 'docs', 'retrieval', 'knowledge_domains');
  const outputFile = path.join(process.cwd(), 'data', 'ingest', 'domains_chunks.jsonl');
  const priorityFiles = [
    'program_studi_sistem_informasi.md',
    'program_studi_teknologi_informasi.md',
    'program_studi_bisnis_digital.md',
    'program_studi_sistem_komputer.md',
    'scholarship.md',
    'double_degree.md',
    'international_program.md',
    'tuition_fee.md'
  ];

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  ingestDomains({ inputDir, outputFile, priorityFiles }).catch(err => {
    console.error('Ingestion failed', err);
    process.exitCode = 2;
  });
}

module.exports = { ingestDomains };