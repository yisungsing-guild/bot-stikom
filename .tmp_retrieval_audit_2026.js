const fs = require('fs');
const path = require('path');
const { extractStructuredEntities, getChunkScoreBreakdown, filterRelevantChunks, computeEmbedding } = require('./src/engine/ragEngine');
const { classifyIntent, getAllowedDocCategories, getForbiddenDocCategories } = require('./src/engine/intentClassifier');
const { validateChunkEvidence, validateChunkRelevanceToQuestion } = require('./src/engine/evidenceValidator');

function detectIntent(text) {
  const q = String(text || '').toLowerCase();
  const programSignal = /\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui|help\s+university|utb|china|bali|study\s+abroad|si|ti|bd|sk|mi|rpl|teknologi\s+informasi|sistem\s+informasi|bisnis\s+digital|sistem\s+komputer|s\.?k(?:om(?:puter)?)?)\b/.test(q);
  const academicSignal = /\b(apa\s+itu|apa\s+yang\s+dipelajari|dipelajari|materi|perkuliahan|belajar\s+apa|mata\s+kuliah|kurikulum|fokus|prospek\s+kerja|karir|coding|ngoding|akreditasi|biaya|beasiswa|lokasi|kampus)\b/.test(q);
  if (programSignal && academicSignal) return 'ACADEMIC_PROGRAM';
  if (/\b(berapa\s+biaya|berapa\s+harga|harga|biaya|dpp|ukt|spp|uang\s+kuliah|uang\s+semester|uang\s+pendaftaran|biaya\s+semester|biaya\s+per\s*semester|bayar|potongan|diskon)\b/.test(q)) return 'COST';
  if (programSignal) return 'PROGRAM';
  if (/\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar\s+ulang|penutupan)\b/.test(q)) return 'SCHEDULE';
  return 'GENERAL';
}

function normalizeIndonesianQuestionText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return String(raw || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s{2,}/g, ' ').trim();
}

