const { getRagIngestChunksPath, getRagDomainVectorsPath } = require('../src/utils/ragPaths');
(async () => {
  const fs = require('fs');
  const path = require('path');
  process.env.RAG_AUDIT_LOGGING = process.env.RAG_AUDIT_LOGGING || 'true';
  process.env.RAG_DEBUG_INTENT_FILTERING = process.env.RAG_DEBUG_INTENT_FILTERING || 'true';

  const { queryScoped } = require('../src/engine/ragScoped');

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const logDir = path.join(process.cwd(), 'rag-audit-logs');
  const expectedLogName = `query-retrieval-${yyyy}-${mm}-${dd}.jsonl`;
  const logFile = path.join(logDir, expectedLogName);

  const queries = [
    { key: 'TI', text: 'TI belajar apa saja', mustPrefix: 'program_studi_teknologi_informasi' },
    { key: 'SI', text: 'SI belajar apa saja', mustPrefix: 'program_studi_sistem_informasi' },
    { key: 'SK', text: 'SK belajar apa saja', mustPrefix: 'program_studi_sistem_komputer' },
    { key: 'BD', text: 'BD belajar apa saja', mustPrefix: 'program_studi_bisnis_digital' },
    { key: 'MI', text: 'MI belajar apa saja', mustPrefix: 'program_studi_manajemen_informatika' }
  ];

  function readAuditEntries(question) {
    try {
      if (!fs.existsSync(logFile)) return null;
      const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
      // Find the last entry that matches question
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        try {
          const obj = JSON.parse(line);
          if (obj && obj.question && String(obj.question).trim().toLowerCase() === String(question).trim().toLowerCase()) {
            return obj;
          }
        } catch (_) {
          // ignore
        }
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  function normalizeFilename(fn) {
    if (!fn) return '';
    const base = String(fn).toLowerCase().trim();
    return base.replace(/\\/g, '/');
  }

  function evaluatePassFail(qKey, ctxAfter, availableDocsFlags) {
    const forbidden = [
      'hoby.pdf',
      'hobi-sesuai-program-studi.docx',
      'chatbot - double degree',
      'double degree',
      'penjelasan semua program studi.pdf'
    ];

    const top = Array.isArray(ctxAfter) && ctxAfter.length ? ctxAfter[0] : null;
    const topFile = top && (top.filename || top.trainingId || top.id) ? String(top.filename || top.trainingId || top.id) : '';
    const topFileNorm = normalizeFilename(topFile);

    // 1) Top must be specific program doc when available (TI/SI/SK/BD)
    let mustPrefix = '';
    if (qKey === 'TI') mustPrefix = 'program_studi_teknologi_informasi';
    if (qKey === 'SI') mustPrefix = 'program_studi_sistem_informasi';
    if (qKey === 'SK') mustPrefix = 'program_studi_sistem_komputer';
    if (qKey === 'BD') mustPrefix = 'program_studi_bisnis_digital';

    if (['TI','SI','SK','BD'].includes(qKey)) {
      // If specific docs exist in corpus we expect them to be top
      if (availableDocsFlags[qKey]) {
        const ok = topFileNorm.includes(mustPrefix);
        if (!ok) return { status: 'FAIL', reason: `Top context is not from ${mustPrefix}` };
      }
    }

    // 2) Forbidden sources must not be top
    const isForbiddenTop = forbidden.some(f => topFileNorm.includes(f));
    if (isForbiddenTop) {
      return { status: 'FAIL', reason: `Top context is forbidden (${topFile})` };
    }

    return { status: 'PASS' };
  }

  // Detect availability of specific program docs in corpus by scanning data/ingest/domains_chunks.jsonl
  const corpusPath = getRagIngestChunksPath('domains_chunks.jsonl');
  const available = { TI: false, SI: false, SK: false, BD: false, MI: false };
  try {
    if (fs.existsSync(corpusPath)) {
      const lines = fs.readFileSync(corpusPath, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const obj = JSON.parse(line);
        const src = normalizeFilename(obj && obj.metadata && obj.metadata.source);
        if (src.includes('program_studi_teknologi_informasi')) available.TI = true;
        if (src.includes('program_studi_sistem_informasi')) available.SI = true;
        if (src.includes('program_studi_sistem_komputer')) available.SK = true;
        if (src.includes('program_studi_bisnis_digital')) available.BD = true;
        if (src.includes('program_studi_manajemen_informatika')) available.MI = true;
      }
    }
  } catch (_) {}

  const results = [];

  for (const q of queries) {
    try {
      const res = await queryScoped({ query: q.text, category: 'curriculum', topK: 8, options: { returnDebug: true, explicitDomain: true } });
      const selectedChunkCount = Array.isArray(res.contexts) ? res.contexts.length : 0;
      const finalContextSources = Array.isArray(res.contexts) ? Array.from(new Set(res.contexts.map(c => (c.filename || c.trainingId || c.id)).filter(Boolean))) : [];
      const queryEntities = (res.debug && (res.debug.queryEntities || res.debug.entities)) || null;

      // find audit entry for this question (last occurrence)
      const audit = readAuditEntries(q.text);
      const before = audit && audit.beforeFiltering && Array.isArray(audit.beforeFiltering.chunks) ? audit.beforeFiltering.chunks.slice(0, 5) : [];
      const after = audit && audit.afterFiltering && Array.isArray(audit.afterFiltering.chunks) ? audit.afterFiltering.chunks.slice(0, 5) : [];

      const passFail = evaluatePassFail(q.key, after, available);

      results.push({
        question: q.text,
        key: q.key,
        source: res.source || null,
        confidenceTier: res.confidenceTier || null,
        detectedIntent: queryEntities && queryEntities.academicIntent ? queryEntities.academicIntent : (queryEntities && queryEntities.intent) || null,
        queryEntities: queryEntities || null,
        selectedChunkCount,
        finalContextSources,
        topChunksBeforeFiltering: before,
        topChunksAfterFiltering: after,
        evaluation: passFail
      });
    } catch (e) {
      results.push({ question: q.text, key: q.key, error: e && e.message ? e.message : String(e) });
    }
  }

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    logFile: fs.existsSync(logFile) ? path.relative(process.cwd(), logFile) : null,
    availableSpecificDocs: available,
    results
  }, null, 2));
})();
