'use strict';

/**
 * src/core/unifiedSemanticEngine.js
 *
 * Tiko V2 Semantic-First Understanding & Evidence-Grounded Engine.
 *
 * Order of Execution:
 * WhatsApp Inbound → AI Semantic Understanding (Call 1)
 *   → Fast Path (pure social greeting only) OR
 *   → Semantic-Guided Retrieval (using normalizedSearchQueries + entities)
 *   → Aspect Coverage & Fail-Closed Evidence Arbitration
 *   → AI Grounded Synthesis (Call 2)
 *   → Server-Side Grounding Verification (Quotes & Official Registries)
 *   → WhatsApp Outbound.
 *
 * Invariants:
 * 1. MAX 2 MODEL CALLS: Normal information turn uses exactly 2 calls (Call 1: Semantic, Call 2: Synthesis).
 *    Pure social greetings use exactly 1 call. No turn ever exceeds 2 calls.
 * 2. SEMANTIC-FIRST RETRIEVAL: AI semantic output (normalizedSearchQueries, entities, aspects) directs the retrieval.
 *    rawQuery is retained as anchor support, not the sole retrieval driver.
 * 3. ZERO UNCHECKED CLAIMS: Every factual claim requires a valid chunk ID with verbatim evidenceQuote or official registry.
 * 4. FAIL-CLOSED DOCUMENT ACCESS: Authority tier alone does not grant public access. Unclassified sources without
 *    provable public provenance remain quarantined.
 * 5. PERSISTENT ATOMIC BUDGET: Budget reserved before EVERY model call (Call 1 and Call 2). Fails closed without DB.
 */

const path = require('path');
const { getSession, updateSession } = require('./conversationState');
const { INSTITUTIONAL_ACADEMIC_CATALOG } = require('./academicCatalog');
const { calculateFeeForEntity } = require('./feeCalculationEngine');
const { verifyFinalAnswer } = require('./finalAnswerVerifier');
const { retrieveCandidates } = require('./retrievalService');
const { globalBudgetLedger, calculateModelCostUSD, RESERVATION_TOKEN_CEILINGS } = require('./budgetLedger');
const outboundDispatcher = require('./outboundDispatcher');
const { sanitizeOpenAiChatPayload } = require('../utils/openAiPayloadHelper');
const logger = require('../logger');

/**
 * Conservative heuristic estimation of token count for chat messages.
 * Note: This is an estimation (not an exact BPE tokenizer) to ensure prompt size
 * does not exceed the reservation ceiling. For Indonesian/multilingual text,
 * density is ~2.5 chars/token. We apply 2.5 chars/token plus framing overhead.
 */
function estimatePromptTokens(messages = []) {
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += (msg.role || '').length + (msg.content || '').length;
  }
  return Math.ceil(totalChars / 2.5) + (messages.length * 4);
}

/**
 * Schema 1: AI Semantic Understanding (Call 1)
 */
const TIKO_SEMANTIC_UNDERSTANDING_SCHEMA = Object.freeze({
  name: 'tiko_semantic_understanding',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      speechAct: {
        type: 'string',
        enum: ['INQUIRE_FACT', 'EXPLAIN_PROCEDURE', 'COMPARE', 'CLARIFICATION_ANSWER', 'GENERAL_GREETING', 'OUT_OF_SCOPE']
      },
      isPureSocialGreeting: {
        type: 'boolean',
        description: 'True HANYA JIKA pesan murni sapaan sosial/terima kasih tanpa menanyakan informasi kampus apa pun.'
      },
      entities: {
        type: 'array',
        description: 'Maksimal 3 entitas kampus, prodi, UKM, atau topik utama yang paling relevan. Jangan melebihi 3.',
        items: {
          type: 'object',
          properties: {
            raw: { type: 'string' },
            canonicalId: { type: 'string' },
            category: {
              type: 'string',
              enum: ['academic_program', 'facility', 'organization', 'scholarship', 'institution', 'general_topic', 'other']
            },
            confidence: { type: 'number' },
            isUnmapped: { type: 'boolean' }
          },
          required: ['raw', 'canonicalId', 'category', 'confidence', 'isUnmapped'],
          additionalProperties: false
        }
      },
      requestedAspects: {
        type: 'array',
        description: 'Maksimal 4 aspek informasi relevan yang ditanyakan pengguna. Jangan melebihi 4 aspek.',
        items: {
          type: 'object',
          properties: {
            aspect: {
              type: 'string',
              enum: [
                'tuition_fee',
                'curriculum',
                'degree_award',
                'career_prospects',
                'accreditation',
                'admission_flow',
                'study_duration',
                'facility_detail',
                'international_program',
                'general_policy',
                'extracurricular_profile',
                'other_aspect'
              ]
            },
            customAspectDescription: {
              type: 'string',
              description: 'Deskripsi singkat aspek (maksimal 5-8 kata, tanpa penjelasan berulang).'
            },
            targetEntityCanonicalId: { type: 'string' }
          },
          required: ['aspect', 'customAspectDescription', 'targetEntityCanonicalId'],
          additionalProperties: false
        }
      },
      normalizedSearchQueries: {
        type: 'array',
        description: 'Maksimal 3 query pencarian terarah dan ringkas dalam bahasa Indonesia baku untuk korpus resmi kampus.',
        items: { type: 'string' }
      },
      requiresClarification: { type: 'boolean' },
      clarificationReason: {
        type: 'string',
        description: 'Alasan singkat jika butuh klarifikasi (kosongkan "" jika tidak butuh klarifikasi).'
      }
    },
    required: [
      'speechAct',
      'isPureSocialGreeting',
      'entities',
      'requestedAspects',
      'normalizedSearchQueries',
      'requiresClarification',
      'clarificationReason'
    ],
    additionalProperties: false
  }
});

/**
 * Schema 2: AI Grounded Synthesis (Call 2)
 */
const TIKO_GROUNDED_SYNTHESIS_SCHEMA = Object.freeze({
  name: 'tiko_grounded_synthesis',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      evidenceArbitration: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['FULLY_SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED_IN_CORPUS', 'CONFLICTING_EVIDENCE']
          },
          usedChunkIds: {
            type: 'array',
            items: { type: 'string' }
          },
          unsupportedAspects: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['status', 'usedChunkIds', 'unsupportedAspects'],
        additionalProperties: false
      },
      factualClaims: {
        type: 'array',
        description: 'Daftar klaim faktual eksplisit dalam jawaban beserta ID chunk pendukung dan kutipan persisnya.',
        items: {
          type: 'object',
          properties: {
            claimText: { type: 'string', description: 'Pernyataan faktual yang dikemukakan.' },
            targetEntityId: { type: 'string', description: 'Canonical ID entitas terkait.' },
            supportedByChunkId: { type: 'string', description: 'ID chunk atau registry resmi (REGISTRY_ACADEMIC_CATALOG / REGISTRY_FEE_SK629).' },
            evidenceQuote: {
              type: 'string',
              description: 'Kutipan teks persis dari chunk pendukung atau rujukan resmi yang membuktikan klaim ini.'
            }
          },
          required: ['claimText', 'targetEntityId', 'supportedByChunkId', 'evidenceQuote'],
          additionalProperties: false
        }
      },
      uncoveredAspects: {
        type: 'array',
        description: 'Aspek yang ditanyakan tetapi tidak terjawab oleh bukti.',
        items: {
          type: 'object',
          properties: {
            aspect: { type: 'string' },
            targetEntityCanonicalId: { type: 'string' },
            limitationExplanation: { type: 'string' }
          },
          required: ['aspect', 'targetEntityCanonicalId', 'limitationExplanation'],
          additionalProperties: false
        }
      },
      naturalAnswer: {
        type: 'string',
        description: 'Pesan balasan WhatsApp lengkap dalam bahasa Indonesia yang ramah, sopan, dan langsung ke inti.'
      }
    },
    required: ['evidenceArbitration', 'factualClaims', 'uncoveredAspects', 'naturalAnswer'],
    additionalProperties: false
  }
});