function applyIntentAwareFilteringAndValidation(question, scoredChunks, userIntent, debugCollector = null) {
  if (!Array.isArray(scoredChunks) || scoredChunks.length === 0) {
    return [];
  }

  const intent = String(userIntent || 'GENERAL').toUpperCase().trim();
  const allowedCategories = getAllowedDocCategories(intent);
  const forbiddenCategories = getForbiddenDocCategories(intent);

  const validated = [];
  const rejected = [];

  for (const scored of scoredChunks) {
    if (!scored || !scored.item) continue;

    const chunk = scored.item;
    const chunkCategory = chunk.docCategory || chunk.category || 'UNKNOWN';

    if (forbiddenCategories.has(chunkCategory)) {
      rejected.push({ reason: 'forbidden_category', category: chunkCategory, intent, chunkId: chunk.id });
      if (debugCollector && Array.isArray(debugCollector.rejected)) debugCollector.rejected.push(rejected[rejected.length - 1]);
      continue;
    }

    let categoryMismatch = false;
    if (intent !== 'GENERAL' && allowedCategories.size > 0 && !allowedCategories.has(chunkCategory)) {
      categoryMismatch = true;
    }

    let evidenceValidation = { hasEvidence: true, confidence: 'MEDIUM' };
    try {
      evidenceValidation = validateChunkEvidence(chunk, intent);
      if (!evidenceValidation.hasEvidence) {
        if (debugCollector && Array.isArray(debugCollector.rejected)) {
          debugCollector.rejected.push({ reason: 'no_evidence_for_intent', intent, chunkId: chunk.id, detail: evidenceValidation });
        }
      }
    } catch (validationErr) {
      evidenceValidation = { hasEvidence: false, confidence: 'LOW', reasons: ['evidence_validation_error'] };
    }

    let relevanceValidation = { relevant: true };
    try {
      relevanceValidation = validateChunkRelevanceToQuestion(chunk, question, intent);
      if (!relevanceValidation.relevant) {
        rejected.push({ reason: 'not_relevant_to_question', intent, chunkId: chunk.id, detail: relevanceValidation });
        if (debugCollector && Array.isArray(debugCollector.rejected)) debugCollector.rejected.push(rejected[rejected.length - 1]);
        continue;
      }
    } catch (relevanceErr) {
      relevanceValidation = { relevant: true };
    }

    validated.push({
      ...scored,
      validationMetadata: {
        category: chunkCategory,
        categoryMismatch,
        allowedCategories: Array.from(allowedCategories),
        evidenceConfidence: evidenceValidation.confidence,
        matchesIntent: true,
        intent
      }
    });
  }

  return validated;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const va = Number(a[i]) || 0;
    const vb = Number(b[i]) || 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  return (na === 0 || nb === 0) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function itemLabel(item) {
  return `${item.filename || item.trainingId || 'unknown'} | program=${item.program || item.programName || 'N/A'} | docCategory=${item.docCategory || item.category || 'NONE'} | chunkType=${item.chunkType || 'N/A'}`;
}

function formatScore(s) {
  return Number(s).toFixed(4);
}

async function auditQuery(question) {
  const norm = normalizeIndonesianQuestionText(question);
  const queryForRetrieval = norm;
  const queryEntities = extractStructuredEntities(queryForRetrieval || norm || question);
  const qEmb = await computeEmbedding(queryForRetrieval || norm || question);
  const intent = detectIntent(queryForRetrieval || norm || question);
  const userIntent = classifyIntent(question);

  const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  const scored = index.map(item => {
    const semanticScore = Array.isArray(qEmb) && Array.isArray(item.embedding) ? cosineSimilarity(qEmb, item.embedding) : 0;
    const breakdown = getChunkScoreBreakdown(item, question, intent, semanticScore, queryEntities);
    return {
      item,
      score: semanticScore,
      semanticScore,
      keywordScore: breakdown.keywordScore,
      evidenceScore: breakdown.evidenceScore,
      compositeScore: breakdown.compositeScore,
      finalScore: breakdown.finalScore,
      docCategory: item.docCategory || item.category || 'NONE',
      chunkType: item.chunkType || 'NONE',
      program: item.program || item.programName || null,
      filename: item.filename || item.trainingId || null,
      itemEntities: breakdown.itemEntities,
      scoreComponents: breakdown
    };
  });

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  const top20 = scored.slice(0, 20);
  const relevant = filterRelevantChunks(question, scored, queryEntities);
  const afterRelevant = (() => {
    if (!relevant || relevant.length === 0) return scored.slice();
    const topIds = new Set(relevant.slice(0, Math.max(8, 8)).map(r => r.item.id));
    const reRanked = scored.filter(s => topIds.has(s.item.id));
    return reRanked.length > 0 ? reRanked : scored.slice();
  })();
  const debugCollector = { rejected: [] };
  const validated = applyIntentAwareFilteringAndValidation(question, afterRelevant, userIntent, debugCollector);
  const minScore = parseFloat(process.env.RAG_MIN_SCORE || '0.6');
  const filtered = validated.filter(s => s.score >= minScore || (typeof s.finalScore === 'number' && s.finalScore >= minScore));
  const finalRanked = filtered.slice(0, 20);

  const traceId = '6631dfc1-b46c-4933-a340-392dfd2250d6';
  const traceChunk = (arr) => {
    const idx = arr.findIndex(s => s.item.id === traceId);
    return idx >= 0 ? { found: true, rank: idx + 1, score: arr[idx].score, compositeScore: arr[idx].compositeScore, finalScore: arr[idx].finalScore, docCategory: arr[idx].docCategory, itemLabel: itemLabel(arr[idx].item) } : { found: false };
  };

  return {
    question,
    queryForRetrieval,
    queryEntities,
    intent,
    userIntent,
    top20,
    relevantCount: relevant.length,
    reRankedCount: afterRelevant.length,
    validatedCount: validated.length,
    finalCount: finalRanked.length,
    trace: {
      beforeFiltering: traceChunk(scored),
      afterFilterRelevant: traceChunk(relevant),
      afterApplyIntent: traceChunk(validated),
      beforeFinalRanking: traceChunk(scored),
      afterFinalRanking: traceChunk(finalRanked)
    },
    relevantIds: relevant.map((s, idx) => ({ rank: idx + 1, id: s.item.id, filename: s.item.filename || s.item.trainingId, docCategory: s.docCategory || s.item.docCategory, score: formatScore(s.score), compositeScore: formatScore(s.compositeScore), finalScore: formatScore(s.finalScore) })),
    afterRelevantIds: afterRelevant.map((s, idx) => ({ rank: idx + 1, id: s.item.id, filename: s.item.filename || s.item.trainingId, docCategory: s.docCategory || s.item.docCategory, score: formatScore(s.score), compositeScore: formatScore(s.compositeScore), finalScore: formatScore(s.finalScore) })),
    validatedIds: validated.map((s, idx) => ({ rank: idx + 1, id: s.item.id, filename: s.item.filename || s.item.trainingId, docCategory: s.docCategory || s.item.docCategory, score: formatScore(s.score), compositeScore: formatScore(s.compositeScore), finalScore: formatScore(s.finalScore) })),
    rejected: debugCollector.rejected.slice(0, 100),
    filteredIds: finalRanked.map((s, idx) => ({ rank: idx + 1, id: s.item.id, filename: s.filename, docCategory: s.docCategory, score: formatScore(s.score), compositeScore: formatScore(s.compositeScore), finalScore: formatScore(s.finalScore) }))
  };
}

(async () => {
  const queries = [
    'Apa itu Sistem Informasi?',
    'Apa prospek kerja Sistem Informasi?',
    'Apa yang dipelajari di Sistem Informasi?',
    'Apa keunggulan Sistem Informasi?'
  ];
  const results = [];
  for (const q of queries) {
    const res = await auditQuery(q);
    results.push(res);
  }
  const outPath = path.join(__dirname, '.tmp_retrieval_results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log('WROTE', outPath);
})();
