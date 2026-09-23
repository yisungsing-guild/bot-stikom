/**
 * Reusable Request Decomposition Engine
 *
 * Structurally decomposes compound natural-language queries into independently
 * answerable subrequests while strictly preserving negative controls (comparisons,
 * coordinate noun lists, coupled fee components, compound entity names).
 */

const { matchCanonicalEntities, findCanonicalEntity } = require('./canonicalEntityRegistry');
const { normalizeUserQuery } = require('../utils/queryNormalizer');

// Connectors that can separate independent clauses
const CLAUSE_CONNECTORS = [
  'dan',
  'terus',
  'trs',
  'sekalian',
  'sama',
  'lalu',
  'serta',
  'kemudian',
  'tapi',
  'sedangkan',
  'juga'
];

// Patterns that indicate an independent interrogative or predicate in a clause
const INTERROGATIVE_PATTERNS = [
  /\b(?:apa(?:kah)?|apaan|gimana|bagaimana|berapa(?:an)?|berapakah|brp)\b/i,
  /\b(?:kapan|dimana|di\s+mana|kemana|ke\s+mana)\b/i,
  /\b(?:ada\b.*?\b(?:ngga|nggak|gak|ga|tidak|kah)|apakah\s+ada)\b/i,
  /\b(?:bisa|boleh)\b.*?\b(?:ngga|nggak|gak|ga|tidak|kah)|apakah\s+(?:bisa|boleh)\b/i,
  /\b(?:lewat\s+apa|pakai\s+apa|bagaimana\s+caranya?|gimana\s+caranya?)\b/i,
  /\b(?:syaratnya?\s+(?:apa|gimana)|akreditasinya?\s+(?:apa|gimana))\b/i,
  /\b(?:biayanya?\s+(?:berapa|gimana)|pembayarannya?\s+(?:lewat|lewat\s+apa|bagaimana))\b/i,
  /\b(?:bisa\s+konversi|maksimal\s+sks|konversi\s+sks)\b/i,
  /\b(?:ada|apakah\s+ada)\s+(?:wadah|fasilitas|lab|laboratorium|perpustakaan|ukm|ormawa|ekskul|klub|prodi|jurusan|beasiswa|potongan|diskon|keringanan|bebas\s+(?:ukt|biaya)|jalur|program)\b/i,
  /\b(?:potongan|diskon|keringanan|bebas\s+(?:ukt|biaya))\b/i,
  /\b(?:kuota|daya\s+tampung|jumlah\s+(?:pasti\s+)?(?:mahasiswa|maba|penerimaan))\b/i,
  /(?<!(?:sistem|teknologi)\s+)\b(?:info|informasi|spill|minta\s+info|mau\s+tahu|tanya|tolong|mohon)\b/i
];

// Negative control patterns: When present across the whole query or near connectors, do NOT split
const COMPARISON_PATTERNS = [
  /\b(?:beda(?:nya)?|perbedaan|apa\s+bedanya|bedanya\s+apa|kelebihan|kekurangan|bandingkan|dibandingkan|komparasi|lebih\s+bagus\s+mana|pilih\s+mana)\b/i
];

const COMPOUND_NOUN_PHRASES = [
  /\bpaduan\s+suara\s+dan\s+olah\s+vokal\b/i,
  /\bsen(?:i)?\s+dan\s+budaya\b/i,
  /\bteknologi\s+dan\s+bisnis\b/i,
  /\bsarana\s+dan\s+prasarana\b/i,
  /\byayasan\s+widya\s+dharma\s+shanti\b/i,
  /\bmengapa\s+dan\s+bagaimana\b/i,
  /\bvokal\s+dan\s+musik\b/i
];

/**
 * Checks if a text fragment has an interrogative or action predicate
 */
function hasInterrogativePredicate(text) {
  if (!text || typeof text !== 'string') return false;
  return INTERROGATIVE_PATTERNS.some(re => re.test(text));
}

/**
 * Checks if query is fundamentally a comparison between entities
 */
function isComparisonQuery(text) {
  return COMPARISON_PATTERNS.some(re => re.test(text));
}