// Verified Provable Institutional Public Canonical Documents in Local Corpus
// NOTE: Strictly enumerated from authentic documents in the local corpus.
// Broad regexes or unverified file names are strictly prohibited.
const PROVABLE_PUBLIC_CANONICAL_FILES = Object.freeze(new Set([
  // 1. Fee Schedules & Decrees
  'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
  'rincian Biaya D3 Tahun Ajaran 2026-2027.pdf',
  'rincian Biaya DNUI Tahun Ajaran 2026-2027.pdf',
  'rincian Biaya HELP Tahun Ajaran 2026-2027.pdf',
  'rincian Biaya SK Tahun Ajaran 2026-2027.pdf',
  'rincian Biaya UTB Tahun Ajaran 2026-2027.pdf',
  'CamScanner 12-02-2026 14.39 (1).pdf',

  // 2. Official Academic Catalog, Calendar & Guidelines
  'Kalender Akademik Ganjil, Genap dan Antara TA 2025-2026 (1).pdf',
  'media-Kalender-Akademik-2025_versi30-01-2025-scaled.jpg',
  'Pedoman TA S1 2019 Revisi 1.pdf',
  'fasilitas-stikom.pdf',
  'Informasi Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII (Semester Ganjil 2026-2027) (1).pdf',
  'Kalender Pendaftaran.xlsx',

  // 3. Program Profiles & International Student FAQs
  'Penjelasan Prodi dan Karier Masa Depan (1).xlsx',
  'FAQ PENGURUSAN MAHASISWA ASING.docx',
  'FAQ PENGURUSAN MAHASISWA ASING (1).docx',
  'FAQ PENGURUSAN MAHASISWA ASING (2).docx',
  'Apa itu Student Exchange di ITB STIKOM Bali.docx',
  'CHATBOT - Double Degree.docx',

  // 4. Exact Accreditation Certificates
  'SERTIFIKAT AKREDITASI - SISTEM INFORMASI (14 DES 2023 - 14 DES 2028) LAM INFOKOM.pdf',
  'SERTIFIKAT AKREDITASI BD (05 OKT 2022 - 05 OKT 2027).pdf',
  'SERTIFIKAT AKREDITASI MI (17 NOV 2021 - 17 NOV 2026).pdf',
  'SERTIFIKAT AKREDITASI SISTEM KOMPUTER (09 APRIL 2025 - 09 APRIL 2030).pdf',
  'SERTIFIKAT AKREDITASI TI (06 SEPT 2022 - 06 SEPT 2027).pdf',

  // 5. Rector Decree on Ormawa Advisors & Authentic Student Organization Profiles
  'SK PEMBINA ORMAWA 2026.pdf',
  'Profil UKM DOS.docx',
  'Pofile UKM Basket ITB Stikom Bali.docx',
  'Profil UKM KSL.docx',
  'Profil UKM MM.docx',
  'Profil_UKM_GHoST_ITB_STIKOM_Bali.docx',
  'Profile UKM JCOS.docx',
  'PROFIL SINGKAT UKM FUTSAL.docx',
  'PROFIL SINGKAT UKM MCOS.docx',
  'PROFIL SINGKAT UKM U2M.docx',
  'PROFIL_SINGKAT UKM MAPALA.docx',
  'Company profile UKM Tabuh.pdf',
  'PROFILING UKM TABUH BRAMARA GITA.pdf',
  'Program Kegiatan Organisasi UKM RADE.docx',
  'PROFILE ORGANISASI UKM BOS.docx',
  'PROFILE (1) TEATER BINER.docx',
  'PROFILE ATHENA ESPORT.docx',
  'Profile Singkat KSR.docx',
  'profile ukm KMHD.jpg',
  'PROFILE SINGKAT UNIT KEGIATAN MAHASISWA HIMATOGRAPHY.docx',
  'PROFILE ORMAWA TARI (PRAGINA).docx',
  'Profile Ormawa VOS.docx',
  'BUKU ORMAWA HIMAPRODI TI.docx',
  'PROFILE HIMA SI.docx',
  'PROFILE HIMA SK.docx',
  'Profile HIMA BD.docx',
  'PROFILE ORGANISASI HIMPUNAN MAHASISWA JIMBARAN.docx',
  'PROFILE ORGANISASI PASKAMRAS.pdf',
  'Profil_BEM_ITB_STIKOM_Bali.docx',
  'Profile_Organisasi PROGRESS.docx',

  // 6. Outreach & Business Incubation Public Guidance
  'QNA Bot - Hi-Think.docx',
  'Narasi QNA Bot - Hi-Think.docx',
  'INBIS PROFILE 2026.pdf',
  'Profil INBIS Bali - 2026.docx',
  'PROFIL LAYANAN INDUSTRI.docx',
  'STIKOM Bali GoseToSchool 2025.docx',
  'ok-Company-Profile-CDC (1).pdf'
]));

const PROVABLE_PUBLIC_CANONICAL_FILES_LOWER = Object.freeze(
  new Set([...PROVABLE_PUBLIC_CANONICAL_FILES].map(f => f.toLowerCase()))
);

// Virtual & Registry Sources with provable institutional provenance
const PROVABLE_PUBLIC_CANONICAL_SOURCES = Object.freeze([
  /^(?:CATALOG_OFFICIAL_REGISTRY|INSTITUTIONAL_ACADEMIC_CATALOG)$/i,
  /^docs\/retrieval\/knowledge_domains\/(?:program_studi_|tuition_fee|scholarship|double_degree|international_program|exchange_program)/i
]);

function isVerifiedPublicCanonicalSource(sourceStr) {
  if (!sourceStr || typeof sourceStr !== 'string') return false;
  const trimmed = sourceStr.trim();
  if (PROVABLE_PUBLIC_CANONICAL_SOURCES.some(p => p.test(trimmed))) {
    return true;
  }
  const base = path.basename(trimmed).toLowerCase();
  return PROVABLE_PUBLIC_CANONICAL_FILES_LOWER.has(base);
}

// Explicit exclusion / quarantine patterns
const EXPLICIT_INTERNAL_PATTERNS = Object.freeze([
  /gaji/i,
  /slip/i,
  /internal/i,
  /rahasia/i,
  /confidential/i,
  /restricted/i,
  /private/i,
  /notulen[-_ ]rapat[-_ ]tertutup/i,
  /keuangan[-_ ]internal/i,
  /draft/i,
  /form[-_ ]iku[-_ ]pts/i,
  /analisis[-_ ]jabatan/i,
  /whatsapp[-_ ]image/i,
  /ssk[-_ ]\d+/i,
  /isian[-_ ]website/i
]);

function toBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

/**
 * Enforces Fail-Closed Document Access Control.
 * Disconnects authority tier from public access: high authority tier alone
 * does NOT grant public access without provable public provenance.
 */
function filterAllowedEvidence(candidateChunks = []) {
  if (!Array.isArray(candidateChunks)) return [];

  return candidateChunks.filter(chunk => {
    if (!chunk || typeof chunk !== 'object') return false;

    const chunkText = String(chunk.text || chunk.chunk || '').trim();
    if (chunkText.length === 0) return false;

    // 1. Explicit Exclusions: Internal or Draft Flags (takes absolute precedence over allowlist)
    if (toBooleanFlag(chunk.is_internal) || toBooleanFlag(chunk.isInternal) || toBooleanFlag(chunk.metadata?.is_internal) || toBooleanFlag(chunk.metadata?.isInternal)) {
      return false;
    }
    if (toBooleanFlag(chunk.is_draft) || toBooleanFlag(chunk.isDraft) || toBooleanFlag(chunk.metadata?.is_draft) || toBooleanFlag(chunk.metadata?.isDraft)) {
      return false;
    }

    // 2. Governance Status Exclusions: Expired, Superseded, Draft, Rejected, Archived
    const status = String(
      chunk.status ||
      chunk.governanceStatus ||
      chunk.governance_status ||
      chunk.metadata?.status ||
      chunk.metadata?.governanceStatus ||
      chunk.metadata?.governance_status ||
      ''
    ).trim().toUpperCase();

    if (
      status === 'EXPIRED' ||
      status === 'SUPERSEDED' ||
      status === 'DRAFT' ||
      status === 'REJECTED' ||
      status === 'ARCHIVED' ||
      status.includes('EXPIRED') ||
      status.includes('SUPERSEDED')
    ) {
      return false;
    }

    // 3. Temporal Validity Window Check
    const validUntil = chunk.validUntil || chunk.validTo || chunk.valid_until || chunk.valid_to || chunk.metadata?.validUntil || chunk.metadata?.validTo || chunk.metadata?.valid_until || chunk.metadata?.valid_to;
    if (validUntil) {
      const expiry = new Date(validUntil);
      if (!isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) {
        return false;
      }
    }
    const validFrom = chunk.validFrom || chunk.valid_from || chunk.metadata?.validFrom || chunk.metadata?.valid_from;
    if (validFrom) {
      const start = new Date(validFrom);
      if (!isNaN(start.getTime()) && start.getTime() > Date.now()) {
        return false;
      }
    }

    // 4. Access Classification Check: Internal / Restricted / Confidential NEVER allowed regardless of filename
    const rawAccess = String(
      chunk.access_classification ||
      chunk.accessClassification ||
      chunk.access_status ||
      chunk.accessStatus ||
      chunk.metadata?.access_classification ||
      chunk.metadata?.accessClassification ||
      chunk.metadata?.access_status ||
      chunk.metadata?.accessStatus ||
      ''
    ).trim().toUpperCase();

    if (
      rawAccess.includes('INTERNAL') ||
      rawAccess.includes('RESTRICTED') ||
      rawAccess.includes('CONFIDENTIAL') ||
      rawAccess.includes('PRIVATE') ||
      rawAccess.includes('SECRET')
    ) {
      return false;
    }

    // 5. Explicit Internal Content / Source Keyword Check (Quarantine)
    const sourceStr = String(chunk.sourceFile || chunk.filename || chunk.source || chunk.metadata?.source || '').trim();
    if (EXPLICIT_INTERNAL_PATTERNS.some(p => p.test(sourceStr) || p.test(chunkText))) {
      return false;
    }

    // 6. Provenance Verification: Must be a verified public canonical document or official registry
    const isExplicitlyPublic = rawAccess === 'PUBLIC_OFFICIAL' || rawAccess === 'PUBLIC';
    const isProvablePublicSource = isVerifiedPublicCanonicalSource(sourceStr);
    const isActiveStatus = status === 'ACTIVE' || status === '';

    // If explicitly marked public (and passed exclusion steps 1-5 above)
    if (isExplicitlyPublic && isActiveStatus) {
      if (!sourceStr || isProvablePublicSource) {
        return true;
      }
    }

    // Unclassified / Unknown: MUST be a verified public canonical source and active status
    if (isProvablePublicSource && isActiveStatus) {
      return true;
    }

    // Fail-Closed: unclassified or unproven documents remain quarantined
    return false;
  });
}

/**
 * Checks whether the Unified AI Semantic Pipeline is enabled.
 */
function isUnifiedSemanticPipelineEnabled() {
  return String(process.env.FEATURE_UNIFIED_AI_SEMANTIC || '').trim().toLowerCase() === 'true';
}

/**
 * System prompt for Call 1: Semantic Understanding.
 */
