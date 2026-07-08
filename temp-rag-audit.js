const fs = require('fs');
const path = require('path');
const engine = require('./src/engine/ragEngine');
const intentClassifier = require('./src/engine/intentClassifier');
const evidenceValidator = require('./src/engine/evidenceValidator');
const text = 'TI belajar apa saja';
const q = text;
function extractCurrentUserQuestionText(rawQuestion) {
  const q = String(rawQuestion || '').trim();
  if (!q) return '';
  const markers = ['Pertanyaan user saat ini:', 'Balasan user saat ini:', 'Follow-up:'];
  let best = q;
  let bestIdx = -1;
  let bestMarker = null;
  for (const marker of markers) {
    const idx = q.lastIndexOf(marker);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestMarker = marker;
    }
  }
  if (bestIdx >= 0 && bestMarker) best = q.slice(bestIdx + bestMarker.length).trim();
  if ((best.startsWith('"') && best.endsWith('"')) || (best.startsWith('ΓÇ£') && best.endsWith('ΓÇ¥'))) {
    best = best.slice(1, -1).trim();
  }
  if (best.startsWith('"') || best.startsWith('ΓÇ£')) best = best.slice(1).trim();
  if (best.endsWith('"') || best.endsWith('ΓÇ¥')) best = best.slice(0, -1).trim();
  return best;
}
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
    [/\bngod\b/g, 'coding']
  ];
  for (const [re, to] of repl) t = t.replace(re, to);
  t = t.replace(/([a-z])\1{2,}/g, '$1$1');
  t = t.replace(/\b(kak|kakak|kaka|dong|deh|nih|yaa|ya|yah|hehe|wkwk|admin)\b/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t;
}
const currentUserQ = extractCurrentUserQuestionText(q);
const normalizedUserQ = normalizeIndonesianQuestionText(currentUserQ);
function normalizeQueryForRetrieval(rawQuery) {
  let t = String(rawQuery || '').toLowerCase();
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
    [/\bngod\b/g, 'coding']
  ];
  for (const [re, to] of repl) t = t.replace(re, to);
  t = t.replace(/([a-z])\1{2,}/g, '$1$1');
  t = t.replace(/\b(kak|kakak|kaka|dong|deh|nih|yaa|ya|yah|hehe|wkwk|admin)\b/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t;
}
const queryForRetrieval = normalizeQueryForRetrieval(normalizedUserQ);
const queryEntities = engine.extractStructuredEntities(queryForRetrieval || normalizedUserQ || currentUserQ || q);
const indexPath = engine.getIndexPath();
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8') || '[]');
function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, v, i) => sum + v * (b[i] || 0), 0);
  const na = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const nb = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}
