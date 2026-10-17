'use strict';

/**
 * src/core/retrievalService.js
 * 
 * Greenfield Unified Retrieval Service.
 * Leverages healthy underlying retrieval infrastructure:
 * - In-memory Canonical Corpus Index (829+ governed chunks)
 * - BM25 Sparse Search (bm25.js)
 * - PgVector / Dense Embeddings (when configured)
 * - Executes retrieval according to RetrievalPlan constraints
 */

const { 
  getCorpusIndex, 
  ensureCanonicalCorpus,
  CANONICAL_CORPUS_MIN_CHUNKS,
  searchVectorChunksMultiBinding, 
  computeBatchQueryEmbeddings, 
  computeBindingRRF 
} = require('../engine/pgvectorShadowProvider');
const { computeBm25Scores } = require('../engine/bm25');
const { normalizeAspect } = require('./retrievalContract');
const logger = require('../logger');

/**
 * Checks if production PgVector is configured and enabled in environment
 */
function isPgVectorProductionEnabled() {
  const mode = String(process.env.VECTOR_RETRIEVAL_MODE || '').toLowerCase();
  const enabled = /^(true|1|yes)$/i.test(String(process.env.VECTOR_RETRIEVAL_ENABLED || ''));
  const hybrid = /^(true|1|yes)$/i.test(String(process.env.VECTOR_HYBRID_ENABLED || ''));
  return mode === 'hybrid' || mode === 'vector' || enabled || hybrid;
}

const { CANONICAL_ENTITIES, findCanonicalEntity } = require('../engine/canonicalEntityRegistry');

let cachedFileContextMap = null;
let cachedChunkSectionMap = null;

