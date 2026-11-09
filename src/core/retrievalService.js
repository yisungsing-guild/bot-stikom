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

const { CANONICAL_ENTITIES } = require('../engine/canonicalEntityRegistry');

const fileContextCache = new WeakMap();
const chunkSectionCache = new WeakMap();

function getChunkSectionMap(corpus) {
  if (!Array.isArray(corpus)) return new Map();
  const cached = chunkSectionCache.get(corpus);
  if (cached) return cached;
  const chunkSectionMap = new Map();

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
    /Profil\s+Program\s+Studi[\s\n]+(?:Program\s+Studi\s+)?([A-Za-z\s]+?)(?:\s+di\s+ITB|\s+dirancang|\n|$)/i,
    /Nama\s+Program\s+Studi\s*:\s*([A-Za-z0-9\s]+?)(?:\.|\n|$)/i,
    /(?:Program(?:\s+Studi)?|Jenjang)\s*:?\s*(Magister\s+Sistem\s+Informasi(?:\s*\(S2\))?|S2\s+Sistem\s+Informasi)/i,
    /###\s+(?:Program\s+Studi\s+)?([A-Za-z0-9\s,\(\)]+?)(?:\n|$)/i,
    /Penjelasan\s+Prodi\s+dan\s+Karier\s+Masa\s+Depan\s*:\s*([A-Za-z\s]+?)(?:\||\n|$)/i,
    /(?:(?:mana)?jemen\s+informatika|men[\s\n]+informatika)\s*\(\s*D3\s*\)/i,
    /(?:BIAYA\s+PENDIDIKAN\s+(?:MAHASISWA\s+BARU\s+)?PASCASARJANA|PROGRAM\s+PASCASARJANA)/i
  ];

  for (const [fileName, group] of fileGroups.entries()) {
    if (/chatbot\s*-\s*double\s*degree|student\s+exchange|hi-think/i.test(fileName)) continue;
    let currentProg = null;
    for (const { index, doc } of group) {
      const txt = doc.chunk || doc.text || '';
      if (/^Ringkasan dokumen:/i.test(txt.trim())) continue;
      let matchedEnt = null;
      let delimIndex = -1;

      for (const pat of SECTION_PATTERNS) {
        const m = txt.match(pat);
        if (!m) continue;
        let candidateName = m[1] ? m[1].trim() : m[0].trim();
        if (/pascasarjana/i.test(m[0])) candidateName = 'S2 Sistem Informasi';
        else if (/manajemen\s+informasi|men[\s\n]+informatika|manajemen\s+informatika/i.test(candidateName)) candidateName = 'D3 Manajemen Informatika';

        for (const ent of CANONICAL_ENTITIES) {
          if (ent.family !== 'academic_program') continue;
          const base = ent.canonical.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase();
          if (!candidateName.toLowerCase().includes(base) && candidateName.toLowerCase() !== ent.canonical.toLowerCase()) continue;
          if (/\b(?:d3|diploma)\b/i.test(candidateName) && !ent.canonical.startsWith('D3')) continue;
          if (/\b(?:s2|magister)\b/i.test(candidateName) && !ent.canonical.startsWith('S2')) continue;
          if (/\b(?:s1|sarjana)\b/i.test(candidateName) && !ent.canonical.startsWith('S1')) continue;
          matchedEnt = ent.canonical;
          delimIndex = txt.indexOf(m[0]);
          break;
        }
        if (matchedEnt) break;
      }

      if (matchedEnt) {
        if (delimIndex > txt.length * 0.5) {
          if (currentProg) chunkSectionMap.set(index, currentProg);
          currentProg = matchedEnt;
          continue;
        }
        currentProg = matchedEnt;
      }
      if (currentProg) chunkSectionMap.set(index, currentProg);
    }
  }

  chunkSectionCache.set(corpus, chunkSectionMap);
  return chunkSectionMap;
}

