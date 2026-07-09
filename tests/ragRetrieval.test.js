const fs = require('fs');
const path = require('path');
const { getRagIngestChunksPath, getRagIndexPath } = require('../src/utils/ragPaths');

// Build a temporary JSON rag_index from ingest/domains_chunks.jsonl so ragEngine can use it
const ingestPath = getRagIngestChunksPath('domains_chunks.jsonl');
const indexPath = getRagIndexPath();

function buildIndexFromIngest() {
  const raw = String(fs.readFileSync(ingestPath, 'utf8') || '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n(?=\{\"id\")/g).map(l => l.trim()).filter(Boolean);
  const arr = [];
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      const item = {
        id: j.id || null,
        chunk: j.text || '',
        filename: (j.metadata && j.metadata.source) ? j.metadata.source : (j.id || null),
        trainingId: null,
        metadata: j.metadata || {}
      };
      arr.push(item);
    } catch (e) {
      // ignore parse errors
    }
  }
  return arr;
}

describe('RAG retrieval trace (index from ingest, composer mocked)', () => {
  test('run top-5 retrievals for target queries', async () => {
    // Build index file
    const idx = buildIndexFromIngest();
    if (!idx.length) throw new Error('No ingest chunks found');
    fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

    // Require ragEngine after index is in place
    const rag = require('../src/engine/ragEngine');

    const queries = [
      'apa itu SI?',
      'di SI belajar apa?',
      'lulusan TI bekerja dimana?',
      'apakah ada dual degree internasional?',
      'gelombang apa yang dibuka sekarang?'
    ];

    const normalizeLocal = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s{2,}/g, ' ').trim();

    const detectLocal = (q) => {
      const s = String(q || '').toLowerCase();
      if (/\b(belajar\s+apa|apa\s+yang\s+dipelajari|dipelajari|belajarnya|mata\s+kuliah|kurikulum)\b/.test(s)) return 'CURRICULUM_QUESTION';
      if (/\b(kerja\s+dimana|kerja\s+di\s+mana|kerja\s+jadi\s+apa|prospek\s+kerja|lulusan)\b/.test(s)) return 'CAREER_PROSPECT';
      if (/\b(berapa\s+biaya|biaya|dpp|ukt|spp|uang\s+kuliah|pendaftaran|potongan|diskon|beasiswa)\b/.test(s)) return 'COST';
      if (/\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui)\b/.test(s)) return 'PROGRAM';
      if (/\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar\s+ulang)\b/.test(s)) return 'SCHEDULE';
      return 'GENERAL';
    };

    for (const q of queries) {
      const normalized = normalizeLocal(q);
      const detected = detectLocal(q);

      // Run ragEngine.query with topK=8 so we get contexts
      const res = await rag.query(q, 8, { includeGlobal: true });
      const ctxs = Array.isArray(res && res.contexts) ? res.contexts : [];
      const top5 = ctxs.slice(0, 5).map(c => ({
        source: c && (c.filename || c.trainingId) ? (c.filename || c.trainingId) : null,
        topic: (c && c.metadata && (c.metadata.topic || c.metadata.category)) ? (c.metadata.topic || c.metadata.category) : (c && c.chunk ? (c.chunk.slice(0,80).replace(/\n/g,' ')) : null),
        score: typeof c.score === 'number' ? c.score : null,
        excerpt: c && c.chunk ? (String(c.chunk).slice(0,300).replace(/\n+/g, ' ')) : null
      }));

      const topRetrieval = top5.length ? top5[0] : null;

      console.log('\n=== QUERY START ===');
      console.log('QUERY:', q);
      console.log('NORMALIZED_QUERY:', normalized);
      console.log('DETECTED_INTENT:', detected);
      console.log('TOP_5_RETRIEVALS:');
      for (const t of top5) {
        console.log('-', JSON.stringify(t));
      }
      console.log('TOP_RETRIEVAL_TOPIC:', topRetrieval ? topRetrieval.topic : null);
      console.log('TOP_RETRIEVAL_SCORE:', topRetrieval ? topRetrieval.score : null);
      console.log('=== QUERY END ===\n');
    }

  }, 20000);
});