function buildSemanticUnderstandingSystemPrompt() {
  return `You are Tiko's Semantic Understanding Engine for ITB STIKOM Bali.
Extract intent, entities, requested aspects, and normalized search queries.

CORE RULES:
1. INSTITUTIONAL SCOPE: Covers all ITB STIKOM Bali topics: tuition fees (biaya kuliah/semester/cicilan), PMB (syarat/jalur), prodi/kurikulum, gelar, Double Degree (DNUI/HELP), exchange, beasiswa, UKM/ormawa, fasilitas.
2. OUT_OF_SCOPE: ONLY for non-campus requests (resep, politik, dsb). NEVER for campus topics absent from registry.
3. UNMAPPED ENTITIES: For campus inquiries not in registry (Double Degree, UKM, informal names), set isUnmapped: true, confidence: 0.8+, pick category, generate normalizedSearchQueries.
4. SLANG & TYPOS: Interpret slang (ongkos, duit, brapa, smt, prodi) and abbreviations into formal search queries.
5. SOCIAL GREETING: Set isPureSocialGreeting: true ONLY if strictly social with NO campus inquiry.
6. STRICT OUTPUT LIMITS (DO NOT EXCEED):
   - entities: Maximum 3 primary entities (prodi/UKM/topik).
   - requestedAspects: Maximum 4 relevant aspects asked.
   - normalizedSearchQueries: Maximum 3 concise search queries (2-4 keywords each).
   - customAspectDescription: Very brief description (max 5-8 words). No repeated explanations.
   - clarificationReason: Empty string "" unless requiresClarification is true.
7. Format strictly according to json_schema. All required fields must be present and valid.`;
}

function formatTurnSnippet(t) {
  const u = t.query || (t.role === 'user' ? t.content : '') || t.user || '';
  const a = t.answer || (t.role === 'assistant' ? t.content : '') || t.assistant || '';
  return `- User: "${u}"\n  Tiko: "${a}"`;
}

/**
 * User prompt for Call 1: Semantic Understanding.
 */
function buildSemanticUnderstandingUserPrompt(rawQuery, contextTurns = []) {
  const contextSnippet = contextTurns.length > 0
    ? `PREVIOUS TURNS:\n` + contextTurns.map(formatTurnSnippet).join('\n')
    : `PREVIOUS TURNS: None`;

  const catalogSummary = INSTITUTIONAL_ACADEMIC_CATALOG.map(p =>
    `- ${p.id}: ${p.canonical} (${p.degreeTitle})`
  ).join('\n');

  return `${contextSnippet}

CURRENT USER QUERY: "${rawQuery}"

PROGRAM REGISTRY:
${catalogSummary}

Extract up to 3 entities (isUnmapped: true if not in registry), up to 4 aspects (customAspectDescription max 5-8 words), and up to 3 concise search queries.`;
}

/**
 * System prompt for Call 2: Grounded Synthesis.
 */
function buildGroundedSynthesisSystemPrompt() {
  return `You are Tiko, the official friendly AI campus assistant for ITB STIKOM Bali on WhatsApp.
Your role: synthesize natural, helpful WhatsApp answers strictly grounded in official evidence.

CORE INVARIANTS:
1. ONLY make claims backed by the provided [OFFICIAL EVIDENCE] or the official institutional program catalog.
2. For EVERY claim in factualClaims, provide the exact verbatim substring (evidenceQuote) from the supporting chunk.
3. If evidence does not cover an aspect, state it honestly in uncoveredAspects; do NOT speculate or invent facts.
4. Keep answers concise, natural, polite, and directly address the user's inquiry.
5. Format output strictly according to the json_schema.`;
}

/**
 * User prompt for Call 2: Grounded Synthesis.
 */
function buildGroundedSynthesisUserPrompt(rawQuery, understanding, contextTurns = [], allowedEvidence = []) {
  const contextSnippet = contextTurns.length > 0
    ? `PREVIOUS TURNS:\n` + contextTurns.map(formatTurnSnippet).join('\n')
    : `PREVIOUS TURNS: None`;

  const evidenceSnippet = allowedEvidence.length > 0
    ? `OFFICIAL EVIDENCE CHUNKS:\n` + allowedEvidence.map((c, i) => {
        const id = c.id || c.source_record_id || `CHUNK_${i + 1}`;
        const title = c.title || c.sourceFile || c.source || 'Panduan Kampus';
        const txt = (c.text || c.chunk || '').trim().replace(/\s+/g, ' ');
        return `[Chunk ${i + 1}] ID: ${id} | Title: ${title}\nContent: ${txt}`;
      }).join('\n\n')
    : `OFFICIAL EVIDENCE CHUNKS: None found in initial search.`;

  const catalogSummary = INSTITUTIONAL_ACADEMIC_CATALOG.map(p =>
    `- ${p.canonical} (ID: ${p.id}, Degree: ${p.degreeTitle}, Normal Study: ${p.semesters} Semesters / ${p.sks} SKS)`
  ).join('\n');

  return `${contextSnippet}

CURRENT USER QUERY: "${rawQuery}"

UNDERSTANDING:
Speech Act: ${understanding.speechAct}
Entities: ${JSON.stringify(understanding.entities)}
Requested Aspects: ${JSON.stringify(understanding.requestedAspects)}

INSTITUTIONAL PROGRAM REGISTRY:
${catalogSummary}

${evidenceSnippet}

Synthesize the final WhatsApp answer, attributing all claims to chunk IDs and verbatim quotes.`;
}

/**
 * Normalizes text for robust lexical quote substring matching.
 */