function getFileContextMap(corpus) {
  if (!Array.isArray(corpus)) return new Map();
  const cached = fileContextCache.get(corpus);
  if (cached) return cached;
  const fileContextMap = new Map();

  // Group the corpus once so metadata derivation is O(chunks), not O(files × chunks).
  const chunksByFile = new Map();
  for (const doc of corpus) {
    const fileName = doc.sourceFile || doc.filename || '';
    if (!fileName) continue;
    if (!chunksByFile.has(fileName)) chunksByFile.set(fileName, []);
    chunksByFile.get(fileName).push(doc);
  }

  for (const [fileName, docChunks] of chunksByFile.entries()) {
    const entities = new Set();
    let category = docChunks[0]?.docCategory || docChunks[0]?.metadata?.docCategory || '';

    for (const chunk of docChunks) {
      const txt = chunk.chunk || chunk.text || '';
      if (!category && (txt.includes('BIAYA PENDIDIKAN') || /rincian biaya/i.test(fileName))) category = 'BIAYA';
      if (/\b(?:pascasarjana|magister)\b/i.test(txt) || /\b(?:pascasarjana|magister)\b/i.test(fileName)) {
        entities.add('S2 Sistem Informasi');
      }

      const programMatch = txt.match(/PROGRAM STUDI\s+([A-Z0-9\s,\(\)]+?)(?:T\.A|\n|$)/i);
      if (programMatch) {
        const programName = programMatch[1].trim();
        for (const entity of CANONICAL_ENTITIES) {
          if (entity.family !== 'academic_program') continue;
          const hasS2 = /\b(?:s2|magister|pascasarjana)\b/i.test(programName) || /\b(?:s2|magister|pascasarjana)\b/i.test(fileName);
          const hasD3 = /\b(?:d3|diploma)\b/i.test(programName) || /\b(?:d3|diploma)\b/i.test(fileName);
          if (entity.canonical.startsWith('S2') && !hasS2) continue;
          if (entity.canonical.startsWith('D3') && !hasD3) continue;
          if (entity.canonical.startsWith('S1') && hasS2 && !/\b(?:s1|sarjana)\b/i.test(programName) && !/\b(?:s1|sarjana)\b/i.test(fileName)) continue;

          const baseName = entity.canonical.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase();
          const matchesCanonical = programName.toLowerCase().includes(baseName);
          const matchesAlias = Array.isArray(entity.aliases) && entity.aliases.some(alias =>
            alias.length >= 3 && programName.toLowerCase().includes(alias.toLowerCase())
          );
          if (matchesCanonical || matchesAlias) entities.add(entity.canonical);
        }
      }

      for (const entity of CANONICAL_ENTITIES) {
        if (!Array.isArray(entity.aliases)) continue;
        const matchesFile = entity.aliases.some(alias => {
          if (alias.length < 2) return false;
          const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp('\\b' + escaped + '\\b', 'i').test(fileName);
        });
        if (!matchesFile) continue;
        const hasS2 = /\b(?:s2|magister|pascasarjana)\b/i.test(fileName);
        const hasD3 = /\b(?:d3|diploma)\b/i.test(fileName);
        if (entity.canonical.startsWith('S2') && !hasS2) continue;
        if (entity.canonical.startsWith('D3') && !hasD3) continue;
        entities.add(entity.canonical);
      }
    }

    fileContextMap.set(fileName, { category, entities: Array.from(entities) });
  }

  fileContextCache.set(corpus, fileContextMap);
  return fileContextMap;
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
  // Keep the current user's query separate from synthetic retrieval expansions.
  // Previously all variants were concatenated into one BM25 query, allowing an
  // expansion for a neighboring concept to distort intent-sensitive scoring.
  const query = String(
    retrievalPlan.normalizedQuery || retrievalPlan.query || retrievalPlan.rawQuery ||
    (contract && contract.queryText) || variants[0] || ''
  ).trim();
  const searchQueries = [...new Set([query, ...variants]
    .map(value => String(value || '').trim())
    .filter(Boolean))].slice(0, 10);
  if (searchQueries.length === 0) return [];

  const fileContextMap = getFileContextMap(corpus);
  const chunkSectionMap = getChunkSectionMap(corpus);

  // 1. BM25 Sparse Retrieval over governed text enriched with document context
  const textDocs = corpus.map((doc, idx) => {
    const f = doc.sourceFile || doc.filename || '';
    const sectionProg = chunkSectionMap.get(idx);
    const ctx = fileContextMap.get(f);
    const entStr = sectionProg || (ctx && ctx.entities && ctx.entities.length > 0 ? ctx.entities.join(' ') : '');
    let raw = doc.chunk || doc.text || (doc.metadata && (doc.metadata.chunk || doc.metadata.text)) || '';
    if (/rincian\s+biaya/i.test(f) || (ctx && ctx.category === 'BIAYA')) {
      if (/^\s*\(dpp\)\s*:/i.test(raw)) {
        raw = 'Beasiswa untuk Dana Pendidikan Pokok ' + raw;
      }
      if (/beasiswa\s+untuk\s+dana\s+pendidikan\s+pokok|\(dpp\)\s*:|potongan\s+biaya/i.test(raw)) {
        if (idx + 1 < corpus.length && (corpus[idx + 1].sourceFile || corpus[idx + 1].filename) === f) {
          raw += ' ' + (corpus[idx + 1].chunk || corpus[idx + 1].text || '');
        }
        if (idx + 2 < corpus.length && (corpus[idx + 2].sourceFile || corpus[idx + 2].filename) === f) {
          raw += ' ' + (corpus[idx + 2].chunk || corpus[idx + 2].text || '');
        }
      } else if (/^\s*(?:rp\.?\s*\d|gelombang\s+khusus)/i.test(raw) && idx > 0 && (corpus[idx - 1].sourceFile || corpus[idx - 1].filename) === f) {
        raw = (corpus[idx - 1].chunk || corpus[idx - 1].text || '') + ' ' + raw;
      }
    }
    const textWithContext = entStr ? `${entStr} ${f} ${raw}` : `${f} ${raw}`;
    return { text: textWithContext };
  });

  // Multi-representation sparse retrieval: rank each paraphrase independently,
  // then fuse ranks. The user's own wording receives a modestly higher weight;
  // expansions improve recall but cannot overwhelm the current-turn intent.
  const bm25RankScores = new Map();
  const variantCandidateDepth = Math.max(topK * 8, 48);
  for (const searchQuery of searchQueries) {
    const ranked = computeBm25Scores(searchQuery, textDocs)
      .filter(result => result && Number.isInteger(result.index) &&
        result.index >= 0 && result.index < corpus.length &&
        Number.isFinite(result.score) && result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, variantCandidateDepth);
    const queryWeight = searchQuery === query ? 1.5 : 1;
    ranked.forEach((result, rankIndex) => {
      const previous = bm25RankScores.get(result.index) || 0;
      bm25RankScores.set(
        result.index,
        previous + (queryWeight / (60 + rankIndex + 1)) * 1000
      );
    });
  }
  const bm25Results = Array.from(bm25RankScores, ([index, score]) => ({ index, score }));

  const targetEntities = (retrievalPlan.targetEntities || []).map(e => String(e).toLowerCase());
  const excludedEntities = (retrievalPlan.excludedConflictingEntities || []).map(e => String(e).toLowerCase());

  // UKM Intent Classification (Stage 3B.1 - ID 330)
  const isUkmDomain = retrievalPlan?.domain === 'ORGANIZATION_UKM' ||
    (retrievalPlan?.requiredAspects && retrievalPlan.requiredAspects.some(a => ['ukm', 'student_organization', 'activities', 'arts_culture', 'sports'].includes(a))) ||
    /\b(?:ukm|ormawa|organisasi\s+kemahasiswaan|himaprodi|pembina\s+ormawa|sk\s+pembina)\b/i.test(query);

  const isAdvisorOrLegalityQuery = isUkmDomain && (
    retrievalPlan?.intent === 'ORGANIZATION_ADVISOR' ||
    retrievalPlan?.intent === 'ORGANIZATION_LEGALITY' ||
    (retrievalPlan?.requiredAspects && retrievalPlan.requiredAspects.some(a => ['advisor', 'pembina', 'legality', 'sk'].includes(a))) ||
    /\b(?:dosen\s+pembina|pembina|nama\s+pembina|siapa\s+pembina|sk\s+pembina|surat\s+keputusan|legalitas|struktur\s+pembina|dasar\s+hukum|sk\s+rektor)\b/i.test(query)
  );

  const isUkmProfileOrActivityQuery = isUkmDomain && !isAdvisorOrLegalityQuery && (
    retrievalPlan?.intent === 'ORGANIZATION_INQUIRY' ||
    retrievalPlan?.intent === 'ORGANIZATION_PROFILE' ||
    retrievalPlan?.intent === 'ORGANIZATION_ACTIVITIES' ||
    (retrievalPlan?.requiredAspects && retrievalPlan.requiredAspects.some(a => ['activities', 'student_organization', 'arts_culture', 'sports'].includes(a))) ||
    /\b(?:profil|kegiatan|aktivitas|fokus|latihan|tersedia|apakah\s+(?:ada|tersedia)|ada\s+ukm|seni|musik|vokal|suara|tari|olahraga|futsal|basket|teater|jurnalistik|fotografi)\b/i.test(query)
  );

  const isGeneralUkmListQuery = isUkmDomain && !isAdvisorOrLegalityQuery && !isUkmProfileOrActivityQuery && (
    retrievalPlan?.intent === 'ORGANIZATION_CATEGORY_LIST' ||
    retrievalPlan?.intent === 'ORGANIZATION_LIST' ||
    retrievalPlan?.intent === 'DISCOVER_LIST' ||
    /\b(?:kategori\s+ukm|daftar\s+ukm|apa\s+saja\s+ukm|semua\s+ukm|rekomendasi\s+ukm)\b/i.test(query)
  );

  const scoredResults = bm25Results.map(r => {
    let score = r.score;
    if (score <= 0) return r;

    const doc = corpus[r.index];
    const f = doc.sourceFile || doc.filename || '';
    const sectionProg = (chunkSectionMap.get(r.index) || '').toLowerCase();
    const ctx = fileContextMap.get(f);
    const ctxEntities = (ctx?.entities || []).map(e => e.toLowerCase());
    const rawText = (doc.chunk || doc.text || '').toLowerCase();
    const normalizedRawText = rawText.replace(/\s+/g, ' ');
    const isMiD3Chunk = (/manajemen\s+informatika|men\s+informatika/i.test(normalizedRawText)) && /\(d3\)|diploma/i.test(normalizedRawText);

    if (targetEntities.length > 0) {
      const matchesTarget = targetEntities.some(te => {
        const base = te.replace(/^(s1|d3|s2)\s+/i, '');
        return sectionProg.includes(te) ||
          sectionProg.includes(base) ||
          ctxEntities.some(ce => ce.includes(te) || ce.includes(base)) ||
          rawText.includes(te) ||
          (base.length >= 4 && rawText.includes(base));
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
    }

    // Degree-scoping alignment for Fee queries (S2 vs S1/D3)
    const isS2FeeTarget = (retrievalPlan.academicLevel === 'S2') ||
      targetEntities.some(te => /\bs2\b/i.test(te)) ||
      /\b(?:s2|magister|pascasarjana)\b/i.test(query);

    // Metadata & aspect driven scoring for Fee and Curriculum inquiries
    const isNegativeFee = /\b(?:jangan|tidak\s+usah|tanpa|bukan|skip)\s+(?:sebutkan\s+|bahas\s+)?(?:biaya|spp|dpp)/i.test(query);
    const hasFeeAspect = !isNegativeFee && (
      retrievalPlan.intent === 'TUITION_FEE_INQUIRY' ||
      retrievalPlan.domain === 'TUITION_FEE' ||
      (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.some(a => ['fee', 'tuition', 'dpp', 'cost'].includes(a))) ||
      /\b(?:biaya|spp|dpp|uang\s+kuliah|tarif|bayar)\b/i.test(query)
    );
    const isFeeQuery = hasFeeAspect;
    const hasCurriculumAspect = (
      retrievalPlan.intent === 'CURRICULUM_INQUIRY' ||
      retrievalPlan.domain === 'ACADEMIC_CURRICULUM' ||
      (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.some(a => ['curriculum', 'courses', 'sks'].includes(a))) ||
      /\b(?:kurikulum|mata\s+kuliah|silabus|sebaran)\b/i.test(query)
    );

    const isFeeDoc = doc.category === 'BIAYA' || doc.docCategory === 'BIAYA' ||
      ctx?.category === 'BIAYA' ||
      /rincian\s+biaya/i.test(f) ||
      /\b(?:tabel\s+rincian\s+biaya|biaya\s+kuliah\s+per\s+semester|dana\s+pendidikan\s+pokok|\(dpp\)|spp)\b/i.test(rawText);

    const isCurriculumDoc = doc.category === 'KURIKULUM' || doc.docCategory === 'KURIKULUM' ||
      ctx?.category === 'KURIKULUM' ||
      /\b(?:kurikulum|sebaran\s+mata\s+kuliah|daftar\s+mata\s+kuliah|mata\s+kuliah|silabus)\b/i.test(rawText);

    if (hasFeeAspect) {
      if (isFeeDoc) {
        score *= 2.5;
        if (isS2FeeTarget) {
          if (/pascasarjana|magister|s2/i.test(f) || /pascasarjana|magister sistem informasi/i.test(rawText)) {
            score *= 4.0;
          } else if (!/pascasarjana/i.test(rawText)) {
            score *= 0.15;
          }
        } else {
          if (/pascasarjana/i.test(f) || /biaya pendidikan mahasiswa baru pascasarjana/i.test(rawText)) {
            score *= 0.2;
          }
        }
      }
    }

    if (hasCurriculumAspect) {
      if (isCurriculumDoc) {
        score *= 3.0;
      }
    }

    // Downweight fee documents ONLY when user asks for curriculum without fee (or explicitly negates fee)
    if (hasCurriculumAspect && !hasFeeAspect && isFeeDoc) {
      score *= 0.1;
    }

    // Boost campus location documents
    const isLocationQuery = retrievalPlan.intent === 'CAMPUS_LOCATION' ||
      /\b(?:lokasi\s+kampus|alamat\s+kampus|kampus\s+(?:renon|jimbaran|abiansemal)|dimana\s+kampus)\b/i.test(query);
    if (isLocationQuery) {
      if (/fasilitas-stikom|profil|kampus/i.test(f) || /jalan raya puputan|renon|jimbaran|abiansemal/i.test(rawText)) {
        score *= 3.5;
      }
    }

    // Boost faculty structure documents
    const isFacultyQuery = retrievalPlan.intent === 'FACULTY_INQUIRY' ||
      /\b(?:fakultas|informatika dan komputer|bisnis dan vokasi)\b/i.test(query);
    if (isFacultyQuery) {
      if (/struktur|organisasi|profil|rektorat|pedoman/i.test(f) || /fakultas\s+(?:informatika|bisnis)/i.test(rawText)) {
        score *= 3.0;
      }
    }

        // Boost program overview documents and downweight pure fee tables for overview inquiries
    const isProgramOverviewQuery = retrievalPlan.intent === 'PROGRAM_OVERVIEW' ||
      (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.includes('overview'));
    if (isProgramOverviewQuery) {
      if (/isian website|penjelasan prodi/i.test(f) || /fokus praktis pada pengelolaan|deskripsi singkat/i.test(normalizedRawText)) {
        score *= 3.0;
      } else if (!hasFeeAspect && /rincian biaya/i.test(f)) {
        score *= 0.25;
      }
    }

    // Boost PMB academic year chunk (chunk d4f04a88 with "Tahun Akademik: 2026/2027")
    const isPmbAcademicYearQuery = (retrievalPlan.domain === 'PMB' || /pendaftaran|pmb/i.test(query)) &&
      /\b(?:tahun\s+akademik|menerima\s+mahasiswa|tahun\s+ini)\b/i.test(query);
    if (isPmbAcademicYearQuery) {
      if (/tahun\s+akademik\s*:\s*2026\/2027/i.test(normalizedRawText)) {
        score *= 4.0;
      }
    }

    // Boost PMB Admission Schedule & Wave Calendar documents (Kalender Pendaftaran.xlsx)
    const isScheduleInquiry = (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.some(a => ['schedule', 'waves', 'dates'].includes(a))) ||
      retrievalPlan.intent === 'ADMISSION_SCHEDULE' ||
      /\b(?:jadwal|gelombang|kalender\s+pendaftaran|kapan\s+(?:buka|tutup|pendaftaran)|batas\s+akhir|tes\s+seleksi|pengumuman\s+hasil|testing|registrasi\s+ulang)\b/i.test(query);
    if (isScheduleInquiry) {
      if (/kalender\s+pendaftaran/i.test(f) || ctx?.category === 'JADWAL' || doc.category === 'JADWAL') {
        score *= 4.0;
      }
    }

    // Boost RPL (Rekognisi Pembelajaran Lampau) documents
    const isRplInquiry = (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.includes('rpl')) ||
      /\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(query);
    if (isRplInquiry) {
      if (/pedoman-rpl/i.test(f) || /rekognisi pembelajaran lampau/i.test(rawText)) {
        score *= 4.5;
      }
    }

    // Boost program accreditation documents
    const hasAccreditationAspect = (
      retrievalPlan.intent === 'PROGRAM_ACCREDITATION' ||
      retrievalPlan.intent === 'INSTITUTIONAL_ACCREDITATION' ||
      (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.some(a => ['accreditation', 'akreditasi', 'peringkat'].includes(a))) ||
      /\b(?:akreditasi|terakreditasi|ban-?pt|lam-?infokom)\b/i.test(query)
    );
    if (hasAccreditationAspect) {
      if (/sertifikat akreditasi|akreditasi/i.test(f) || /\b(?:terakreditasi|sertifikat akreditasi|lam\s*infokom|peringkat akreditasi)\b/i.test(rawText)) {
        score *= 3.0;
      }
    }

    // Aspect & Category alignment: Career prospects
    const isCareerQuery = (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.includes('career_prospects')) ||
      retrievalPlan.intent === 'CAREER_PROSPECTS' ||
      /\b(?:peluang\s+kar(?:i)?er|prospek\s+kar(?:i)?er|kar(?:i)?er|prospek\s+kerja|profesi\s+lulusan)\b/i.test(query);
    if (isCareerQuery) {
      if (/penjelasan prodi dan karier/i.test(f) || /peluang kerja|profil lulusan/i.test(rawText)) {
        score *= 2.5;
      }
      if (!hasFeeAspect && (/rincian biaya/i.test(f) || ctx?.category === 'BIAYA')) {
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
    const isDoubleDegreeQuery = /\b(?:double\s+degree|dual\s+degree|help\s+university|dalian|dnui)\b/i.test(query) ||
      retrievalPlan.intent === 'INTERNATIONAL_PROGRAM_INFO' ||
      targetEntities.some(te => /double\s*degree|dual\s*degree|help|dnui/i.test(te));

    if (!isFeeQuery && isDoubleDegreeQuery) {
      if (/chatbot\s*-\s*double\s*degree/i.test(f)) {
        score *= 6.0;
      } else if (/rincian biaya/i.test(f) && !/\b(?:biaya|spp|dpp|potongan|beasiswa|gelombang)\b/i.test(query)) {
        score *= 0.25;
      }
    }

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
      if (/chatbot\s*-\s*double\s*degree/i.test(f) && /\b(?:double|dual|degree|help|dnui)\b/i.test(query)) {
        score *= 3.0;
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

    // Negative invariant: student exchange, thesis, or enrolled calendar should not dominate general domestic PMB inquiries
    const isPmbInquiry = retrievalPlan.domain === 'PMB' ||
      retrievalPlan.intent === 'GENERAL_PMB_INQUIRY' ||
      retrievalPlan.intent === 'ADMISSION_PROCEDURE' ||
      retrievalPlan.intent === 'ADMISSION_REQUIREMENTS' ||
      retrievalPlan.intent === 'ADMISSION_SCHEDULE' ||
      (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.some(a => ['procedure', 'admission_overview', 'admission_pathways', 'requirements'].includes(a)));

    if (isPmbInquiry) {
      const isStudentExchangeChunk = /student\s+exchange/i.test(f) || /\b(?:student\s+exchange|gccp|global\s+cross\s+cultural)\b/i.test(rawText);
      const isExchangeQuery = /\b(?:student\s+exchange|pertukaran\s+mahasiswa|exchange|gccp|summer\s+program)\b/i.test(query);
      if (isStudentExchangeChunk && !isExchangeQuery) {
        score *= 0.1;
      }

      const isThesisOrYudisiumChunk = /(?:pedoman\s+ta|yudisium|wisuda)/i.test(f) || /\b(?:tugas\s+akhir|skripsi|yudisium|wisuda|ujian\s+proposal)\b/i.test(rawText);
      const isThesisOrGradQuery = /\b(?:tugas\s+akhir|skripsi|pedoman\s+ta|yudisium|wisuda)\b/i.test(query);
      if (isThesisOrYudisiumChunk && !isThesisOrGradQuery) {
        score *= 0.1;
      }

      const isEnrolledAcademicCalendar = (/kalender\s+akademik/i.test(f) && !/kalender\s+pendaftaran/i.test(f)) || /\b(?:pendaftaran\s+remedial|remedial\s+smt|minggu\s+tenang|krs\s+online)\b/i.test(rawText);
      if (isEnrolledAcademicCalendar) {
        score *= 0.1;
      }

      const isS2Target = retrievalPlan.academicLevel === 'S2' || /\b(?:s2|magister|pascasarjana)\b/i.test(query);
      if (!isS2Target && (/pascasarjana/i.test(f) || /pascasarjana\b/i.test(rawText))) {
        score *= 0.2;
      }

      const isPmbProcedureOrOverviewQuery = (
        retrievalPlan.intent === 'ADMISSION_PROCEDURE' ||
        retrievalPlan.intent === 'GENERAL_PMB_INQUIRY' ||
        retrievalPlan.intent === 'PROGRAM_PROCEDURE' ||
        (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.some(a => ['procedure', 'admission_overview', 'requirements'].includes(a)))
      );
      if (isPmbProcedureOrOverviewQuery) {
        if (/\b(?:informasi\s+penerimaan\s+mahasiswa\s+baru|penerimaan\s+mahasiswa\s+baru\s+\(pmb\))\b/i.test(rawText)) {
          score *= 2.5;
        }
      }
    }

    // UKM Intent-Aware Document Ranking (Stage 3B.1 - ID 330)
    if (isUkmDomain) {
      const isAdministrativeSkDoc = /sk\s+pembina/i.test(f) || /surat\s+keputusan\s+rektor.*pembina/i.test(rawText);
      const isUkmProfileDoc = (/profil.*ukm|profile.*ormawa|profiling\s+ukm|buku\s+ormawa|profile\s+organisasi|profil_ukm|company\s+profile/i.test(f) ||
        /buku\s+ormawa/i.test(f)) && !isAdministrativeSkDoc;

      if (isAdvisorOrLegalityQuery) {
        if (isAdministrativeSkDoc) {
          score *= 3.0;
        } else if (isUkmProfileDoc) {
          score *= 0.5;
        }
      } else if (isUkmProfileOrActivityQuery) {
        if (isUkmProfileDoc) {
          score *= 2.0;
        } else if (isAdministrativeSkDoc) {
          score *= 0.35;
        }
      } else if (isGeneralUkmListQuery) {
        if (isAdministrativeSkDoc) {
          score *= 1.2;
        } else if (isUkmProfileDoc) {
          score *= 1.2;
        }
      }
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

  const isUkmCategoryListQuery = isGeneralUkmListQuery || (!isAdvisorOrLegalityQuery && /\b(?:kategori|bidang\s+(?:seni|olahraga|teknologi|kerohanian)|apa\s+saja\s+ukm|daftar\s+ukm|ormawa\s+apa\s+saja)\b/i.test(query));

  let bm25Sorted = [];
  const syllabusCountPerProgram = new Map();
  const ukmDocCountMap = new Map();

  for (const item of rawBm25Sorted) {
    const doc = corpus[item.index];
    const isSyllabus = /^curr-/i.test(doc.id);
    if (isOverviewQuery && isSyllabus) {
      const progKey = doc.program || (doc.id.match(/^curr-([a-z0-9]+)/i) || [])[1] || 'curr';
      const c = syllabusCountPerProgram.get(progKey) || 0;
      if (c >= 3) continue;
      syllabusCountPerProgram.set(progKey, c + 1);
    }
    if (isUkmCategoryListQuery) {
      const src = (doc.sourceFile || doc.filename || doc.source || '').toLowerCase();
      const isSpecificProfile = /profil.*ukm|profile.*ormawa|profiling\s+ukm|buku\s+ormawa/i.test(src) && !/sk\s+pembina/i.test(src);
      if (isSpecificProfile) {
        const c = ukmDocCountMap.get(src) || 0;
        if (c >= 1) continue; // Cap to 1 chunk per individual UKM profile so candidate pool is diverse
        ukmDocCountMap.set(src, c + 1);
      }
      if (/sk\s+pembina/i.test(src)) {
        const c = ukmDocCountMap.get('sk_pembina') || 0;
        if (c >= 2) continue; // Cap to 2 chunks for SK Pembina during category list queries
        ukmDocCountMap.set('sk_pembina', c + 1);
      }
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
      const baseProg = sectionProg.replace(/^(S1|D3|S2)\s+/i, '').trim();
      const hasProg = rawText.toLowerCase().includes(sectionProg.toLowerCase()) ||
        (baseProg.length >= 3 && rawText.toLowerCase().includes(baseProg.toLowerCase()));
      if (!hasProg) {
        enrichedText = `[Program: ${sectionProg}] ${rawText}`;
      }
    } else if (ctx && ctx.entities && ctx.entities.length > 0) {
      const hasAnyEnt = ctx.entities.some(e => rawText.toLowerCase().includes(e.toLowerCase()));
      if (!hasAnyEnt && (ctx.category === 'BIAYA' || /rincian biaya/i.test(sourceFile))) {
        enrichedText = `[Program: ${ctx.entities.join(', ')}] ${rawText}`;
      }
    }

    if (/rincian\s+biaya/i.test(sourceFile) || (ctx && ctx.category === 'BIAYA')) {
      if (/^\s*\(dpp\)\s*:/i.test(rawText)) {
        enrichedText = 'Beasiswa untuk Dana Pendidikan Pokok ' + enrichedText;
      }
      if (/beasiswa\s+untuk\s+dana\s+pendidikan\s+pokok|\(dpp\)\s*:|potongan\s+biaya/i.test(rawText)) {
        if (item.index + 1 < corpus.length && (corpus[item.index + 1].sourceFile || corpus[item.index + 1].filename) === sourceFile) {
          enrichedText += '\n' + (corpus[item.index + 1].chunk || corpus[item.index + 1].text || '');
        }
        if (item.index + 2 < corpus.length && (corpus[item.index + 2].sourceFile || corpus[item.index + 2].filename) === sourceFile) {
          enrichedText += '\n' + (corpus[item.index + 2].chunk || corpus[item.index + 2].text || '');
        }
      } else if (/^\s*(?:rp\.?\s*\d|gelombang\s+khusus)/i.test(rawText) && item.index > 0 && (corpus[item.index - 1].sourceFile || corpus[item.index - 1].filename) === sourceFile) {
        enrichedText = (corpus[item.index - 1].chunk || corpus[item.index - 1].text || '') + '\n' + enrichedText;
      }
    }

    // Stitch sliding-window split chunks in ISIAN WEBSITE (1).pdf so S2 4th pillar ("Enterprise System")
    // and S1 Sistem Komputer ("Lulusan prodi ini dipersiapkan...") are never cut mid-sentence
    if (/isian\s+website/i.test(sourceFile)) {
      if (/empat\s+pilar\s+riset\s+utama/i.test(rawText) && item.index + 1 < corpus.length) {
        const nextTxt = corpus[item.index + 1].chunk || corpus[item.index + 1].text || '';
        if (/system\s+enterprise\s+mutakhir/i.test(nextTxt) && !/system\s+enterprise\s+mutakhir/i.test(enrichedText)) {
          enrichedText = enrichedText.replace(/,\s*Sys\s*$/i, ', System Enterprise Mutakhir.');
        }
      }
      if (/di\s+industri\s+berbasis\s*$/i.test(rawText) && item.index + 1 < corpus.length) {
        const nextTxt = corpus[item.index + 1].chunk || corpus[item.index + 1].text || '';
        if (/^teknologi\s*:/i.test(nextTxt.trim())) {
          enrichedText = enrichedText + ' ' + nextTxt;
        }
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

    const academicLevel = doc.academicLevel || metadata.academicLevel ||
      ((sectionProg && sectionProg.match(/^(S1|S2|D3|D4)\b/i))
        ? sectionProg.match(/^(S1|S2|D3|D4)\b/i)[0]
        : ((contextEntities && contextEntities.length === 1 && contextEntities[0].match(/^(S1|S2|D3|D4)\b/i))
          ? contextEntities[0].match(/^(S1|S2|D3|D4)\b/i)[0]
          : (doc.program ? (doc.program.match(/^(S1|S2|D3|D4)\b/i) || [])[0] : null)));

    const academicLevels = doc.academicLevels || metadata.academicLevels || (academicLevel ? [academicLevel] : []);

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
      scope: doc.scope || metadata.scope || null,
      supportedPrograms: doc.supportedPrograms || metadata.supportedPrograms || [],
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
          const baseProg = sectionProg.replace(/^(S1|D3|S2)\s+/i, '').trim();
          const hasProg = rawText.toLowerCase().includes(sectionProg.toLowerCase()) ||
            (baseProg.length >= 3 && rawText.toLowerCase().includes(baseProg.toLowerCase()));
          if (!hasProg) {
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
        const academicLevel = doc.academicLevel || metadata.academicLevel ||
          ((contextEntities && contextEntities.length > 0 && contextEntities[0].match(/^(S1|S2|D3|D4)\b/i))
            ? contextEntities[0].match(/^(S1|S2|D3|D4)\b/i)[0]
            : (doc.program ? (doc.program.match(/^(S1|S2|D3|D4)\b/i) || [])[0] : null));
        const academicLevels = doc.academicLevels || metadata.academicLevels || (academicLevel ? [academicLevel] : []);
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
          scope: doc.scope || metadata.scope || null,
          supportedPrograms: doc.supportedPrograms || metadata.supportedPrograms || [],
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
          const baseProg = sectionProg.replace(/^(S1|D3|S2)\s+/i, '').trim();
          const hasProg = rawText.toLowerCase().includes(sectionProg.toLowerCase()) ||
            (baseProg.length >= 3 && rawText.toLowerCase().includes(baseProg.toLowerCase()));
          if (!hasProg) {
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
        const academicLevel = doc.academicLevel || metadata.academicLevel ||
          ((contextEntities && contextEntities.length > 0 && contextEntities[0].match(/^(S1|S2|D3|D4)\b/i))
            ? contextEntities[0].match(/^(S1|S2|D3|D4)\b/i)[0]
            : (doc.program ? (doc.program.match(/^(S1|S2|D3|D4)\b/i) || [])[0] : null));
        const academicLevels = doc.academicLevels || metadata.academicLevels || (academicLevel ? [academicLevel] : []);
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
          source_file: sourceFile,
          sourceDocument: sourceFile,
          program: doc.program || metadata.program || null,
          canonicalEntity: doc.canonicalEntity || metadata.canonicalEntity || null,
          scope: doc.scope || metadata.scope || null,
          supportedPrograms: doc.supportedPrograms || metadata.supportedPrograms || [],
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