/**
 * Checks if two coordinated entities belong to one distributed predicate
 * Example: "Akreditasi Sistem Informasi dan Bisnis Digital masing-masing apa?"
 * Example: "Akreditasi prodi TI dan SI apa?"
 */
function detectDistributedPredicate(rawText) {
  const text = String(rawText || '').trim();
  if (isComparisonQuery(text)) return null;

  // Pattern A: [Predicate Prefix] [Entity 1] [dan/sama] [Entity 2] [Predicate Suffix / masing-masing]?
  // e.g. "Akreditasi Sistem Informasi dan Bisnis Digital masing-masing apa?"
  const distRe = /^([^?]*?)\b(dan|sama|serta)\b([^?]*?)$/i;
  const match = text.match(distRe);
  if (!match) return null;

  const clause1 = match[1].trim();
  const clause2 = match[3].trim();

  // If clause1 has a terminal question word before the conjunction (e.g. "akreditasi SI apa dan ...", "biaya TI berapa dan ...")
  // or clause2 contains its own explicit predicate/interrogative, this is NOT a distributed predicate!
  const hasTerminalInterrogative1 = /\b(?:apa(?:kah)?|berapa(?:an)?|gimana|bagaimana)\b[?.!]?$/i.test(clause1);
  const clause2HasDistinctPredicate = /\b(?:biaya|uang\s+kuliah|spp|ukt|dpp|akreditasi|kurikulum|mata\s+kuliah|belajar\s+apa|prospek|peluang\s+kerja|lulusan|syarat|persyaratan|sks|konversi|rpl|beasiswa|kip|lab|laboratorium|fasilitas|perpustakaan|ukm|ormawa|kuota|daya\s+tampung|jadwal|daftar|pendaftaran)\b/i.test(clause2);

  if (hasTerminalInterrogative1 || (clause2HasDistinctPredicate && hasInterrogativePredicate(clause2))) {
    return null;
  }

  const hasMasingMasing = /\bmasing[\s-]*masing\b/i.test(text);
  const entities = matchCanonicalEntities(text);
  const academicEntities = entities.filter(e => e.family === 'academic_program' || e.type === 'program');

  // Must have at least two distinct programs
  if (academicEntities.length >= 2) {
    const e1 = academicEntities[0];
    const e2 = academicEntities[1];
    if (e1.canonical.toLowerCase() !== e2.canonical.toLowerCase()) {
      // Check if there is a common predicate like "akreditasi", "biaya kuliah", "prospek karir"
      const asksAccreditation = /\bakreditasi(?:nya)?\b/i.test(text);
      const asksFee = /\b(?:biaya|uang\s+kuliah|spp|ukt|dpp)\b/i.test(text);
      const asksProspect = /\b(?:prospek|peluang\s+kerja|lulusan)\b/i.test(text);
      const asksCurriculum = /\b(?:kurikulum|mata\s+kuliah|belajar\s+apa)\b/i.test(text);

      if (asksAccreditation || (hasMasingMasing && (asksFee || asksProspect || asksCurriculum))) {
        let predicate = 'apa';
        if (asksAccreditation) {
          predicate = 'Akreditasi [ENTITY] apa?';
        } else if (asksFee) {
          predicate = 'Biaya kuliah [ENTITY] berapa?';
        } else if (asksProspect) {
          predicate = 'Prospek kerja [ENTITY] apa saja?';
        } else if (asksCurriculum) {
          predicate = 'Kurikulum [ENTITY] mempelajari apa?';
        }

        return {
          type: 'DISTRIBUTED_ENTITIES',
          entities: [e1, e2],
          predicateTemplate: predicate
        };
      }
    }
  }

  return null;
}

/**
 * Checks negative controls where conjunction "dan" should NOT cause a split
 */