function detectIntent(text) {
  const q = String(text || '').toLowerCase();
  const programSignal = /\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui|help\s+university|utb|china|bali|study\s+abroad|si|ti|bd|sk|mi|rpl|teknologi\s+informasi|sistem\s+informasi|bisnis\s+digital|sistem\s+komputer)\b/.test(q);
  const academicSignal = /\b(apa\s+itu|belajar\s+apa|mata\s+kuliah|kurikulum|fokus|prospek\s+kerja|karir|akreditasi|biaya|beasiswa|lokasi|kampus)\b/.test(q);
  if (programSignal && academicSignal) return 'ACADEMIC_PROGRAM';
  if (/\b(berapa\s+biaya|berapa\s+harga|harga|biaya|dpp|ukt|spp|uang\s+kuliah|uang\s+semester|uang\s+pendaftaran|bayar|potongan|diskon)\b/.test(q)) return 'COST';
  if (programSignal) return 'PROGRAM';
  if (/\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar\s+ulang|penutupan)\b/.test(q)) return 'SCHEDULE';
  return 'GENERAL';
}
function applyIntentAwareFilteringAndValidation(question, scoredChunks, userIntent, debugCollector = null) {
  if (!Array.isArray(scoredChunks) || scoredChunks.length === 0) return [];
  const intent = String(userIntent || 'GENERAL').toUpperCase().trim();
  const allowedCategories = new Set(intentClassifier.getAllowedDocCategories(intent));
  const forbiddenCategories = new Set(intentClassifier.getForbiddenDocCategories(intent));
  const validated = [];
  const rejected = [];
  for (const scored of scoredChunks) {
    if (!scored || !scored.item) continue;
    const chunk = scored.item;
    const chunkCategory = chunk.docCategory || chunk.category || 'UNKNOWN';
    if (forbiddenCategories.has(chunkCategory)) {
      rejected.push({ reason: 'forbidden_category', category: chunkCategory, intent, chunkId: chunk.id });
      if (debugCollector && Array.isArray(debugCollector.rejected)) debugCollector.rejected.push(rejected[rejected.length-1]);
      continue;
    }
    let categoryMismatch = false;
    if (intent !== 'GENERAL' && allowedCategories.size > 0 && !allowedCategories.has(chunkCategory)) {
      categoryMismatch = true;
    }
    let evidenceValidation = { hasEvidence: true, confidence: 'MEDIUM' };
    try {
      evidenceValidation = evidenceValidator.validateChunkEvidence(chunk, intent);
      if (!evidenceValidation.hasEvidence) {
        if (debugCollector && Array.isArray(debugCollector.rejected)) {
          debugCollector.rejected.push({ reason: 'no_evidence_for_intent', intent, chunkId: chunk.id, detail: evidenceValidation });
        }
      }
    } catch (e) {
      evidenceValidation = { hasEvidence: false, confidence: 'LOW', reasons: ['evidence_validation_error'] };
    }
    let relevanceValidation = { relevant: true };
    try {
      relevanceValidation = evidenceValidator.validateChunkRelevanceToQuestion(chunk, question, intent);
      if (!relevanceValidation.relevant) {
        rejected.push({ reason: 'not_relevant_to_question', intent, chunkId: chunk.id, detail: relevanceValidation });
        if (debugCollector && Array.isArray(debugCollector.rejected)) debugCollector.rejected.push(rejected[rejected.length-1]);
        continue;
      }
    } catch (e) {
      relevanceValidation = { relevant: true, reason: 'relevance_validation_error' };
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
function getIntent() {
  const query = queryForRetrieval || normalizedUserQ || currentUserQ || q;
  return detectIntent(query);
}
(async () => {
  const qEmb = await engine.computeEmbedding(queryForRetrieval || normalizedUserQ || currentUserQ || q);
  const intent = getIntent();
  const scored = index.map(item => {
    const semantic = cosineSimilarity(qEmb, item.embedding || []);
    const breakdown = engine.getChunkScoreBreakdown(item, q, intent, semantic, queryEntities);
    return {
      item,
      score: semantic,
      semanticScore: semantic,
      finalScore: breakdown.finalScore,
      compositeScore: breakdown.compositeScore,
      attributeScore: breakdown.attributeScore,
      metadataBoost: breakdown.metadataBoost,
      scoreComponents: breakdown
    };
  });
  const sorted = scored.slice().sort((a, b) => b.compositeScore - a.compositeScore);
  const top20 = sorted.slice(0, 20).map(s => ({
    id: s.item.id,
    filename: s.item.filename,
    category: s.item.docCategory || s.item.category,
    score: s.score,
    composite: s.compositeScore,
    final: s.finalScore,
    metadataBoost: s.metadataBoost,
    keywordScore: s.scoreComponents.keywordScore,
    programEntity: s.scoreComponents.itemEntities.program || null,
    docCat: s.item.docCategory || s.item.category,
    trainingId: s.item.trainingId,
    source: (s.item.metadata || {}).source || null,
    metadata: s.item.metadata || {}
  }));
  const relevant = engine.filterRelevantChunks(q, sorted, queryEntities);
  const userIntent = intentClassifier.classifyIntent(q);
  const validated = applyIntentAwareFilteringAndValidation(q, sorted, userIntent, { rejected: [] });
  const programStudies = index.filter(it => {
    const cat = String(it.docCategory || it.category || '').toLowerCase();
    const mdcat = String((it.metadata || {}).category || '').toLowerCase();
    const source = String((it.metadata || {}).source || '').toLowerCase();
    return cat === 'program_studi' || mdcat === 'program_studi' || source.includes('program_studi') || String(it.filename || '').toLowerCase().includes('program studi');
  });
  console.log(JSON.stringify({
    query: { text: q, currentUserQ, normalizedUserQ, queryForRetrieval, queryEntities, intent, userIntent },
    top20,
    relevantCount: relevant.length,
    relevantTop20: relevant.slice(0, 20).map(s => ({ id: s.item.id, filename: s.item.filename, docCat: s.item.docCategory || s.item.category, score: s.score, composite: s.compositeScore })),
    validatedCount: validated.length,
    validatedTop20: validated.slice(0, 20).map(s => ({ id: s.item.id, filename: s.item.filename, docCat: s.item.docCategory || s.item.category, score: s.score, composite: s.compositeScore, validationMetadata: s.validationMetadata })),
    programStudiesCount: programStudies.length,
    programStudies: programStudies.map(it => ({ id: it.id, filename: it.filename, docCat: it.docCategory || it.category, metadataCategory: (it.metadata || {}).category, metadataSource: (it.metadata || {}).source, tags: (it.metadata || {}).tags, chunkPreview: String(it.chunk || '').slice(0, 120).replace(/\s+/g, ' ') }))
  }, null, 2));
})();