function getChunkSectionMap(corpus) {
  if (cachedChunkSectionMap) return cachedChunkSectionMap;
  cachedChunkSectionMap = new Map();

  const fileGroups = new Map();
  for (let i = 0; i < corpus.length; i++) {
    const doc = corpus[i];
    const f = doc.sourceFile || doc.filename || '';
    if (!fileGroups.has(f)) fileGroups.set(f, []);
    fileGroups.get(f).push({ index: i, doc });
  }

  const SECTION_PATTERNS = [
    /---+\s*([A-Z\s]{4,30})\s*---+/,
    /Kurikulum(?:\s+2025)?\s*\(\s*Program\s+Studi\s+([A-Za-z\s]+?)\s*\)/i,
    /Kurikulum\s+Program\s+Studi\s+([A-Za-z\s]+?)(?:\s*\(Tahun|\n|$)/i,
    /Profil\s+Program\s+Studi\s+(?:Program\s+Studi\s+)?([A-Za-z\s]+?)(?:\s+di\s+ITB|\n|$)/i,
    /(?:Program\s+Studi|Jenjang)\s+(Magister\s+Sistem\s+Informasi|S2\s+Sistem\s+Informasi)/i,
    /###\s+(?:Program\s+Studi\s+)?([A-Za-z0-9\s,\(\)]+?)(?:\n|$)/i,
    /Penjelasan\s+Prodi\s+dan\s+Karier\s+Masa\s+Depan\s*:\s*([A-Za-z\s]+?)(?:\||\n|$)/i
  ];

  for (const [, group] of fileGroups.entries()) {
    let currentProg = null;
    for (const { index, doc } of group) {
      const txt = doc.chunk || doc.text || '';
      let matchedEnt = null;
      let delimIndex = -1;

      for (const pat of SECTION_PATTERNS) {
        const m = txt.match(pat);
        if (m) {
          let candidateName = m[1].trim();
          if (/manajemen\s+informasi/i.test(candidateName)) {
            candidateName = 'D3 Manajemen Informatika';
          }
          for (const ent of CANONICAL_ENTITIES) {
            if (ent.family === 'academic_program') {
              const base = ent.canonical.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase();
              if (candidateName.toLowerCase().includes(base) || candidateName.toLowerCase() === ent.canonical.toLowerCase()) {
                // If candidateName explicitly mentions D3, S2, or S1, match the exact degree
                if (/\b(?:d3|diploma)\b/i.test(candidateName) && !ent.canonical.startsWith('D3')) continue;
                if (/\b(?:s2|magister)\b/i.test(candidateName) && !ent.canonical.startsWith('S2')) continue;
                if (/\b(?:s1|sarjana)\b/i.test(candidateName) && !ent.canonical.startsWith('S1')) continue;
                matchedEnt = ent.canonical;
                delimIndex = txt.indexOf(m[0]);
                break;
              }
            }
          }
          if (matchedEnt) break;
        }
      }

      if (matchedEnt) {
        if (delimIndex > txt.length * 0.5) {
          if (currentProg) cachedChunkSectionMap.set(index, currentProg);
          currentProg = matchedEnt;
          continue;
        } else {
          currentProg = matchedEnt;
        }
      }
      if (currentProg) {
        cachedChunkSectionMap.set(index, currentProg);
      }
    }
  }

  return cachedChunkSectionMap;
}

function getFileContextMap(corpus) {
  if (cachedFileContextMap) return cachedFileContextMap;
  cachedFileContextMap = new Map();

  for (const doc of corpus) {
    const f = doc.sourceFile || doc.filename || '';
    if (!f || cachedFileContextMap.has(f)) continue;

    const docChunks = corpus.filter(c => (c.sourceFile || c.filename) === f);
    const entities = new Set();
    let category = doc.docCategory || '';

    for (const c of docChunks) {
      const txt = (c.chunk || c.text || '');
      if (!category && (txt.includes('BIAYA PENDIDIKAN') || /rincian biaya/i.test(f))) {
        category = 'BIAYA';
      }

      // Check program header in text
      const progMatch = txt.match(/PROGRAM STUDI\s+([A-Z0-9\s,\(\)]+?)(?:T\.A|\n|$)/i);
      if (progMatch) {
        const pName = progMatch[1].trim();
        for (const ent of CANONICAL_ENTITIES) {
          if (ent.family === 'academic_program') {
            const hasS2 = /\b(?:s2|magister|pascasarjana)\b/i.test(pName) || /\b(?:s2|magister|pascasarjana)\b/i.test(f);
            const hasD3 = /\b(?:d3|diploma)\b/i.test(pName) || /\b(?:d3|diploma)\b/i.test(f);
            if (ent.canonical.startsWith('S2') && !hasS2) continue;
            if (ent.canonical.startsWith('D3') && !hasD3) continue;
            if (ent.canonical.startsWith('S1') && hasS2 && !/\b(?:s1|sarjana)\b/i.test(pName) && !/\b(?:s1|sarjana)\b/i.test(f)) continue;

            if (
              pName.toLowerCase().includes(ent.canonical.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase()) ||
              (ent.aliases && ent.aliases.some(a => a.length >= 3 && pName.toLowerCase().includes(a)))
            ) {
              entities.add(ent.canonical);
            }
          }
        }
      }

      // Check filename for canonical entities & aliases
      for (const ent of CANONICAL_ENTITIES) {
        if (ent.aliases && ent.aliases.some(a => a.length >= 2 && new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(f))) {
          const hasS2 = /\b(?:s2|magister|pascasarjana)\b/i.test(f);
          const hasD3 = /\b(?:d3|diploma)\b/i.test(f);
          if (ent.canonical.startsWith('S2') && !hasS2) continue;
          if (ent.canonical.startsWith('D3') && !hasD3) continue;
          entities.add(ent.canonical);
        }
      }
    }

    cachedFileContextMap.set(f, {
      category,
      entities: Array.from(entities)
    });
  }

  return cachedFileContextMap;
}

/**
 * Systemically extracts academic properties (level, scope, supportedPrograms)
 * ensuring multi-program documents (e.g. tuition fee matrices covering SI, TI, BD)
 * are properly classified with scope 'PROGRAM_MULTI' and supported programs.
 */
function extractCandidateAcademicProperties(doc = {}, metadata = {}, contextEntities = [], sectionProg = null) {
  const levels = new Set();
  if (doc.academicLevel) levels.add(String(doc.academicLevel).toUpperCase());
  if (metadata.academicLevel) levels.add(String(metadata.academicLevel).toUpperCase());
  if (Array.isArray(doc.academicLevels)) doc.academicLevels.forEach(l => l && levels.add(String(l).toUpperCase()));
  if (Array.isArray(metadata.academicLevels)) metadata.academicLevels.forEach(l => l && levels.add(String(l).toUpperCase()));

  if (sectionProg) {
    const m = sectionProg.match(/\b(S1|S2|D3|D4)\b/i);
    if (m) levels.add(m[1].toUpperCase());
  }

  if (Array.isArray(contextEntities)) {
    for (const ent of contextEntities) {
      if (typeof ent === 'string') {
        const m = ent.match(/\b(S1|S2|D3|D4)\b/i);
        if (m) levels.add(m[1].toUpperCase());
      }
    }
  }

  const progStr = doc.program || metadata.program || '';
  if (progStr) {
    const m = progStr.match(/\b(S1|S2|D3|D4)\b/i);
    if (m) levels.add(m[1].toUpperCase());
  }

  const academicLevels = Array.from(levels);
  const academicLevel = doc.academicLevel || metadata.academicLevel || (academicLevels.length > 0 ? academicLevels[0] : null);

  const supportedPrograms = (Array.isArray(doc.supportedPrograms) && doc.supportedPrograms.length > 0)
    ? doc.supportedPrograms
    : ((Array.isArray(metadata.supportedPrograms) && metadata.supportedPrograms.length > 0)
      ? metadata.supportedPrograms
      : (Array.isArray(contextEntities) && contextEntities.length > 0 ? contextEntities : (progStr ? [progStr] : [])));

  let scope = doc.scope || metadata.scope || null;
  if (!scope) {
    if (supportedPrograms.length > 1) {
      scope = 'PROGRAM_MULTI';
    } else if (supportedPrograms.length === 1) {
      scope = 'PROGRAM_SINGLE';
    } else {
      scope = 'INSTITUTION';
    }
  }

  return { academicLevel, academicLevels, supportedPrograms, scope };
}

/**
 * Retrieves candidates matching RetrievalPlan
 * Integrates:
 * 1. BM25 Sparse Search over Governed Canonical Corpus (829 chunks)
 * 2. Production PostgreSQL PgVector Cosine Search (rag.corpus_vector_chunks) when active
 * 3. Reciprocal Rank Fusion (RRF) to merge and rank candidates
 */
async function retrieveCandidates(retrievalPlan = {}, { topK = 6, isShadowContractMode = false, enableHybridShadow = false, retrievalMode = 'auto', context = {} } = {}) {
  // Dedicated shadow-only boundary: legacy callers never receive contract early-exit behavior
  const contract = retrievalPlan.retrievalContract;
  if (isShadowContractMode && contract) {
    if (contract.retrievalState === 'NO_RETRIEVAL' ||
        contract.retrievalState === 'CLARIFICATION_REQUIRED' ||
        contract.retrievalState === 'NO_VERIFIED_ENTITY_EVIDENCE') {
      return [];
    }
  }

  await ensureCanonicalCorpus(context, { requireCanonical: true });
  const corpus = getCorpusIndex(context, { requireCanonical: true });
  if (!Array.isArray(corpus) || corpus.length < CANONICAL_CORPUS_MIN_CHUNKS) {
    logger.error({
      corpusSize: Array.isArray(corpus) ? corpus.length : 0,
      minRequired: CANONICAL_CORPUS_MIN_CHUNKS
    }, '[RetrievalService] Canonical corpus index is unavailable or below required threshold; failing closed');
    return [];
  }

  let variants = [];
  if (retrievalPlan.targetEntities && retrievalPlan.targetEntities.length > 1) {
    // Collect entity-matching variants, but also preserve top intent variants
    for (const ent of retrievalPlan.targetEntities) {
      const entVariants = (retrievalPlan.queryVariants || []).filter(v => v.toLowerCase().includes(ent.toLowerCase()));
      variants.push(...entVariants.slice(0, 2));
    }
    // Also include top intent-specific variants (e.g. visa, guidance, fees)
    const topVariants = (retrievalPlan.queryVariants || []).slice(0, 4);
    for (const tv of topVariants) {
      if (!variants.includes(tv)) variants.push(tv);
    }
    if (retrievalPlan.normalizedQuery && !variants.includes(retrievalPlan.normalizedQuery)) {
      variants.push(retrievalPlan.normalizedQuery);
    }
  } else if (retrievalPlan.queryVariants && retrievalPlan.queryVariants.length > 0) {
    variants = retrievalPlan.queryVariants.slice(0, 8);
    if (retrievalPlan.normalizedQuery && !variants.includes(retrievalPlan.normalizedQuery)) {
      variants.push(retrievalPlan.normalizedQuery);
    }
  } else {
    variants = [retrievalPlan.normalizedQuery || retrievalPlan.query || retrievalPlan.rawQuery || (contract ? contract.queryText : '')];
  }
  const query = variants.filter(Boolean).join(' ');
  if (!query) return [];

  const fileContextMap = getFileContextMap(corpus);
  const chunkSectionMap = getChunkSectionMap(corpus);

  // 1. BM25 Sparse Retrieval over governed text enriched with document context
  const textDocs = corpus.map((doc, idx) => {
    const f = doc.sourceFile || doc.filename || '';
    const sectionProg = chunkSectionMap.get(idx);
    const ctx = fileContextMap.get(f);
    const entStr = sectionProg || (ctx && ctx.entities && ctx.entities.length > 0 ? ctx.entities.join(' ') : '');
    const raw = doc.chunk || doc.text || (doc.metadata && (doc.metadata.chunk || doc.metadata.text)) || '';
    const textWithContext = entStr ? `${entStr} ${f} ${raw}` : `${f} ${raw}`;
    return { text: textWithContext };
  });

  const bm25Results = computeBm25Scores(query, textDocs);

  const targetEntities = (retrievalPlan.targetEntities || []).map(e => String(e).toLowerCase());
  const excludedEntities = (retrievalPlan.excludedConflictingEntities || []).map(e => String(e).toLowerCase());

  const scoredResults = bm25Results.map(r => {
    let score = r.score;
    if (score <= 0 || targetEntities.length === 0) return r;

    const doc = corpus[r.index];
    const f = doc.sourceFile || doc.filename || '';
    const sectionProg = (chunkSectionMap.get(r.index) || '').toLowerCase();
    const ctx = fileContextMap.get(f);
    const ctxEntities = (ctx?.entities || []).map(e => e.toLowerCase());
    const rawText = (doc.chunk || doc.text || '').toLowerCase();

    const matchesTarget = targetEntities.some(te => {
      const base = te.replace(/^(s1|d3|s2)\s+/i, '');
      const canon = findCanonicalEntity(te);
      const aliases = (canon && Array.isArray(canon.aliases)) ? canon.aliases.map(a => a.toLowerCase()) : [];
      return sectionProg.includes(te) ||
        sectionProg.includes(base) ||
        ctxEntities.some(ce => ce.includes(te) || ce.includes(base) || aliases.some(al => ce.includes(al))) ||
        rawText.includes(te) ||
        (base.length >= 4 && rawText.includes(base)) ||
        aliases.some(al => al.length >= 4 && rawText.includes(al));
    });

    const matchesExcluded = excludedEntities.some(ex => {
      const base = ex.replace(/^(s1|d3|s2)\s+/i, '');
      return (sectionProg.includes(ex) || sectionProg.includes(base)) && !matchesTarget;
    });

    if (matchesTarget) {
      score *= 1.8;
    } else if (matchesExcluded) {
      score *= 0.5;
    }

    // Boost fee documents when query is asking about tuition, fee, or registration cost
    const isFeeQuery = /\b(?:biaya|spp|dpp|uang kuliah|tarif|pembayaran)\b/i.test(query);
    if (isFeeQuery) {
      if (/rincian biaya/i.test(f) || ctx?.category === 'BIAYA' || /tabel rincian biaya|biaya kuliah per semester/i.test(rawText)) {
        score *= 2.5;
      }
    }

    // Aspect & Category alignment: Career prospects
    // Must be verified against original query intent and validated plan aspects, NOT polluted synthetic variants
    const userQueryText = String(retrievalPlan.rawQuery || retrievalPlan.normalizedQuery || (contract ? contract.queryText : '')).toLowerCase();
    const isCareerQuery = (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.some(a => ['career_prospects', 'career', 'prospek_karir'].includes(a))) ||
      retrievalPlan.intent === 'CAREER_PROSPECTS' ||
      retrievalPlan.intent === 'CAREER_PROSPECTS_INQUIRY' ||
      /\b(?:peluang\s+kar(?:i)?er|prospek\s+kar(?:i)?er|kar(?:i)?er|prospek\s+kerja|profesi\s+lulusan)\b/i.test(userQueryText);
    if (isCareerQuery) {
      if (/penjelasan prodi dan karier/i.test(f) || /peluang kerja|profil lulusan/i.test(rawText)) {
        score *= 2.5;
      }
      if (/rincian biaya/i.test(f) || ctx?.category === 'BIAYA') {
        score *= 0.1;
      }
    }

    // Aspect & Category alignment: Thesis requirements & guidelines
    const isThesisQuery = (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.some(a => ['pedoman_ta', 'thesis_requirements', 'guidance_procedure', 'thesis_stages'].includes(a))) ||
      retrievalPlan.intent === 'THESIS_REQUIREMENTS' ||
      retrievalPlan.intent === 'THESIS_GUIDANCE_PROCEDURE' ||
      /\b(?:tugas\s+akhir|skripsi|pedoman\s+ta)\b/i.test(query);
    if (isThesisQuery) {
      if (/(?:pedoman\s+ta|pedoman\s+skripsi)/i.test(f) || /tugas akhir|skripsi/i.test(rawText)) {
        score *= 3.0;
      }
      if (/kalender\s+akademik/i.test(f)) {
        score *= 0.2;
      }
    }

    // Boost overview, career, double degree, and facility docs for non-semester-specific overview queries
    const isOverview = !isFeeQuery && !/\b(?:semester\s+(?:[1-8]|i{1,3}|iv|v|vi|vii|viii))\b/i.test(query) &&
      /\b(?:mata\s+kuliah|kurikulum|bidang\s+keahlian|kompetensi|fokus|profil|peluang\s+kar(?:i)?er|prospek\s+kar(?:i)?er|prospek\s+kerja|double\s+degree|dual\s+degree|fasilitas|gelar)\b/i.test(query);

    if (isOverview) {
      if (/deskripsi singkat|profil program studi|fokus pada/i.test(rawText)) {
        score *= 2.5;
      }
      if (/buku ormawa himaprodi/i.test(f)) {
        score *= 2.5;
      }
      if (/penjelasan prodi dan karier/i.test(f)) {
        score *= 2.5;
      }
      if (/\b(?:double\s*degree|dual\s*degree|dua\s*gelar|gelar\s*ganda)\b/i.test(rawText) && targetEntities.some(te => /degree|gelar/i.test(te))) {
        score *= 2.0;
      }
      if (/fasilitas-stikom/i.test(f) && /\bfasilitas\b/i.test(query)) {
        score *= 4.0;
      }
      if (/faq pengurusan mahasiswa asing/i.test(f) && /\basing\b/i.test(query)) {
        score *= 3.0;
      }
    }

    // Aspect & Category alignment: Foreign student study permits
    const isStudyPermitQuery = (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.some(a => ['study_permit', 'izin_belajar'].includes(a))) ||
      retrievalPlan.intent === 'STUDY_PERMIT_INQUIRY' ||
      /\b(?:izin\s+belajar|study\s+permit)\b/i.test(query);
    if (isStudyPermitQuery && (/faq pengurusan mahasiswa asing/i.test(f) || /izin belajar|study permit/i.test(rawText))) {
      score *= 3.0;
    }

    // Negative invariant: foreign visa/student FAQ should not dominate general domestic PMB queries
    const isDomesticScope = retrievalPlan.participantScope === 'domestic' || !retrievalPlan.participantScope;
    const isForeignChunk = /FAQ PENGURUSAN MAHASISWA ASING|mahasiswa asing/i.test(f) || /\b(?:visa|izin\s+belajar|itas|kitas|sktt)\b/i.test(f);
    const isForeignQuery = /\b(?:asing|internasional|visa|izin\s+belajar|itas|kitas|sktt)\b/i.test(query);
    if (isDomesticScope && isForeignChunk && !isForeignQuery && !targetEntities.some(te => /asing|internasional/i.test(te))) {
      score *= 0.1;
    }

    return { index: r.index, score };
  });
  
  const candidatePoolDepth = enableHybridShadow ? Math.max(topK * 3, 36) : Math.max(topK * 2, 28);

  const rawBm25Sorted = scoredResults
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  // Apply syllabus chunk diversification cap if overview query:
  // Prevent more than 3 individual semester syllabus chunks from the same program from crowding out top candidates
  const isOverviewQuery = !/\b(?:semester\s+(?:[1-8]|i{1,3}|iv|v|vi|vii|viii))\b/i.test(query) &&
    /\b(?:mata\s+kuliah|kurikulum|bidang\s+keahlian|kompetensi|fokus|profil|peluang\s+karir|prospek\s+kerja|double\s+degree|dual\s+degree|fasilitas|gelar|biaya|spp)\b/i.test(query);

  let bm25Sorted = [];
  const syllabusCountPerProgram = new Map();
  for (const item of rawBm25Sorted) {
    const doc = corpus[item.index];
    const isSyllabus = /^curr-/i.test(doc.id);
    if (isOverviewQuery && isSyllabus) {
      const progKey = doc.program || (doc.id.match(/^curr-([a-z0-9]+)/i) || [])[1] || 'curr';
      const c = syllabusCountPerProgram.get(progKey) || 0;
      if (c >= 3) continue;
      syllabusCountPerProgram.set(progKey, c + 1);
    }
    bm25Sorted.push(item);
    if (bm25Sorted.length >= candidatePoolDepth) break;
  }

  const bm25Candidates = bm25Sorted.map(item => {
    const doc = corpus[item.index];
    const rawText = doc.chunk || doc.text || (doc.metadata && (doc.metadata.chunk || doc.metadata.text)) || '';
    const source = doc.filename || doc.source || (doc.metadata && doc.metadata.source) || 'unknown';
    const sourceFile = doc.sourceFile || doc.filename || source;
    const metadata = doc.metadata || doc || {};
    const ctx = fileContextMap.get(sourceFile);
    const sectionProg = chunkSectionMap.get(item.index);

    // Propagate document-level or section-level program entity to chunk text
    let enrichedText = rawText;
    let contextEntities = sectionProg ? [sectionProg] : (ctx ? ctx.entities : []);

    if (sectionProg) {
      if (!rawText.toLowerCase().includes(sectionProg.toLowerCase())) {
        enrichedText = `[Program: ${sectionProg}] ${rawText}`;
      }
    } else if (ctx && ctx.entities && ctx.entities.length > 0) {
      const hasAnyEnt = ctx.entities.some(e => rawText.toLowerCase().includes(e.toLowerCase()));
      if (!hasAnyEnt && (ctx.category === 'BIAYA' || /rincian biaya/i.test(sourceFile))) {
        enrichedText = `[Program: ${ctx.entities.join(', ')}] ${rawText}`;
      }
    }

    const entityIds = doc.entityIds || metadata.entityIds ||
      (contextEntities && contextEntities.length > 0 ? contextEntities : (doc.program ? [doc.program] : []));

    const rawCategory = metadata.docCategory || doc.docCategory || (ctx ? ctx.category : doc.category);
    const providedAspects = (Array.isArray(doc.providedAspects) && doc.providedAspects.length > 0)
      ? doc.providedAspects
      : ((Array.isArray(metadata.providedAspects) && metadata.providedAspects.length > 0)
        ? metadata.providedAspects
        : []);

    const { academicLevel, academicLevels, supportedPrograms, scope } = extractCandidateAcademicProperties(doc, metadata, contextEntities, sectionProg);
    const provenanceDocumentId = doc.provenanceDocumentId || metadata.provenanceDocumentId || doc.trainingId || doc.id || null;

    return {
      id: doc.id || `chunk_${item.index}`,
      source_record_id: doc.id || `chunk_${item.index}`,
      source_record_index: item.index,
      index: item.index,
      score: item.score,
      text: enrichedText,
      rawText,
      chunk: enrichedText,
      source,
      sourceFile,
      source_file: sourceFile,
      sourceDocument: sourceFile,
      program: doc.program || metadata.program || null,
      canonicalEntity: doc.canonicalEntity || metadata.canonicalEntity || null,
      scope,
      supportedPrograms,
      level: doc.level || metadata.level || academicLevel || null,
      correctedLevel: doc.correctedLevel || metadata.correctedLevel || null,
      metadata,
      docCategory: rawCategory,
      contextEntities,
      entityIds,
      providedAspects,
      academicLevel,
      academicLevels,
      provenanceDocumentId,
      validFrom: doc.validFrom || metadata.validFrom || null,
      validTo: doc.validTo || metadata.validTo || null
    };
  });

  // 2. Production / Shadow PgVector Retrieval
  let vectorCandidates = [];
  const useVector = isPgVectorProductionEnabled() || Boolean(enableHybridShadow) || retrievalMode === 'dense';
  if (useVector) {
    try {
      // Build a rich semantic query text from plan's targetEntities, aspects, and clean keywords
      const targetEnts = (retrievalPlan.targetEntities || []).join(' ');
      const reqAspects = (retrievalPlan.requiredAspects || []).join(' ');
      const denseQuery = [targetEnts, reqAspects, query].filter(Boolean).join(' ').trim() || query;

      const [emb] = await computeBatchQueryEmbeddings([denseQuery]);
      if (emb && Array.isArray(emb) && emb.length === 1536) {
        const bindingItem = {
          binding: {
            bindingId: 'b_primary',
            constraints: null
          },
          embedding: emb
        };
        const searchRes = await searchVectorChunksMultiBinding([bindingItem], candidatePoolDepth);
        vectorCandidates = searchRes.b_primary || [];
      }
    } catch (vectorErr) {
      logger.warn({ err: vectorErr.message }, '[RetrievalService] PgVector query fallback to BM25');
    }
  }

  // 3. Dense-Only Retrieval Path
  if (retrievalMode === 'dense') {
    const corpusIdMap = new Map();
    for (let i = 0; i < corpus.length; i++) {
      const c = corpus[i];
      if (c.id) corpusIdMap.set(c.id, { doc: c, index: i });
      if (c.source_record_id) corpusIdMap.set(c.source_record_id, { doc: c, index: i });
    }

    return vectorCandidates.slice(0, topK).map(item => {
      const candId = item.id || item.source_record_id;
      const corpusMatch = corpusIdMap.get(candId) || (item.source_record_index != null ? { doc: corpus[item.source_record_index], index: item.source_record_index } : null);
      if (corpusMatch && corpusMatch.doc) {
        const doc = corpusMatch.doc;
        const itemIdx = corpusMatch.index;
        const rawText = doc.chunk || doc.text || (doc.metadata && (doc.metadata.chunk || doc.metadata.text)) || item.chunk || '';
        const source = doc.filename || doc.source || (doc.metadata && doc.metadata.source) || item.source_file || 'unknown';
        const sourceFile = doc.sourceFile || doc.filename || source;
        const metadata = doc.metadata || doc || {};
        const ctx = fileContextMap.get(sourceFile);
        const sectionProg = chunkSectionMap.get(itemIdx);

        let enrichedText = rawText;
        let contextEntities = sectionProg ? [sectionProg] : (ctx ? ctx.entities : []);
        if (sectionProg) {
          if (!rawText.toLowerCase().includes(sectionProg.toLowerCase())) {
            enrichedText = `[Program: ${sectionProg}] ${rawText}`;
          }
        } else if (ctx && ctx.entities && ctx.entities.length > 0) {
          const hasAnyEnt = ctx.entities.some(e => rawText.toLowerCase().includes(e.toLowerCase()));
          if (!hasAnyEnt && (ctx.category === 'BIAYA' || /rincian biaya/i.test(sourceFile))) {
            enrichedText = `[Program: ${ctx.entities.join(', ')}] ${rawText}`;
          }
        }

        const entityIds = doc.entityIds || metadata.entityIds ||
          (contextEntities && contextEntities.length > 0 ? contextEntities : (doc.program ? [doc.program] : []));
        const rawCategory = metadata.docCategory || doc.docCategory || (ctx ? ctx.category : doc.category) || item.doc_category;
        const providedAspects = (Array.isArray(doc.providedAspects) && doc.providedAspects.length > 0)
          ? doc.providedAspects
          : ((Array.isArray(metadata.providedAspects) && metadata.providedAspects.length > 0)
            ? metadata.providedAspects
            : []);
        const { academicLevel, academicLevels, supportedPrograms, scope } = extractCandidateAcademicProperties(doc, metadata, contextEntities, null);
        const provenanceDocumentId = doc.provenanceDocumentId || metadata.provenanceDocumentId || doc.trainingId || doc.id || null;

        return {
          id: doc.id || candId || `chunk_${itemIdx}`,
          source_record_id: doc.id || candId || `chunk_${itemIdx}`,
          source_record_index: itemIdx,
          index: itemIdx,
          score: item.similarity || 0,
          text: enrichedText,
          rawText,
          chunk: enrichedText,
          source,
          source_file: sourceFile,
          sourceDocument: sourceFile,
          program: doc.program || metadata.program || null,
          canonicalEntity: doc.canonicalEntity || metadata.canonicalEntity || null,
          scope,
          supportedPrograms,
          level: doc.level || metadata.level || academicLevel || null,
          correctedLevel: doc.correctedLevel || metadata.correctedLevel || null,
          metadata,
          docCategory: rawCategory,
          contextEntities,
          entityIds,
          providedAspects,
          academicLevel,
          academicLevels,
          provenanceDocumentId,
          validFrom: doc.validFrom || metadata.validFrom || null,
          validTo: doc.validTo || metadata.validTo || null
        };
      }
      return item;
    });
  }

  // 4. Hybrid RRF Fusion
  if (Array.isArray(vectorCandidates) && vectorCandidates.length > 0) {
    const rrfCandidates = computeBindingRRF(bm25Candidates, vectorCandidates, 60);

    // Build ID map from BM25 candidates to reuse enriched properties
    const bm25Map = new Map();
    for (const b of bm25Candidates) {
      if (b.id) bm25Map.set(b.id, b);
      if (b.source_record_id) bm25Map.set(b.source_record_id, b);
    }

    // Corpus ID and index map
    const corpusIdMap = new Map();
    for (let i = 0; i < corpus.length; i++) {
      const c = corpus[i];
      if (c.id) corpusIdMap.set(c.id, { doc: c, index: i });
      if (c.source_record_id) corpusIdMap.set(c.source_record_id, { doc: c, index: i });
    }

    const sortedRrf = rrfCandidates.slice(0, topK).map(item => {
      const candId = item.id || item.source_record_id;
      if (bm25Map.has(candId)) {
        const existing = bm25Map.get(candId);
        return {
          ...existing,
          score: item.rrf_score || existing.score,
          rrf_score: item.rrf_score,
          legacy_rank: item.legacy_rank,
          vector_rank: item.vector_rank
        };
      }

      // If candidate was purely from vector search, hydrate full metadata from corpus
      const corpusMatch = corpusIdMap.get(candId) || (item.source_record_index != null ? { doc: corpus[item.source_record_index], index: item.source_record_index } : null);
      if (corpusMatch && corpusMatch.doc) {
        const doc = corpusMatch.doc;
        const itemIdx = corpusMatch.index;
        const rawText = doc.chunk || doc.text || (doc.metadata && (doc.metadata.chunk || doc.metadata.text)) || item.chunk || '';
        const source = doc.filename || doc.source || (doc.metadata && doc.metadata.source) || item.source_file || 'unknown';
        const sourceFile = doc.sourceFile || doc.filename || source;
        const metadata = doc.metadata || doc || {};
        const ctx = fileContextMap.get(sourceFile);
        const sectionProg = chunkSectionMap.get(itemIdx);

        let enrichedText = rawText;
        let contextEntities = sectionProg ? [sectionProg] : (ctx ? ctx.entities : []);
        if (sectionProg) {
          if (!rawText.toLowerCase().includes(sectionProg.toLowerCase())) {
            enrichedText = `[Program: ${sectionProg}] ${rawText}`;
          }
        } else if (ctx && ctx.entities && ctx.entities.length > 0) {
          const hasAnyEnt = ctx.entities.some(e => rawText.toLowerCase().includes(e.toLowerCase()));
          if (!hasAnyEnt && (ctx.category === 'BIAYA' || /rincian biaya/i.test(sourceFile))) {
            enrichedText = `[Program: ${ctx.entities.join(', ')}] ${rawText}`;
          }
        }

        const entityIds = doc.entityIds || metadata.entityIds ||
          (contextEntities && contextEntities.length > 0 ? contextEntities : (doc.program ? [doc.program] : []));
        const rawCategory = metadata.docCategory || doc.docCategory || (ctx ? ctx.category : doc.category) || item.doc_category;
        const providedAspects = (Array.isArray(doc.providedAspects) && doc.providedAspects.length > 0)
          ? doc.providedAspects
          : ((Array.isArray(metadata.providedAspects) && metadata.providedAspects.length > 0)
            ? metadata.providedAspects
            : []);
        const { academicLevel, academicLevels, supportedPrograms, scope } = extractCandidateAcademicProperties(doc, metadata, contextEntities, sectionProg);
        const provenanceDocumentId = doc.provenanceDocumentId || metadata.provenanceDocumentId || doc.trainingId || doc.id || null;

        return {
          id: doc.id || candId || `chunk_${itemIdx}`,
          source_record_id: doc.id || candId || `chunk_${itemIdx}`,
          source_record_index: itemIdx,
          index: itemIdx,
          score: item.rrf_score || item.similarity || 0,
          rrf_score: item.rrf_score,
          legacy_rank: item.legacy_rank,
          vector_rank: item.vector_rank,
          text: enrichedText,
          rawText,
          chunk: enrichedText,
          source,
          sourceFile,
          source_file: sourceFile,
          sourceDocument: sourceFile,
          program: doc.program || metadata.program || null,
          canonicalEntity: doc.canonicalEntity || metadata.canonicalEntity || null,
          scope,
          supportedPrograms,
          level: doc.level || metadata.level || academicLevel || null,
          correctedLevel: doc.correctedLevel || metadata.correctedLevel || null,
          metadata,
          docCategory: rawCategory,
          contextEntities,
          entityIds,
          providedAspects,
          academicLevel,
          academicLevels,
          provenanceDocumentId,
          validFrom: doc.validFrom || metadata.validFrom || null,
          validTo: doc.validTo || metadata.validTo || null
        };
      }

      // Fallback if not in corpus
      return {
        id: candId || `chunk_${item.source_record_index}`,
        source_record_id: candId || `chunk_${item.source_record_index}`,
        source_record_index: item.source_record_index ?? 0,
        index: item.source_record_index ?? 0,
        score: item.rrf_score || item.similarity || 0,
        rrf_score: item.rrf_score,
        legacy_rank: item.legacy_rank,
        vector_rank: item.vector_rank,
        text: item.chunk || '',
        rawText: item.chunk || '',
        chunk: item.chunk || '',
        source: item.source_file || 'pgvector_hybrid',
        sourceFile: item.source_file || 'pgvector_hybrid',
        source_file: item.source_file || 'pgvector_hybrid',
        sourceDocument: item.source_file || 'pgvector_hybrid',
        metadata: item,
        docCategory: item.doc_category || null,
        validFrom: null,
        validTo: null
      };
    });

    return sortedRrf;
  }

  // Pure BM25 fallback
  return bm25Candidates.slice(0, topK);
}

/**
 * End-to-End Scoped Retrieval Entry Point using RetrievalContract directly.
 * Dedicated shadow-only method ensuring complete isolation from legacy production callers.
 */
async function retrieveCandidatesScopedWithContract(retrievalContract, options = {}) {
  const plan = {
    queryVariants: [retrievalContract.queryText],
    retrievalContract
  };
  return retrieveCandidates(plan, { ...options, isShadowContractMode: true });
}

/**
 * Safe diagnostic readiness check for Chat Engine V2 corpus.
 * Returns structured metadata without exposing chunk content or secrets.
 */
function verifyCorpusReadiness(context = {}) {
  const corpus = getCorpusIndex(context, { requireCanonical: true });
  const isReady = Array.isArray(corpus) && corpus.length >= CANONICAL_CORPUS_MIN_CHUNKS;
  return {
    isReady,
    chunkCount: Array.isArray(corpus) ? corpus.length : 0,
    minRequired: CANONICAL_CORPUS_MIN_CHUNKS,
    status: isReady ? 'READY' : 'UNAVAILABLE'
  };
}

module.exports = {
  retrieveCandidates,
  retrieveCandidatesScopedWithContract,
  isPgVectorProductionEnabled,
  verifyCorpusReadiness,
  CANONICAL_CORPUS_MIN_CHUNKS
};