function isNegativeControl(clause1, clause2, fullText) {
  // 1. Comparison
  if (isComparisonQuery(fullText)) return true;

  // 2. Compound fixed noun phrases
  for (const compound of COMPOUND_NOUN_PHRASES) {
    if (compound.test(fullText)) return true;
  }

  // 3. Coupled fee components under single predicate:
  // e.g. "biaya DPP dan UKT berapa?"
  // clause1 ends with "biaya dpp", clause2 is "ukt berapa"
  const coupledFee = /\b(?:dpp|ukt|spp|uang\s+gedung|pendaftaran)\s*$/i.test(clause1.trim())
    && /^\s*(?:dpp|ukt|spp|uang\s+gedung|biaya\s+kuliah)\b/i.test(clause2.trim());
  if (coupledFee && !hasInterrogativePredicate(clause1)) return true;

  // 4. Coordinated noun objects without independent verb in clause1:
  // e.g. "fasilitas lab dan perpustakaan ada apa saja?"
  // clause1 = "fasilitas lab", clause2 = "perpustakaan ada apa saja"
  // Here clause1 has no interrogative predicate!
  const hasInterrogative1 = hasInterrogativePredicate(clause1);
  const hasInterrogative2 = hasInterrogativePredicate(clause2);

  // If clause1 does NOT have an interrogative predicate and is just a noun phrase, do NOT split
  if (!hasInterrogative1 && hasInterrogative2) {
    // Check if clause1 is merely an object: e.g. "fasilitas lab"
    // Unless it's an imperative or separate question (e.g. "saya mau tanya lab")
    if (/^\s*(?:fasilitas|sarana|prasarana|gedung|ruang|prodi|jurusan|dokumen|syarat)?\s*[a-zA-Z0-9\s]{1,25}$/i.test(clause1.trim())) {
      return true;
    }
  }

  return false;
}

/**
 * Main decomposition function
 * @param {string} rawText
 * @param {object} options
 * @returns {object} decomposition result
 */