function normalizeForQuoteCheck(str = '') {
  return String(str)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detects targeted directional and semantic contradictions between claim and supporting quote.
 * Returns null if no contradiction detected, or a string describing the contradiction reason.
 */
function detectClaimQuoteContradiction(claimText = '', evidenceQuote = '') {
  const normClaim = normalizeForQuoteCheck(claimText);
  const normQuote = normalizeForQuoteCheck(evidenceQuote);

  // 1. Polarity / Prohibition vs Mandate / Permission Contradiction
  const PROHIBITION_PATTERNS = [
    /\bdilarang\b/i,
    /\btidak\s+(?:boleh|diperkenankan|diizinkan|dapat|bisa)\b/i,
    /\bbukan\b/i,
    /\bjangan\b/i
  ];

  const MANDATE_OR_PERMISSION_PATTERNS = [
    /\bwajib\b/i,
    /\bharus\b/i,
    /\bboleh\b/i,
    /\bdiperkenankan\b/i,
    /\bdiwajibkan\b/i,
    /\bdiharuskan\b/i,
    /\bbebas\b/i,
    /\bgratis\b/i
  ];

  const quoteHasProhibition = PROHIBITION_PATTERNS.some(p => p.test(normQuote));
  const claimHasMandateOrPermit = MANDATE_OR_PERMISSION_PATTERNS.some(p => p.test(normClaim));
  const claimHasProhibition = PROHIBITION_PATTERNS.some(p => p.test(normClaim));

  if (quoteHasProhibition && claimHasMandateOrPermit && !claimHasProhibition) {
    return 'POLARITY_CONTRADICTION_PROHIBITION_VIOLATED';
  }

  const quoteHasMandate = /\b(?:wajib|harus|diwajibkan|diharuskan)\b/i.test(normQuote);
  if (quoteHasMandate && claimHasProhibition) {
    return 'POLARITY_CONTRADICTION_MANDATE_INVERTED';
  }

  // 2. Quantifier Contradiction (Semua vs Sebagian / Khusus)
  const quoteIsRestricted = /\b(?:hanya|khusus|sebagian|terbatas|tidak\s+semua)\b/i.test(normQuote);
  const claimIsUniversal = /\b(?:semua|seluruh|100%|tanpa\s+terkecuali|setiap)\b/i.test(normClaim);
  if (quoteIsRestricted && claimIsUniversal) {
    return 'QUANTIFIER_CONTRADICTION_UNIVERSAL_OVERCLAIM';
  }

  // 3. Temporal / Year Contradiction (e.g. 2024 vs 2026)
  const extractYears = (str) => {
    const matches = String(str).match(/\b(20[1-3][0-9])\b/g) || [];
    return Array.from(new Set(matches));
  };

  const quoteYears = extractYears(evidenceQuote);
  const claimYears = extractYears(claimText);

  if (claimYears.length > 0 && quoteYears.length > 0) {
    const hasOverlap = claimYears.some(cy => quoteYears.includes(cy));
    if (!hasOverlap) {
      return `TEMPORAL_CONTRADICTION_YEAR_MISMATCH_${claimYears.join('_')}_VS_${quoteYears.join('_')}`;
    }
  }

  // 4. Numerical & Currency Nominal Contradiction (excluding already evaluated 4-digit years)
  // Evaluated on raw string so dots/commas in Indonesian currency (e.g. 15.000.000 vs 6.500.000) are not fragmented
  const extractNumbers = (str) => {
    const matches = String(str).match(/\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\b|\b\d+\b/g) || [];
    return matches
      .map(m => m.replace(/[.,]/g, ''))
      .filter(n => n.length > 0 && !/^20[1-3][0-9]$/.test(n));
  };

  const quoteNumbers = extractNumbers(evidenceQuote);
  const claimNumbers = extractNumbers(claimText);

  if (claimNumbers.length > 0 && quoteNumbers.length > 0) {
    for (const cNum of claimNumbers) {
      if (cNum.length >= 3 && !quoteNumbers.includes(cNum)) {
        return `NUMERICAL_CONTRADICTION_UNMATCHED_VALUE_${cNum}`;
      }
    }
  }

  return null;
}

/**
 * Server-Side Grounding & Factuality Validator.
 */
function verifyUnifiedClaimsAndFacts(parsedResponse, allowedEvidence = []) {
  const claims = parsedResponse.factualClaims || [];
  const chunkMap = new Map();
  for (const c of allowedEvidence) {
    if (c.id) chunkMap.set(String(c.id), c);
    if (c.source_record_id) chunkMap.set(String(c.source_record_id), c);
  }

  const validClaims = [];
  const ungroundedClaims = [];

  for (const claim of claims) {
    const chunkId = String(claim.supportedByChunkId || '').trim();
    const quote = String(claim.evidenceQuote || '').trim();

    // Registry: Academic Catalog
    if (chunkId === 'REGISTRY_ACADEMIC_CATALOG' || chunkId === 'CATALOG_OFFICIAL_REGISTRY') {
      const ent = INSTITUTIONAL_ACADEMIC_CATALOG.find(p =>
        p.id === claim.targetEntityId ||
        p.canonical.toLowerCase() === String(claim.targetEntityId || '').toLowerCase() ||
        (claim.evidenceQuote && p.canonical.toLowerCase().includes(claim.evidenceQuote.toLowerCase())) ||
        (claim.evidenceQuote && p.degreeTitle.toLowerCase().includes(claim.evidenceQuote.toLowerCase()))
      );
      if (ent) {
        validClaims.push(claim);
      } else {
        ungroundedClaims.push({ ...claim, reason: 'REGISTRY_ENTITY_NOT_FOUND' });
      }
      continue;
    }

    // Registry: Fee SK629
    if (chunkId === 'REGISTRY_FEE_SK629') {
      validClaims.push(claim);
      continue;
    }

    // Evidence Chunk Check
    const referencedChunk = chunkMap.get(chunkId);
    if (!referencedChunk) {
      ungroundedClaims.push({ ...claim, reason: 'CHUNK_NOT_IN_ALLOWED_EVIDENCE' });
      continue;
    }

    // Evidence Quote Check
    if (quote.length < 5) {
      ungroundedClaims.push({ ...claim, reason: 'EMPTY_OR_TRIVIAL_EVIDENCE_QUOTE' });
      continue;
    }

    const normQuote = normalizeForQuoteCheck(quote);
    const chunkContent = referencedChunk.text || referencedChunk.chunk || '';
    const normChunk = normalizeForQuoteCheck(chunkContent);

    let quoteFound = normChunk.includes(normQuote);
    if (!quoteFound) {
      const quoteWords = normQuote.split(' ').filter(w => w.length > 2);
      if (quoteWords.length >= 4) {
        for (let i = 0; i <= quoteWords.length - 4; i++) {
          const sub = quoteWords.slice(i, i + 4).join(' ');
          if (normChunk.includes(sub)) {
            quoteFound = true;
            break;
          }
        }
      }
    }

    if (!quoteFound) {
      ungroundedClaims.push({ ...claim, reason: 'EVIDENCE_QUOTE_NOT_FOUND_IN_CHUNK' });
      continue;
    }

    // Check targeted contradiction between claim and quote
    const contradiction = detectClaimQuoteContradiction(claim.claimText, quote);
    if (contradiction) {
      ungroundedClaims.push({ ...claim, reason: contradiction });
    } else {
      validClaims.push(claim);
    }
  }

  // Exact degree title verification against academicCatalog
  const answer = parsedResponse.naturalAnswer || '';
  let degreeMismatch = false;
  for (const prog of INSTITUTIONAL_ACADEMIC_CATALOG) {
    const progMentioned = new RegExp(prog.canonical.replace(/\s+/g, '\\s+'), 'i').test(answer);
    if (progMentioned) {
      if (prog.id === 's1_bd' && /\bS\.Kom\b/i.test(answer) && !/\bS\.Bns\b/i.test(answer)) {
        degreeMismatch = true;
      }
      if (prog.id === 's1_si' && /\bS\.Bns\b/i.test(answer)) {
        degreeMismatch = true;
      }
    }
  }

  return {
    isValid: ungroundedClaims.length === 0 && !degreeMismatch,
    validClaims,
    ungroundedClaims,
    degreeMismatch,
    claimsCount: claims.length,
    verificationMethod: 'LEXICAL_QUOTE_AND_REGISTRY_VERIFICATION'
  };
}

/**
 * Determines whether an evidence item has substantive topical relevance to the user's raw query.
 * Used to guard against false rescue of legitimate OUT_OF_SCOPE questions due to low-scoring stopwords.
 */
function isEvidenceRelevantToQuery(evidenceItem, query) {
  if (!evidenceItem || !query) return false;
  const score = evidenceItem.score || (evidenceItem.metadata && evidenceItem.metadata.score) || 0;
  if (score < 10.0) return false;

  const qLower = String(query).toLowerCase();
  const textLower = String(evidenceItem.text || evidenceItem.chunk || '').toLowerCase();
  const sourceLower = String(evidenceItem.sourceFile || evidenceItem.filename || '').toLowerCase();

  const stopwords = new Set([
    'dan', 'yang', 'untuk', 'dari', 'atau', 'pada', 'dengan', 'ada', 'apa', 'ini', 'itu',
    'dong', 'kak', 'mau', 'nanya', 'bisa', 'apakah', 'saya', 'kami', 'jelaskan', 'bagaimana',
    'itb', 'stikom', 'bali', 'kampus', 'institut', 'perguruan', 'tinggi', 'tata', 'cara',
    'prosedur', 'proses', 'info', 'informasi', 'di', 'ke', 'tentang'
  ]);

  const terms = qLower.split(/[\s,?.!]+/).filter(w => w.length >= 2 && !stopwords.has(w));
  if (terms.length === 0) return false;

  let matched = 0;
  for (const t of terms) {
    if (textLower.includes(t) || sourceLower.includes(t)) {
      matched++;
    }
  }

  return (matched >= 2) || (matched >= 1 && score >= 15.0);
}

/**
 * Builds a deterministic safe local fallback response.
 */
function buildSafeLocalFallback(rawQuery, allowedEvidence = [], { contextTurns = [], reason = '', understanding = null } = {}) {
  const isOutOfScope = reason === 'OUT_OF_SCOPE_QUERY' || understanding?.speechAct === 'OUT_OF_SCOPE';
  const fallbackText = isOutOfScope
    ? 'Mohon maaf, Tiko hanya melayani pertanyaan seputar informasi kampus, program studi, biaya kuliah, dan PMB ITB STIKOM Bali. Ada yang bisa Tiko bantu seputar kampus?'
    : 'Halo Kak! Untuk memastikan informasi yang Kakak tanyakan akurat dan resmi, Kakak dapat menghubungi Layanan Informasi PMB ITB STIKOM Bali via WhatsApp di 081529004444 atau mengunjungi portal resmi di https://pmb.stikom-bali.ac.id. Ada hal lain yang bisa Tiko bantu?';
  return {
    understanding: understanding || {
      speechAct: isOutOfScope ? 'OUT_OF_SCOPE' : 'INQUIRE_FACT',
      isPureSocialGreeting: false,
      entities: [],
      requestedAspects: [{ aspect: 'general_policy', customAspectDescription: 'local fallback', targetEntityCanonicalId: 'general' }],
      normalizedSearchQueries: [rawQuery],
      requiresClarification: false,
      clarificationReason: ''
    },
    evidenceArbitration: {
      status: allowedEvidence.length > 0 ? 'PARTIALLY_SUPPORTED' : 'UNSUPPORTED_IN_CORPUS',
      usedChunkIds: allowedEvidence.map(c => c.id || c.source_record_id).slice(0, 2),
      unsupportedAspects: []
    },
    factualClaims: [],
    naturalAnswer: fallbackText,
    finalAnswer: fallbackText,
    isLocalFallback: true,
    fallbackReason: reason,
    telemetry: {
      model: 'safe-local-fallback',
      modelCallCount: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      actualCostUSD: 0,
      estimatedCostUSD: 0,
      reservedCostUSD: 0,
      latencyMs: 0
    }
  };
}

/**
 * Main Turn Processor: Semantic-First Understanding & Grounded Generation.
 *
 * Sequence:
 * WhatsApp Inbound → AI Semantic Understanding (Call 1)
 *   → Pure Social Greeting Fast Path (if applicable)
 *   → Semantic-Guided Retrieval (using normalizedSearchQueries + entities)
 *   → Evidence Arbitration & Access Control
 *   → AI Grounded Synthesis (Call 2)
 *   → Server-Side Grounding Verification
 *   → WhatsApp Outbound.
 */
async function processUnifiedTurn(arg1, arg2, arg3 = {}) {
  let chatId;
  let rawQuery;
  let options;
  if (typeof arg2 === 'string') {
    chatId = arg1;
    rawQuery = arg2;
    options = arg3 || {};
  } else if (Array.isArray(arg2)) {
    rawQuery = typeof arg1 === 'string' ? arg1 : '';
    options = { ...(arg3 || {}), candidateEvidence: arg2 };
    chatId = options.chatId || null;
  } else if (typeof arg1 === 'string' && typeof arg2 === 'object' && !arg3) {
    rawQuery = arg1;
    options = arg2 || {};
    chatId = options.chatId || null;
  } else {
    chatId = arg1;
    rawQuery = typeof arg2 === 'string' ? arg2 : String(arg2 || '');
    options = arg3 || {};
  }

  const {
    aiClient = null,
    model = process.env.OPENAI_MODEL || 'gpt-6-luna',
    executeDispatch = false,
    contextTurns = [],
    candidateEvidence = [],
    budgetLedger = null,
    ...restOptions
  } = options;

  const startTime = Date.now();
  let modelCallCount = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  let effectiveContextTurns = Array.isArray(contextTurns) && contextTurns.length > 0 ? [...contextTurns] : [];
  if (effectiveContextTurns.length === 0 && chatId) {
    try {
      const session = await getSession(chatId);
      if (session?.data?.lastQuery && session?.data?.lastAnswer) {
        effectiveContextTurns = [{
          query: session.data.lastQuery,
          answer: session.data.lastAnswer
        }];
      }
    } catch (_) {}
  }

  const ledger = budgetLedger || globalBudgetLedger;

  // =========================================================================
  // STEP 1: Budget Reservation for Call 1 (AI Semantic Understanding)
  // Dynamic reservation based on model and RESERVATION_TOKEN_CEILINGS.call_1
  // =========================================================================
  const res1 = await ledger.reserveBudget({
    purpose: 'call_1',
    model,
    customRates: restOptions.customRates
  });
  if (!res1.allowed) {
    logger.warn({ reason: res1.reason, spent: res1.spentUSD, model }, '[UnifiedSemanticEngine] Call 1 budget reservation denied');
    const fallback = buildSafeLocalFallback(rawQuery, [], { contextTurns: effectiveContextTurns, reason: res1.reason });
    fallback.budgetExceeded = (res1.reason === 'DAILY_BUDGET_EXCEEDED');
    fallback.unverifiedModel = (res1.reason === 'REJECT_UNVERIFIED_MODEL');
    fallback.latencyMs = Date.now() - startTime;
    return fallback;
  }

  // =========================================================================
  // STEP 2: Call 1 — AI Semantic Understanding
  // =========================================================================
  let understanding = null;
  const call1Ceiling = RESERVATION_TOKEN_CEILINGS.call_1;
  const call1SysPrompt = buildSemanticUnderstandingSystemPrompt();
  let call1UserPrompt = buildSemanticUnderstandingUserPrompt(rawQuery, effectiveContextTurns);
  let call1Messages = [
    { role: 'system', content: call1SysPrompt },
    { role: 'user', content: call1UserPrompt }
  ];

  // Bound Call 1 input prompt size before network request (plafon: 1200 tokens)
  let estCall1Tokens = estimatePromptTokens(call1Messages);
  if (estCall1Tokens > call1Ceiling.maxPromptTokens && effectiveContextTurns.length > 0) {
    const prunedTurns = [...effectiveContextTurns];
    while (prunedTurns.length > 0 && estCall1Tokens > call1Ceiling.maxPromptTokens) {
      prunedTurns.shift(); // Deterministically prune older turns
      call1UserPrompt = buildSemanticUnderstandingUserPrompt(rawQuery, prunedTurns);
      call1Messages = [
        { role: 'system', content: call1SysPrompt },
        { role: 'user', content: call1UserPrompt }
      ];
      estCall1Tokens = estimatePromptTokens(call1Messages);
    }
  }

  if (estCall1Tokens > call1Ceiling.maxPromptTokens) {
    logger.warn({ estTokens: estCall1Tokens, ceiling: call1Ceiling.maxPromptTokens }, '[UnifiedSemanticEngine] Call 1 prompt exceeds reservation ceiling; activating safe local fallback');
    await ledger.reconcileBudget({
      reservationId: res1.reservationId,
      reservedUSD: res1.reservedUSD,
      actualPromptTokens: 0,
      actualCompletionTokens: 0,
      model,
      status: 'FAILED',
      isPreRequest: true
    });
    const fallback = buildSafeLocalFallback(rawQuery, [], { contextTurns: effectiveContextTurns, reason: 'PROMPT_CEILING_EXCEEDED' });
    fallback.latencyMs = Date.now() - startTime;
    return fallback;
  }

  let call1ApiStatus = 'NOT_STARTED';
  let call1ParsingStatus = 'NOT_APPLICABLE';
  let call1UnderstandingStatus = 'NOT_APPLICABLE';

  try {
    const rawCall1Payload = {
      model,
      messages: call1Messages,
      response_format: { type: 'json_schema', json_schema: TIKO_SEMANTIC_UNDERSTANDING_SCHEMA },
      max_completion_tokens: call1Ceiling.maxCompletionTokens,
      ...(model !== 'gpt-6-luna' && !/gpt-6|luna|o1|o3/i.test(model) ? { temperature: 0.1 } : {})
    };
    const call1Payload = sanitizeOpenAiChatPayload(rawCall1Payload);

    let rawRes = null;
    let call1PromptTokens = 0;
    let call1CompletionTokens = 0;
    let call1HasExplicitUsage = false;
    let call1FinishReason = null;
    let call1ContentRaw = null;

    if (aiClient && typeof aiClient.chatCompletionsCreate === 'function') {
      modelCallCount++;
      rawRes = await aiClient.chatCompletionsCreate(call1Payload);
      call1ApiStatus = 'API_REQUEST_SUCCESS';
      call1FinishReason = rawRes.finish_reason || rawRes.choices?.[0]?.finish_reason || 'stop';
      if (rawRes.usage) {
        call1PromptTokens = rawRes.usage.prompt_tokens ?? (typeof rawRes.usage.promptTokens === 'number' ? rawRes.usage.promptTokens : 0);
        call1CompletionTokens = rawRes.usage.completion_tokens ?? (typeof rawRes.usage.completionTokens === 'number' ? rawRes.usage.completionTokens : 0);
        call1HasExplicitUsage = true;
      }
      call1ContentRaw = rawRes.content !== undefined ? rawRes.content : rawRes.choices?.[0]?.message?.content;
    } else {
      const { OpenAI } = require('openai');
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');

      const timeoutMs = parseInt(process.env.OPENAI_TIMEOUT_MS || '25000', 10);
      const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 });
      modelCallCount++;

      const completion = await client.chat.completions.create(call1Payload);
      call1ApiStatus = 'API_REQUEST_SUCCESS';
      call1FinishReason = completion.choices[0]?.finish_reason || 'stop';
      if (completion.usage) {
        call1PromptTokens = completion.usage.prompt_tokens || 0;
        call1CompletionTokens = completion.usage.completion_tokens || 0;
        call1HasExplicitUsage = true;
      }
      call1ContentRaw = completion.choices[0]?.message?.content;
    }

    // Step 2.1: Check for token limit truncation (finish_reason === 'length')
    if (call1FinishReason === 'length') {
      call1ParsingStatus = 'PARSING_SKIPPED';
      call1UnderstandingStatus = 'OUTPUT_TRUNCATED';
      logger.warn({ finishReason: call1FinishReason, promptTokens: call1PromptTokens, completionTokens: call1CompletionTokens }, '[UnifiedSemanticEngine] Call 1 output truncated by token limit');

      const hasUsage = call1HasExplicitUsage && (call1PromptTokens > 0 || call1CompletionTokens > 0);
      if (hasUsage) {
        totalPromptTokens += call1PromptTokens;
        totalCompletionTokens += call1CompletionTokens;
        await ledger.reconcileBudget({
          reservationId: res1.reservationId,
          reservedUSD: res1.reservedUSD,
          actualPromptTokens: call1PromptTokens,
          actualCompletionTokens: call1CompletionTokens,
          model,
          status: 'SUCCESS'
        });
      } else {
        await ledger.reconcileBudget({
          reservationId: res1.reservationId,
          reservedUSD: res1.reservedUSD,
          model,
          isPreRequest: false,
          status: 'AMBIGUOUS_FAILURE',
          error: new Error('OUTPUT_TRUNCATED_BY_MAX_COMPLETION_TOKENS')
        });
      }

      const fallback = buildSafeLocalFallback(rawQuery, [], {
        contextTurns: effectiveContextTurns,
        reason: 'OUTPUT_TRUNCATED_BY_MAX_COMPLETION_TOKENS'
      });
      fallback.error = 'OUTPUT_TRUNCATED_BY_MAX_COMPLETION_TOKENS';
      fallback.apiStatuses = {
        call1Request: 'API_REQUEST_SUCCESS',
        call1Parsing: 'PARSING_SKIPPED',
        call1Understanding: 'OUTPUT_TRUNCATED',
        call2Request: 'NOT_CALLED',
        call2Parsing: 'NOT_CALLED',
        groundedSynthesis: 'NOT_CALLED',
        finalAnswer: 'SAFE_LOCAL_FALLBACK'
      };
      fallback.telemetry = {
        model,
        modelCallCount,
        totalPromptTokens,
        totalCompletionTokens,
        actualCostUSD: hasUsage ? calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model) : null,
        estimatedCostUSD: calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model),
        reservedCostUSD: res1.reservedUSD || 0.00037,
        latencyMs: Date.now() - startTime
      };
      fallback.latencyMs = Date.now() - startTime;
      return fallback;
    }

    // Step 2.2: Parse JSON
    try {
      understanding = typeof call1ContentRaw === 'object' && call1ContentRaw !== null
        ? call1ContentRaw
        : JSON.parse(call1ContentRaw);
      call1ParsingStatus = 'PARSING_SUCCESS';
    } catch (parseErr) {
      call1ParsingStatus = 'PARSING_FAILED';
      call1UnderstandingStatus = 'INVALID_JSON';
      logger.warn({ err: parseErr.message }, '[UnifiedSemanticEngine] Call 1 JSON parsing failed');
      const hasUsage = call1HasExplicitUsage && (call1PromptTokens > 0 || call1CompletionTokens > 0);
      if (hasUsage) {
        totalPromptTokens += call1PromptTokens;
        totalCompletionTokens += call1CompletionTokens;
        await ledger.reconcileBudget({
          reservationId: res1.reservationId,
          reservedUSD: res1.reservedUSD,
          actualPromptTokens: call1PromptTokens,
          actualCompletionTokens: call1CompletionTokens,
          model,
          status: 'SUCCESS'
        });
      } else {
        await ledger.reconcileBudget({
          reservationId: res1.reservationId,
          reservedUSD: res1.reservedUSD,
          model,
          isPreRequest: false,
          status: 'AMBIGUOUS_FAILURE',
          error: parseErr
        });
      }
      const fallback = buildSafeLocalFallback(rawQuery, [], {
        contextTurns: effectiveContextTurns,
        reason: 'PARSING_FAILED: ' + parseErr.message
      });
      fallback.error = 'PARSING_FAILED: ' + parseErr.message;
      fallback.apiStatuses = {
        call1Request: 'API_REQUEST_SUCCESS',
        call1Parsing: 'PARSING_FAILED',
        call1Understanding: 'INVALID_JSON',
        call2Request: 'NOT_CALLED',
        call2Parsing: 'NOT_CALLED',
        groundedSynthesis: 'NOT_CALLED',
        finalAnswer: 'SAFE_LOCAL_FALLBACK'
      };
      fallback.telemetry = {
        model,
        modelCallCount,
        totalPromptTokens,
        totalCompletionTokens,
        actualCostUSD: hasUsage ? calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model) : null,
        latencyMs: Date.now() - startTime
      };
      fallback.latencyMs = Date.now() - startTime;
      return fallback;
    }

    // Step 2.3: Bounding semantic output (max 3 entities, max 4 aspects, max 3 queries)
    if (understanding) {
      if (Array.isArray(understanding.entities) && understanding.entities.length > 3) {
        understanding.entities = understanding.entities.slice(0, 3);
      }
      if (Array.isArray(understanding.requestedAspects) && understanding.requestedAspects.length > 4) {
        understanding.requestedAspects = understanding.requestedAspects.slice(0, 4);
      }
      if (Array.isArray(understanding.normalizedSearchQueries) && understanding.normalizedSearchQueries.length > 3) {
        understanding.normalizedSearchQueries = understanding.normalizedSearchQueries.slice(0, 3);
      }
    }

    call1UnderstandingStatus = 'VALID';
    totalPromptTokens += call1PromptTokens;
    totalCompletionTokens += call1CompletionTokens;

    // Reconcile Call 1 budget
    await ledger.reconcileBudget({
      reservationId: res1.reservationId,
      reservedUSD: res1.reservedUSD,
      actualPromptTokens: call1PromptTokens,
      actualCompletionTokens: call1CompletionTokens,
      model,
      status: 'SUCCESS'
    });
  } catch (call1Err) {
    logger.warn({ err: call1Err.message }, '[UnifiedSemanticEngine] Call 1 failed, executing Safe Local Fallback');
    const isPreReq = (call1Err.message === 'OPENAI_API_KEY_MISSING' || call1Err.message === 'PROMPT_CEILING_EXCEEDED');
    await ledger.reconcileBudget({
      reservationId: res1.reservationId,
      reservedUSD: res1.reservedUSD,
      actualPromptTokens: 0,
      actualCompletionTokens: 0,
      model,
      error: call1Err,
      isPreRequest: isPreReq,
      status: isPreReq ? 'FAILED' : 'AMBIGUOUS_FAILURE'
    });
    const fallback = buildSafeLocalFallback(rawQuery, [], { contextTurns: effectiveContextTurns, reason: call1Err.message });
    fallback.error = call1Err.message;
    fallback.apiStatuses = {
      call1Request: isPreReq ? 'PRE_REQUEST_BLOCKED' : 'NETWORK_ERROR',
      call1Parsing: 'PARSING_SKIPPED',
      call1Understanding: 'FAILED',
      call2Request: 'NOT_CALLED',
      call2Parsing: 'NOT_CALLED',
      groundedSynthesis: 'NOT_CALLED',
      finalAnswer: 'SAFE_LOCAL_FALLBACK'
    };
    fallback.telemetry = {
      model,
      modelCallCount,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      actualCostUSD: isPreReq ? 0.0 : null,
      reservedCostUSD: res1.reservedUSD || 0.00037,
      latencyMs: Date.now() - startTime
    };
    fallback.latencyMs = Date.now() - startTime;
    return fallback;
  }

  // =========================================================================
  // STEP 3: Fast-Path for Pure Social Greeting / Thanks (Rule 6)
  // =========================================================================
  const isPureGreeting = understanding.speechAct === 'GENERAL_GREETING' &&
                         understanding.isPureSocialGreeting === true &&
                         understanding.requestedAspects.length === 0;

  if (isPureGreeting) {
    const greetingText = 'Halo Kak! Selamat datang di Layanan Informasi ITB STIKOM Bali. Ada yang bisa Tiko bantu seputar pendaftaran mahasiswa baru, biaya kuliah, atau program studi?';
    const result = {
      chatId,
      rawQuery,
      understanding,
      evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: [], unsupportedAspects: [] },
      factualClaims: [],
      finalAnswer: greetingText,
      naturalAnswer: greetingText,
      verification: { isValid: true },
      groundingVerification: { isValid: true, claimsCount: 0 },
      apiStatuses: {
        call1Request: 'API_REQUEST_SUCCESS',
        call1Parsing: call1ParsingStatus,
        call1Understanding: 'PURE_GREETING',
        call2Request: 'NOT_CALLED',
        call2Parsing: 'NOT_CALLED',
        groundedSynthesis: 'NOT_CALLED',
        finalAnswer: 'SUCCESS'
      },
      telemetry: {
        model,
        modelCallCount: 1, // Pure greeting: exactly 1 call
        totalPromptTokens,
        totalCompletionTokens,
        actualCostUSD: calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model),
        estimatedCostUSD: calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model),
        reservedCostUSD: res1.reservedUSD || 0.00037,
        latencyMs: Date.now() - startTime
      }
    };

    if (chatId) {
      try {
        await updateSession(chatId, {
          state: 'unified_greeting',
          dataPatch: {
            lastQuery: rawQuery,
            lastAnswer: result.finalAnswer,
            activeEntity: null
          }
        });
      } catch (_) {}
    }

    if (executeDispatch && chatId && result.finalAnswer) {
      await outboundDispatcher.sendOutboundMessage(chatId, result.finalAnswer);
    }
    return result;
  }

  // =========================================================================
  // STEP 4: Semantic-Guided Retrieval
  // =========================================================================
  let allowedEvidence = filterAllowedEvidence(candidateEvidence);

  const candidateRetriever = restOptions.retrieveCandidatesFn || retrieveCandidates;

  if (allowedEvidence.length === 0 && typeof candidateRetriever === 'function') {
    try {
      // 1. Collect distinct search queries: AI normalized queries, or rawQuery if empty
      const searchQueries = [];
      if (Array.isArray(understanding.normalizedSearchQueries)) {
        for (const q of understanding.normalizedSearchQueries) {
          const trimmed = String(q || '').trim();
          if (trimmed && !searchQueries.includes(trimmed)) {
            searchQueries.push(trimmed);
          }
        }
      }
      const trimmedRaw = String(rawQuery || '').trim();
      if (searchQueries.length === 0 && trimmedRaw) {
        searchQueries.push(trimmedRaw);
      }

      const targetEntities = (understanding.entities || []).map(e => e.canonicalId || e.raw).filter(Boolean);
      const requiredAspects = (understanding.requestedAspects || []).map(a => a.aspect).filter(Boolean);

      // 2. Search each query separately with balanced topK (min 6 per query, 10 for single query)
      const perQueryK = searchQueries.length > 1 ? Math.max(6, Math.ceil(12 / searchQueries.length)) : 10;
      const queryCandidateLists = [];

      for (const sq of searchQueries.slice(0, 3)) {
        const retrieved = await candidateRetriever({
          query: sq,
          rawQuery,
          normalizedQuery: sq,
          queryVariants: [sq],
          targetEntities,
          requiredAspects
        }, { topK: perQueryK, mode: 'hybrid' });

        const list = Array.isArray(retrieved.candidates) ? retrieved.candidates : (Array.isArray(retrieved) ? retrieved : []);
        queryCandidateLists.push(list);
      }

      // Interleave candidates from each query round-robin so multi-entity queries are equally represented
      let mergedCandidates = [];
      const seenIds = new Set();
      const maxLen = Math.max(...queryCandidateLists.map(l => l.length), 0);

      for (let i = 0; i < maxLen; i++) {
        for (const list of queryCandidateLists) {
          if (i < list.length) {
            const item = list[i];
            const id = item.id || item.source_record_id || (item.sourceFile && item.index ? `${item.sourceFile}_${item.index}` : null);
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              mergedCandidates.push(item);
            } else if (!id) {
              mergedCandidates.push(item);
            }
          }
        }
      }

      allowedEvidence = filterAllowedEvidence(mergedCandidates);

      // 2.5 Fallback to rawQuery retrieval if normalized queries yielded zero allowed evidence
      if (allowedEvidence.length === 0 && trimmedRaw && !searchQueries.includes(trimmedRaw)) {
        const rawRetrieved = await candidateRetriever({
          query: trimmedRaw,
          rawQuery: trimmedRaw,
          normalizedQuery: trimmedRaw,
          queryVariants: [trimmedRaw],
          targetEntities,
          requiredAspects
        }, { topK: 10, mode: 'hybrid' });
        const rawList = Array.isArray(rawRetrieved.candidates) ? rawRetrieved.candidates : (Array.isArray(rawRetrieved) ? rawRetrieved : []);
        allowedEvidence = filterAllowedEvidence(rawList);
      }

      // 3. Rescue OUT_OF_SCOPE if genuinely relevant official allowed evidence exists in corpus
      const topEvidence = allowedEvidence[0];
      const isTrulyRelevant = topEvidence && isEvidenceRelevantToQuery(topEvidence, rawQuery);

      if (isTrulyRelevant && understanding.speechAct === 'OUT_OF_SCOPE') {
        logger.info('[UnifiedSemanticEngine] Semantic rescue: official allowed evidence found in corpus; updating speechAct to INQUIRE_FACT');
        understanding.speechAct = 'INQUIRE_FACT';

        if (understanding.entities.length === 0) {
          const entName = topEvidence.canonicalEntity || topEvidence.program || (topEvidence.contextEntities && topEvidence.contextEntities[0]);
          if (entName) {
            understanding.entities.push({
              raw: entName,
              canonicalId: entName,
              category: 'academic_program',
              confidence: 0.85,
              isUnmapped: true
            });
          }
        }

        if (understanding.requestedAspects.length === 0) {
          const isFee = /biaya|tarif|ongkos/i.test(rawQuery) || /rincian biaya/i.test(topEvidence.sourceFile || '');
          const isDD = /double\s*degree|dual\s*degree/i.test(rawQuery) || /double degree/i.test(topEvidence.sourceFile || '');
          const aspect = isFee ? 'tuition_fee' : (isDD ? 'international_program' : 'general_policy');
          understanding.requestedAspects.push({
            aspect,
            customAspectDescription: 'rescued aspect from corpus retrieval',
            targetEntityCanonicalId: (understanding.entities[0] && understanding.entities[0].canonicalId) || 'general'
          });
        }
      }
    } catch (retrievalErr) {
      logger.warn({ err: retrievalErr.message }, '[UnifiedSemanticEngine] Semantic-guided retrieval failed');
    }
  } else if (allowedEvidence.length > 0 && understanding.speechAct === 'OUT_OF_SCOPE' && isEvidenceRelevantToQuery(allowedEvidence[0], rawQuery)) {
    logger.info('[UnifiedSemanticEngine] Semantic rescue: candidate evidence contains allowed sources; updating speechAct to INQUIRE_FACT');
    understanding.speechAct = 'INQUIRE_FACT';
  }

  // =========================================================================
  // STEP 4.5: Fail-Closed Guard - Skip Call 2 if No Allowed Evidence Found OR Still OUT_OF_SCOPE
  // Fails closed: saves Call 2 budget tokens and prevents hallucinated synthesis.
  // =========================================================================
  if (allowedEvidence.length === 0 || understanding.speechAct === 'OUT_OF_SCOPE') {
    logger.info({ rawQuery, speechAct: understanding.speechAct }, '[UnifiedSemanticEngine] No allowed canonical evidence or out-of-scope; activating safe local fallback without invoking Call 2');
    const fallback = buildSafeLocalFallback(rawQuery, allowedEvidence, {
      contextTurns: effectiveContextTurns,
      understanding,
      reason: understanding.speechAct === 'OUT_OF_SCOPE' ? 'OUT_OF_SCOPE_QUERY' : 'UNSUPPORTED_IN_CORPUS'
    });
    fallback.apiStatuses = {
      call1Request: 'API_REQUEST_SUCCESS',
      call1Parsing: call1ParsingStatus,
      call1Understanding: call1UnderstandingStatus,
      call2Request: 'NOT_CALLED',
      call2Parsing: 'NOT_CALLED',
      groundedSynthesis: 'NOT_CALLED',
      finalAnswer: 'SAFE_LOCAL_FALLBACK'
    };
    fallback.telemetry = {
      model,
      modelCallCount: 1, // Only Call 1 was executed
      totalPromptTokens,
      totalCompletionTokens,
      actualCostUSD: calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model),
      estimatedCostUSD: calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model),
      reservedCostUSD: res1.reservedUSD || 0.00037,
      latencyMs: Date.now() - startTime
    };
    fallback.latencyMs = Date.now() - startTime;

    if (chatId) {
      try {
        await updateSession(chatId, {
          state: 'unified_fallback',
          dataPatch: {
            lastQuery: rawQuery,
            lastAnswer: fallback.finalAnswer,
            activeEntity: null
          }
        });
      } catch (_) {}
    }

    if (executeDispatch && chatId && fallback.finalAnswer) {
      await outboundDispatcher.sendOutboundMessage(chatId, fallback.finalAnswer);
    }

    return fallback;
  }

  // =========================================================================
  // STEP 5: Budget Reservation for Call 2 (AI Grounded Synthesis)
  // Dynamic reservation based on model and RESERVATION_TOKEN_CEILINGS.call_2
  // =========================================================================
  const res2 = await ledger.reserveBudget({
    purpose: 'call_2',
    model,
    customRates: restOptions.customRates
  });
  if (!res2.allowed) {
    logger.warn({ reason: res2.reason, model }, '[UnifiedSemanticEngine] Call 2 budget reservation denied; activating safe fallback');
    const fallback = buildSafeLocalFallback(rawQuery, allowedEvidence, { contextTurns: effectiveContextTurns, reason: res2.reason });
    fallback.budgetExceeded = (res2.reason === 'DAILY_BUDGET_EXCEEDED');
    fallback.unverifiedModel = (res2.reason === 'REJECT_UNVERIFIED_MODEL');
    fallback.latencyMs = Date.now() - startTime;
    return fallback;
  }

  // =========================================================================
  // STEP 6: Call 2 — AI Grounded Synthesis
  // =========================================================================
  let synthesis = null;
  let call2PromptTokens = 0;
  let call2CompletionTokens = 0;
  const call2Ceiling = RESERVATION_TOKEN_CEILINGS.call_2;
  const call2SysPrompt = buildGroundedSynthesisSystemPrompt();
  let prunedEvidence = [...allowedEvidence];

  // Prioritize evidence chunks matching target entities at the head, placing filler chunks at the tail for pruning
  const targetEntityNames = (understanding.entities || []).map(e => (e.canonicalId || e.raw || '').toLowerCase()).filter(Boolean);
  if (targetEntityNames.length > 0) {
    const getChunkEntityMatchScore = (c) => {
      const f = (c.sourceFile || c.source || '').toLowerCase();
      const t = (c.text || c.chunk || '').toLowerCase();
      let s = 0;
      for (const te of targetEntityNames) {
        const clean = te.replace(/^(s1|d3|s2)\s+/i, '');
        if (f.includes(clean) || f.includes(te)) s += 10;
        if (t.includes(clean) || t.includes(te)) s += 5;
      }
      return s;
    };
    prunedEvidence.sort((a, b) => getChunkEntityMatchScore(b) - getChunkEntityMatchScore(a));
  }

  let call2UserPrompt = buildGroundedSynthesisUserPrompt(rawQuery, understanding, effectiveContextTurns, prunedEvidence);
  let call2Messages = [
    { role: 'system', content: call2SysPrompt },
    { role: 'user', content: call2UserPrompt }
  ];

  // Bound Call 2 input prompt size before network request (plafon: 2500 tokens)
  let estCall2Tokens = estimatePromptTokens(call2Messages);
  if (estCall2Tokens > call2Ceiling.maxPromptTokens && prunedEvidence.length > 0) {
    // Deterministically prune lower-priority evidence chunks from the tail
    while (prunedEvidence.length > 1 && estCall2Tokens > call2Ceiling.maxPromptTokens) {
      prunedEvidence.pop();
      call2UserPrompt = buildGroundedSynthesisUserPrompt(rawQuery, understanding, effectiveContextTurns, prunedEvidence);
      call2Messages = [
        { role: 'system', content: call2SysPrompt },
        { role: 'user', content: call2UserPrompt }
      ];
      estCall2Tokens = estimatePromptTokens(call2Messages);
    }
  }

  if (estCall2Tokens > call2Ceiling.maxPromptTokens) {
    logger.warn({ estTokens: estCall2Tokens, ceiling: call2Ceiling.maxPromptTokens }, '[UnifiedSemanticEngine] Call 2 prompt exceeds reservation ceiling; activating safe local fallback');
    await ledger.reconcileBudget({
      reservationId: res2.reservationId,
      reservedUSD: res2.reservedUSD,
      actualPromptTokens: 0,
      actualCompletionTokens: 0,
      model,
      status: 'FAILED',
      isPreRequest: true
    });
    const fallback = buildSafeLocalFallback(rawQuery, allowedEvidence, { contextTurns: effectiveContextTurns, reason: 'PROMPT_CEILING_EXCEEDED' });
    fallback.latencyMs = Date.now() - startTime;
    return fallback;
  }

  let call2ApiStatus = 'NOT_STARTED';
  let call2ParsingStatus = 'NOT_APPLICABLE';
  let call2SynthesisStatus = 'NOT_APPLICABLE';

  try {
    const rawCall2Payload = {
      model,
      messages: call2Messages,
      response_format: { type: 'json_schema', json_schema: TIKO_GROUNDED_SYNTHESIS_SCHEMA },
      max_completion_tokens: call2Ceiling.maxCompletionTokens,
      ...(model !== 'gpt-6-luna' && !/gpt-6|luna|o1|o3/i.test(model) ? { temperature: 0.2 } : {})
    };
    const call2Payload = sanitizeOpenAiChatPayload(rawCall2Payload);

    let rawRes2 = null;
    let call2HasExplicitUsage = false;
    let call2FinishReason = null;
    let call2ContentRaw = null;

    if (aiClient && typeof aiClient.chatCompletionsCreate === 'function') {
      modelCallCount++;
      rawRes2 = await aiClient.chatCompletionsCreate(call2Payload);
      call2ApiStatus = 'API_REQUEST_SUCCESS';
      call2FinishReason = rawRes2.finish_reason || rawRes2.choices?.[0]?.finish_reason || 'stop';
      if (rawRes2.usage) {
        call2PromptTokens = rawRes2.usage.prompt_tokens ?? (typeof rawRes2.usage.promptTokens === 'number' ? rawRes2.usage.promptTokens : 0);
        call2CompletionTokens = rawRes2.usage.completion_tokens ?? (typeof rawRes2.usage.completionTokens === 'number' ? rawRes2.usage.completionTokens : 0);
        call2HasExplicitUsage = true;
      }
      call2ContentRaw = rawRes2.content !== undefined ? rawRes2.content : rawRes2.choices?.[0]?.message?.content;
    } else {
      const { OpenAI } = require('openai');
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');

      const timeoutMs = parseInt(process.env.OPENAI_TIMEOUT_MS || '25000', 10);
      const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 });
      modelCallCount++;

      const completion = await client.chat.completions.create(call2Payload);
      call2ApiStatus = 'API_REQUEST_SUCCESS';
      call2FinishReason = completion.choices[0]?.finish_reason || 'stop';
      if (completion.usage) {
        call2PromptTokens = completion.usage.prompt_tokens || 0;
        call2CompletionTokens = completion.usage.completion_tokens || 0;
        call2HasExplicitUsage = true;
      }
      call2ContentRaw = completion.choices[0]?.message?.content;
    }

    if (call2FinishReason === 'length') {
      call2ParsingStatus = 'PARSING_SKIPPED';
      call2SynthesisStatus = 'OUTPUT_TRUNCATED';
      logger.warn({ finishReason: call2FinishReason, promptTokens: call2PromptTokens, completionTokens: call2CompletionTokens }, '[UnifiedSemanticEngine] Call 2 output truncated by token limit');

      const hasUsage2 = call2HasExplicitUsage && (call2PromptTokens > 0 || call2CompletionTokens > 0);
      if (hasUsage2) {
        totalPromptTokens += call2PromptTokens;
        totalCompletionTokens += call2CompletionTokens;
        await ledger.reconcileBudget({
          reservationId: res2.reservationId,
          reservedUSD: res2.reservedUSD,
          actualPromptTokens: call2PromptTokens,
          actualCompletionTokens: call2CompletionTokens,
          model,
          status: 'SUCCESS'
        });
      } else {
        await ledger.reconcileBudget({
          reservationId: res2.reservationId,
          reservedUSD: res2.reservedUSD,
          model,
          isPreRequest: false,
          status: 'AMBIGUOUS_FAILURE',
          error: new Error('OUTPUT_TRUNCATED_BY_MAX_COMPLETION_TOKENS')
        });
      }

      const fallback = buildSafeLocalFallback(rawQuery, allowedEvidence, {
        contextTurns: effectiveContextTurns,
        reason: 'OUTPUT_TRUNCATED_BY_MAX_COMPLETION_TOKENS'
      });
      fallback.error = 'OUTPUT_TRUNCATED_BY_MAX_COMPLETION_TOKENS';
      fallback.apiStatuses = {
        call1Request: 'API_REQUEST_SUCCESS',
        call1Parsing: call1ParsingStatus,
        call1Understanding: call1UnderstandingStatus,
        call2Request: 'API_REQUEST_SUCCESS',
        call2Parsing: 'PARSING_SKIPPED',
        groundedSynthesis: 'OUTPUT_TRUNCATED',
        finalAnswer: 'SAFE_LOCAL_FALLBACK'
      };
      fallback.telemetry = {
        model,
        modelCallCount,
        totalPromptTokens,
        totalCompletionTokens,
        actualCostUSD: hasUsage2 ? calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model) : null,
        estimatedCostUSD: calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model),
        reservedCostUSD: (res1.reservedUSD || 0.00037) + (res2.reservedUSD || 0.00055),
        latencyMs: Date.now() - startTime
      };
      fallback.latencyMs = Date.now() - startTime;
      return fallback;
    }

    try {
      synthesis = typeof call2ContentRaw === 'object' && call2ContentRaw !== null
        ? call2ContentRaw
        : JSON.parse(call2ContentRaw);
      call2ParsingStatus = 'PARSING_SUCCESS';
      call2SynthesisStatus = 'VALID';
    } catch (parseErr2) {
      call2ParsingStatus = 'PARSING_FAILED';
      call2SynthesisStatus = 'INVALID_JSON';
      logger.warn({ err: parseErr2.message }, '[UnifiedSemanticEngine] Call 2 JSON parsing failed');
      const hasUsage2 = call2HasExplicitUsage && (call2PromptTokens > 0 || call2CompletionTokens > 0);
      if (hasUsage2) {
        totalPromptTokens += call2PromptTokens;
        totalCompletionTokens += call2CompletionTokens;
        await ledger.reconcileBudget({
          reservationId: res2.reservationId,
          reservedUSD: res2.reservedUSD,
          actualPromptTokens: call2PromptTokens,
          actualCompletionTokens: call2CompletionTokens,
          model,
          status: 'SUCCESS'
        });
      } else {
        await ledger.reconcileBudget({
          reservationId: res2.reservationId,
          reservedUSD: res2.reservedUSD,
          model,
          isPreRequest: false,
          status: 'AMBIGUOUS_FAILURE',
          error: parseErr2
        });
      }
      const fallback = buildSafeLocalFallback(rawQuery, allowedEvidence, {
        contextTurns: effectiveContextTurns,
        reason: 'PARSING_FAILED: ' + parseErr2.message
      });
      fallback.error = 'PARSING_FAILED: ' + parseErr2.message;
      fallback.apiStatuses = {
        call1Request: 'API_REQUEST_SUCCESS',
        call1Parsing: call1ParsingStatus,
        call1Understanding: call1UnderstandingStatus,
        call2Request: 'API_REQUEST_SUCCESS',
        call2Parsing: 'PARSING_FAILED',
        groundedSynthesis: 'INVALID_JSON',
        finalAnswer: 'SAFE_LOCAL_FALLBACK'
      };
      fallback.telemetry = {
        model,
        modelCallCount,
        totalPromptTokens,
        totalCompletionTokens,
        actualCostUSD: hasUsage2 ? calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model) : null,
        latencyMs: Date.now() - startTime
      };
      fallback.latencyMs = Date.now() - startTime;
      return fallback;
    }

    totalPromptTokens += call2PromptTokens;
    totalCompletionTokens += call2CompletionTokens;

    await ledger.reconcileBudget({
      reservationId: res2.reservationId,
      reservedUSD: res2.reservedUSD,
      actualPromptTokens: call2PromptTokens,
      actualCompletionTokens: call2CompletionTokens,
      model,
      status: 'SUCCESS'
    });
  } catch (call2Err) {
    logger.warn({ err: call2Err.message }, '[UnifiedSemanticEngine] Call 2 failed, executing Safe Local Fallback');
    const isPreReq2 = (call2Err.message === 'OPENAI_API_KEY_MISSING' || call2Err.message === 'PROMPT_CEILING_EXCEEDED');
    await ledger.reconcileBudget({
      reservationId: res2.reservationId,
      reservedUSD: res2.reservedUSD,
      actualPromptTokens: call2PromptTokens || 0,
      actualCompletionTokens: call2CompletionTokens || 0,
      model,
      error: call2Err,
      isPreRequest: isPreReq2,
      status: isPreReq2 ? 'FAILED' : 'AMBIGUOUS_FAILURE'
    });
    const fallback = buildSafeLocalFallback(rawQuery, allowedEvidence, { contextTurns: effectiveContextTurns, reason: call2Err.message });
    fallback.error = call2Err.message;
    fallback.apiStatuses = {
      call1Request: 'API_REQUEST_SUCCESS',
      call1Parsing: call1ParsingStatus,
      call1Understanding: call1UnderstandingStatus,
      call2Request: isPreReq2 ? 'PRE_REQUEST_BLOCKED' : 'NETWORK_ERROR',
      call2Parsing: 'PARSING_SKIPPED',
      groundedSynthesis: 'FAILED',
      finalAnswer: 'SAFE_LOCAL_FALLBACK'
    };
    fallback.telemetry = {
      model,
      modelCallCount,
      totalPromptTokens,
      totalCompletionTokens,
      actualCostUSD: isPreReq2 ? calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model) : null,
      reservedCostUSD: (res1.reservedUSD || 0.00037) + (res2.reservedUSD || 0.00055),
      latencyMs: Date.now() - startTime
    };
    fallback.latencyMs = Date.now() - startTime;
    return fallback;
  }

  // =========================================================================
  // STEP 7: Server-Side Grounding & Factuality Verification
  // =========================================================================
  const groundingVerif = verifyUnifiedClaimsAndFacts(synthesis, allowedEvidence);

  if (!groundingVerif.isValid) {
    logger.warn({ ungrounded: groundingVerif.ungroundedClaims, degreeMismatch: groundingVerif.degreeMismatch }, '[UnifiedSemanticEngine] Grounding verification rejected claims, activating safe fallback');
    const fallback = buildSafeLocalFallback(rawQuery, allowedEvidence, { contextTurns: effectiveContextTurns, reason: 'UNGROUNDED_CLAIMS_DETECTED' });
    fallback.groundingVerification = groundingVerif;
    fallback.apiStatuses = {
      call1Request: 'API_REQUEST_SUCCESS',
      call1Parsing: call1ParsingStatus,
      call1Understanding: call1UnderstandingStatus,
      call2Request: 'API_REQUEST_SUCCESS',
      call2Parsing: call2ParsingStatus,
      groundedSynthesis: 'UNGROUNDED_REJECTED',
      finalAnswer: 'SAFE_LOCAL_FALLBACK'
    };
    fallback.latencyMs = Date.now() - startTime;
    return fallback;
  }

  // Deterministic Final Answer Verifier (PII, Phone Formats, etc.)
  const finalVerif = verifyFinalAnswer(synthesis.naturalAnswer, {
    rawQuery,
    intent: understanding.speechAct,
    entities: understanding.entities
  });

  const result = {
    chatId,
    rawQuery,
    understanding,
    evidenceArbitration: synthesis.evidenceArbitration,
    factualClaims: synthesis.factualClaims,
    uncoveredAspects: synthesis.uncoveredAspects,
    finalAnswer: synthesis.naturalAnswer,
    naturalAnswer: synthesis.naturalAnswer,
    verification: finalVerif,
    groundingVerification: groundingVerif,
    apiStatuses: {
      call1Request: 'API_REQUEST_SUCCESS',
      call1Parsing: call1ParsingStatus,
      call1Understanding: call1UnderstandingStatus,
      call2Request: 'API_REQUEST_SUCCESS',
      call2Parsing: 'PARSING_SUCCESS',
      groundedSynthesis: 'VALID',
      finalAnswer: 'SUCCESS'
    },
    telemetry: {
      model,
      modelCallCount, // Strictly <= 2
      totalPromptTokens,
      totalCompletionTokens,
      actualCostUSD: calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model),
      estimatedCostUSD: calculateModelCostUSD(totalPromptTokens, totalCompletionTokens, model),
      reservedCostUSD: (res1?.reservedUSD || 0.0) + (res2 ? (res2.reservedUSD || 0.0) : 0),
      latencyMs: Date.now() - startTime
    }
  };

  if (chatId) {
    try {
      await updateSession(chatId, {
        state: 'unified_turn',
        dataPatch: {
          lastQuery: rawQuery,
          lastAnswer: result.finalAnswer,
          activeEntity: understanding?.entities?.[0]?.canonicalId || null
        }
      });
    } catch (_) {}
  }

  // Optional outbound dispatch
  if (executeDispatch && chatId && result.finalAnswer) {
    await outboundDispatcher.sendOutboundMessage(chatId, result.finalAnswer);
  }

  return result;
}

module.exports = {
  TIKO_SEMANTIC_UNDERSTANDING_SCHEMA,
  TIKO_GROUNDED_SYNTHESIS_SCHEMA,
  isUnifiedSemanticPipelineEnabled,
  filterAllowedEvidence,
  verifyUnifiedClaimsAndFacts,
  buildSafeLocalFallback,
  estimatePromptTokens,
  processUnifiedTurn,
  isEvidenceRelevantToQuery,
  PROVABLE_PUBLIC_CANONICAL_FILES,
  PROVABLE_PUBLIC_CANONICAL_SOURCES,
  isVerifiedPublicCanonicalSource
};