function decomposeSemanticRequests(rawText, options = {}) {
  const original = String(rawText || '').trim();
  const normObj = typeof normalizeUserQuery === 'function'
    ? normalizeUserQuery(original)
    : null;
  const text = (normObj && normObj.normalizedText) ? normObj.normalizedText : original;
  if (!original) {
    return { isCompound: false, requests: [] };
  }

  // Check comparison negative control first
  if (isComparisonQuery(text)) {
    return {
      isCompound: false,
      requests: [{
        text,
        span: [0, text.length],
        connector: null,
        explicitEntities: matchCanonicalEntities(text),
        inheritedLocalAnchors: []
      }]
    };
  }

  // Check distributed predicate Case B:
  // "Akreditasi Sistem Informasi dan Bisnis Digital masing-masing apa?"
  const dist = detectDistributedPredicate(text);
  if (dist && dist.type === 'DISTRIBUTED_ENTITIES') {
    const reqs = dist.entities.map((ent, idx) => {
      const generatedText = dist.predicateTemplate.replace('[ENTITY]', ent.canonical);
      return {
        text: generatedText,
        originalSnippet: ent.matchedAlias,
        span: [0, text.length],
        connector: 'dan',
        explicitEntities: [ent],
        inheritedLocalAnchors: []
      };
    });
    return {
      isCompound: true,
      decompositionType: 'DISTRIBUTED_ENTITIES',
      requests: reqs
    };
  }
  // Split Step 1: Punctuation-based splitting (? or \n or ;) on original text BEFORE stripping punctuation
  // Example: "Apakah ada lab komputer? Berapa biaya pendaftarannya?"
  if (original.includes('?') || original.includes('\n') || original.includes(';')) {
    const rawParts = original
      .split(/(?<=[?;\n])\s+/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (rawParts.length > 1) {
      // Verify that each part is a meaningful independent question/clause
      const validSubrequests = [];
      for (const part of rawParts) {
        // Clean trailing punctuation for predicate checking
        const cleanPart = part.replace(/[?.!]+$/, '').trim();
        if (cleanPart.length >= 3 && hasInterrogativePredicate(cleanPart)) {
          validSubrequests.push(part);
        } else if (cleanPart.length >= 8) {
          validSubrequests.push(part);
        }
      }

      if (validSubrequests.length > 1) {
        return buildResolvedSubrequests(validSubrequests, original, '?');
      }
    }
  }

  // Split Step 2: Conjunction-based splitting on original text
  // Word-boundary connector regex
  // Connectors: "dan", "terus", "trs", "sekalian", "sama", "lalu", "serta"
  const connectorRegex = new RegExp(`\\b(${CLAUSE_CONNECTORS.join('|')})\\b`, 'gi');
  let match;
  let splitCandidate = null;

  while ((match = connectorRegex.exec(original)) !== null) {
    const connector = match[1].toLowerCase();
    const index = match.index;
    const clause1 = original.slice(0, index).trim();
    const clause2 = original.slice(index + match[0].length).trim();

    if (!clause1 || !clause2) continue;

    // Check negative controls
    if (isNegativeControl(clause1, clause2, original)) {
      continue;
    }

    // Both clauses must have valid interrogative or explicit topic/predicate
    const normC1 = typeof normalizeUserQuery === 'function' ? (normalizeUserQuery(clause1)?.normalizedText || clause1) : clause1;
    const normC2 = typeof normalizeUserQuery === 'function' ? (normalizeUserQuery(clause2)?.normalizedText || clause2) : clause2;

    const hasP1 = hasInterrogativePredicate(clause1) || hasInterrogativePredicate(normC1);
    const hasP2 = hasInterrogativePredicate(clause2) || hasInterrogativePredicate(normC2);

    // Or clause starts with a distinct topic predicate
    const clause2HasTopic = /\b(?:biaya|akreditasi|rpl|beasiswa|potongan|diskon|keringanan|bebas\s+(?:ukt|biaya)|fasilitas|lab|laboratorium|perpustakaan|ukm|ormawa|kuota|daya\s+tampung|jumlah\s+(?:pasti|maba|mahasiswa)|pembayaran|jadwal|info|syarat)\b/i.test(clause2) || /\b(?:biaya|akreditasi|rpl|beasiswa|potongan|diskon|keringanan|bebas\s+(?:ukt|biaya)|fasilitas|lab|laboratorium|perpustakaan|ukm|ormawa|kuota|daya\s+tampung|jumlah\s+(?:pasti|maba|mahasiswa)|pembayaran|jadwal|info|syarat)\b/i.test(normC2);
    const clause1HasTopic = /\b(?:biaya|akreditasi|rpl|beasiswa|potongan|diskon|keringanan|bebas\s+(?:ukt|biaya)|fasilitas|lab|laboratorium|perpustakaan|ukm|ormawa|kuota|daya\s+tampung|jumlah\s+(?:pasti|maba|mahasiswa)|pembayaran|jadwal|info|syarat)\b/i.test(clause1) || /\b(?:biaya|akreditasi|rpl|beasiswa|potongan|diskon|keringanan|bebas\s+(?:ukt|biaya)|fasilitas|lab|laboratorium|perpustakaan|ukm|ormawa|kuota|daya\s+tampung|jumlah\s+(?:pasti|maba|mahasiswa)|pembayaran|jadwal|info|syarat)\b/i.test(normC1);

    if ((hasP1 || clause1HasTopic) && (hasP2 || clause2HasTopic)) {
      splitCandidate = {
        clauses: [clause1, clause2],
        connector
      };
      break; // Take the primary split
    }
  }

  if (splitCandidate) {
    return buildResolvedSubrequests(splitCandidate.clauses, original, splitCandidate.connector);
  }

  // Fallback: single request (no decomposition)
  return {
    isCompound: false,
    requests: [{
      text: original,
      span: [0, original.length],
      connector: null,
      explicitEntities: matchCanonicalEntities(original),
      inheritedLocalAnchors: []
    }]
  };
}

/**
 * Builds resolved subrequest objects with entity extraction and local anchor binding
 */
function buildResolvedSubrequests(clauses, fullText, connector) {
  const requests = [];
  let currentOffset = 0;
  let previousExplicitEntities = [];

  for (let i = 0; i < clauses.length; i++) {
    const clauseText = clauses[i].trim();
    const spanStart = fullText.indexOf(clauseText, currentOffset);
    const spanEnd = spanStart !== -1 ? spanStart + clauseText.length : currentOffset + clauseText.length;
    currentOffset = spanEnd;

    let resolvedText = clauseText;

    // Coordinate predicate inheritance: ONLY for coordinate entity clauses like "Akreditasi SI dan Bisnis Digital masing-masing apa?"
    const clauseExplicitEntities = matchCanonicalEntities(clauseText);
    const hasExplicitPredicate = /\b(?:biaya|uang\s+kuliah|spp|ukt|dpp|pendaftaran|daftar|akreditasi|kurikulum|mata\s+kuliah|belajar|prospek|peluang\s+kerja|lulusan|syarat|persyaratan|sks|konversi|rpl|beasiswa|kip|lab|laboratorium|fasilitas|perpustakaan|ukm|ormawa|kuota|daya\s+tampung|jadwal|bayar|pembayaran)\b/i.test(clauseText);
    const hasOnlyEntity = clauseExplicitEntities.length === 1 && !hasInterrogativePredicate(clauseText) && !hasExplicitPredicate && !/\b(?:ada|apakah|bisa|fasilitas|lab|ukm|biaya|syarat|prospek|kuota|diskon)\b/i.test(clauseText);
    const isCoordinateEntityClause = (/\b(?:masing-masing|kedua|keduanya)\b/i.test(clauseText) && clauseExplicitEntities.length > 0 && !hasExplicitPredicate) || hasOnlyEntity;
    const clause0PredicateMatch = clauses[0].match(/^(akreditasi|biaya\s+kuliah|prospek\s+kerja)\b/i);
    if (i > 0 && isCoordinateEntityClause && clause0PredicateMatch && !new RegExp(`\\b${clause0PredicateMatch[1]}\\b`, 'i').test(resolvedText)) {
      resolvedText = `${clause0PredicateMatch[1]} ${resolvedText}`;
    }

    // Registration payment topic inheritance: "Biaya pendaftaran berapa dan pembayarannya lewat apa?"
    if (i > 0 && /\b(?:pembayaran(?:nya)?|bayar(?:nya)?)\b/i.test(resolvedText) && !/\b(?:pendaftaran|kuliah|spp|ukt)\b/i.test(resolvedText)) {
      if (/\b(?:pendaftaran|daftar)\b/i.test(clauses[0])) {
        if (/\bpembayarannya\b/i.test(resolvedText)) {
          resolvedText = resolvedText.replace(/\bpembayarannya\b/i, 'pembayaran pendaftaran');
        } else if (/\bpembayaran\b/i.test(resolvedText)) {
          resolvedText = resolvedText.replace(/\bpembayaran\b/i, 'pembayaran pendaftaran');
        } else {
          resolvedText = `pembayaran pendaftaran ${resolvedText}`;
        }
      }
    }

    // Academic / Thesis topic inheritance: e.g. "apakah tugas akhir skripsi di stikom bisa dikerjakan berkelompok dan bagaimana pembagian tanggung jawabnya?"
    if (i > 0 && /\b(?:tanggung\s*jawab(?:nya)?|pembagian(?:nya)?|ketentuan(?:nya)?|aturan(?:nya)?|syarat(?:nya)?|minimal\s+(?:ipk|sks)|durasi(?:nya)?|waktu(?:nya)?|lama(?:nya)?|ujian(?:nya)?|proposal(?:nya)?|sidang(?:nya)?|bimbingan(?:nya)?|pembimbing(?:nya)?|penguji(?:nya)?|revisi(?:nya)?)\b/i.test(resolvedText) && !/\b(?:tugas\s+akhir|skripsi|tesis)\b/i.test(resolvedText)) {
      if (/\b(?:tugas\s+akhir|skripsi|tesis)\b/i.test(clauses[0])) {
        const thesisTerm = clauses[0].match(/\b(?:tugas\s+akhir(?:\s+skripsi)?|skripsi|tesis)\b/i);
        const levelTerm = clauses[0].match(/\b(?:s1|sarjana|d3|diploma|s2|magister)\b/i);
        if (thesisTerm) {
          const inheritedParts = [thesisTerm[0]];
          if (levelTerm && !/\b(?:s1|sarjana|d3|diploma|s2|magister)\b/i.test(resolvedText)) {
            inheritedParts.push(levelTerm[0]);
          }
          resolvedText = `${resolvedText.replace(/\?$/, '')} ${inheritedParts.join(' ')}?`;
        }
      }
    }

    // Extract explicit entities directly present in this clause
    const explicitEntities = matchCanonicalEntities(resolvedText);

    // Determine message-local anchor inheritance:
    // When clause i has NO explicit entity of a given family, but has anaphoric cues or asks about
    // an entity-dependent attribute without specifying an entity, inherit ONLY compatible missing dimensions!
    // Invariant: PARENT EXPLICIT ENTITY > missing entity in generated subrequest,
    // but: subrequest explicit entity > inherited parent entity.
    let inheritedLocalAnchors = [];
    const hasAnaphora = /\b(?:kuliahnya|akreditasinya|prodinya|jurusan(?:nya)?|biayanya|telepon(?:nya)?|nomor(?:nya)?|kontak(?:nya)?|alamat(?:nya)?|lokasi(?:nya)?|fasilitas(?:nya)?|jadwal(?:nya)?|syarat(?:nya)?|kegiatan(?:nya)?|email(?:nya)?|proposalnya|ujiannya|sidangnya|durasinya|waktunya)\b/i.test(resolvedText)
      || (/\b\w+nya\b/i.test(resolvedText) && !/\b(?:hanya|tanya|sebenarnya|biasanya|tampaknya|akhirnya|asalnya|kiranya)\b/i.test(resolvedText))
      || /\b(?:nya|tersebut|ini|itu|resminya)\b/i.test(resolvedText);
    const isProgramDependent = /\b(?:akreditasi|biaya|biaya\s+kuliah|spp|ukt|dpp|kurikulum|matkul|lulusan|prospek)\b/i.test(resolvedText);
    const isAcademicDependent = /\b(?:tugas\s+akhir|skripsi|tesis|proposal|ujian|sidang|bimbingan|yudisium|wisuda|ipk|sks)\b/i.test(resolvedText);
    const isCampusDependent = /\b(?:alamat|lokasi|posisi|tempat|gedung|kampus)\b/i.test(resolvedText);
    const isContactDependent = /\b(?:email|surel|telepon|nomor\s+telepon|no\s+telp|kontak|call\s*center|narahubung|whatsapp|hotline)\b/i.test(resolvedText);
    const isOrgDependent = /\b(?:kegiatan|proker|latihan|gabung|pembina|divisi)\b/i.test(resolvedText);

    if (previousExplicitEntities.length > 0) {
      let compatibleParent = null;
      if (isProgramDependent) {
        compatibleParent = previousExplicitEntities.find(e => e.family === 'academic_program' || e.type === 'program' || e.type === 'international_program');
      } else if (isAcademicDependent) {
        compatibleParent = previousExplicitEntities.find(e => e.family === 'academic_scope' || e.type === 'academic_level' || e.family === 'academic_program' || e.type === 'program');
      } else if (isCampusDependent) {
        compatibleParent = previousExplicitEntities.find(e => e.family === 'campus_location' || e.type === 'campus');
      } else if (isContactDependent) {
        compatibleParent = previousExplicitEntities.find(e => e.family === 'campus_location' || e.type === 'campus' || e.family === 'student_organization' || e.family === 'campus_facility' || e.family === 'academic_program' || e.type === 'program' || e.family === 'campus_service' || e.type === 'campus_service' || e.role === 'campus_service');
      } else if (isOrgDependent) {
        compatibleParent = previousExplicitEntities.find(e => e.family === 'student_organization' || e.type === 'student_activity_unit' || e.type === 'student_association');
      } else if (hasAnaphora) {
        compatibleParent = previousExplicitEntities[0];
      }

      // Inherit ONLY if clause i does not have its own explicit entity of the compatible family
      if (compatibleParent && !explicitEntities.some(e => e.family === compatibleParent.family || e.type === compatibleParent.type)) {
        inheritedLocalAnchors.push(compatibleParent);
      }
    }

    // Save explicit entities for subsequent clauses in the same message
    if (explicitEntities.length > 0) {
      previousExplicitEntities = explicitEntities;
    }

    requests.push({
      text: resolvedText,
      span: [spanStart >= 0 ? spanStart : 0, spanEnd],
      connector: i === 0 ? null : connector,
      explicitEntities,
      inheritedLocalAnchors
    });
  }

  return {
    isCompound: requests.length > 1,
    requests
  };
}

module.exports = {
  decomposeSemanticRequests,
  isComparisonQuery,
  hasInterrogativePredicate
};
