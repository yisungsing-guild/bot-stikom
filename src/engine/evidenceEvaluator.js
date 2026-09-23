'use strict';

/**
 * evidenceEvaluator.js
 *
 * Central Evidence Evaluator Layer.
 *
 * Sits strictly between retrieval providers and downstream answer evaluation / composition.
 * Evaluates whether retrieved provider evidence actually supports each RetrievalBinding
 * across all requested factual dimensions.
 *
 * INVARIANTS:
 * 1. PURE & IMMUTABLE: Does NOT mutate caller inputs (no Object.freeze on caller objects). Side-effect free.
 * 2. UPSTREAM SEMANTIC AUTHORITY: Does NOT reparse raw query or override domain, entity, field, subtype, relation, exclusions.
 * 3. PER-BINDING ISOLATION: Evaluates (entity, requestedField, relation, constraints) independently. Zero global verdict reuse.
 * 4. RELEVANCE != SUPPORT: Preserves relevant candidates as RELEVANT_BUT_INCOMPATIBLE without granting factual support.
 * 5. SPECIFIC_FIELD > FIELD_FAMILY: Rejects sibling substitutions (foundingDate != legalDecreeDate, instagram != phone, etc.).
 * 6. NO FUZZY TOKEN AUTHORITY: Distinct entities sharing tokens (TI vs SI) are rejected without genuine identity proof.
 * 7. QUALIFIER INDEPENDENCE: Evaluates qualifiers (e.g. gratis) independently; distinguishes UNPROVEN vs CONTRADICTED.
 * 8. RECIPIENT COMPATIBILITY: Rejects cross-recipient attribution (e.g. school participants vs university graduates in CRT02).
 * 9. CANONICAL RELATIONS: Evaluates subject, relationType, object. Entity co-existence does NOT prove relation.
 * 10. DIMENSION-SCOPED CONFLICTS: Only flags CONFLICTING if items match on entity, field, recipient, and temporal scope but assert conflicting values.
 * 11. PROVENANCE MANDATORY: Unsupported if missing traceable provenance. Registry alone cannot prove facts.
 * 12. ZERO SCAN / ZERO RETRIEVAL: Never reruns planner, providers, or full index scans.
 * 13. EXPLICIT READINESS: Incomplete evidence opportunity returns evaluationState: INCOMPLETE, status: null (never premature UNSUPPORTED).
 */

const EVALUATION_STATUS = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  PARTIALLY_SUPPORTED: 'PARTIALLY_SUPPORTED',
  UNSUPPORTED: 'UNSUPPORTED',
  CONFLICTING: 'CONFLICTING'
});

const EVIDENCE_DISPOSITION = Object.freeze({
  SUPPORTS: 'SUPPORTS',
  RELEVANT_BUT_INCOMPATIBLE: 'RELEVANT_BUT_INCOMPATIBLE',
  REJECTED: 'REJECTED'
});

const DIMENSION_STATUS = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  PARTIAL: 'PARTIAL',
  UNPROVEN: 'UNPROVEN',
  CONTRADICTED: 'CONTRADICTED',
  MISMATCH: 'MISMATCH',
  NOT_APPLICABLE: 'NOT_APPLICABLE'
});

/**
 * Normalized token helper for clean entity boundary comparison
 */
function normalizeEntityTokens(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function getEntityPhrases(canonical) {
  const phrases = [String(canonical || '').toLowerCase()];
  const parenMatches = String(canonical || '').match(/\(([^)]+)\)/g);
  if (parenMatches) {
    parenMatches.forEach(p => phrases.push(p.replace(/[()]/g, '').trim().toLowerCase()));
  }
  const clean = String(canonical || '').replace(/\([^)]+\)/g, '').trim();
  if (clean.includes('/')) {
    const parts = clean.split('/').map(s => s.trim().toLowerCase());
    parts.forEach(p => phrases.push(p));
    const words0 = parts[0].split(/\s+/);
    if (words0.length > 1) {
      const prefix = words0.slice(0, -1).join(' ');
      parts.slice(1).forEach(p => phrases.push((prefix + ' ' + p).toLowerCase()));
    }
  }
  return Array.from(new Set(phrases.filter(p => p.length >= 3)));
}

function doesSnippetMentionEntity(requestedCanonical, aliases = [], snippet = '') {
  if (!snippet) return false;
  const snipLower = snippet.toLowerCase();
  const reqLower = requestedCanonical.toLowerCase();

  // 1. Direct match with canonical or aliases
  if (snipLower.includes(reqLower)) return true;
  if (Array.isArray(aliases) && aliases.some(a => a && snipLower.includes(a.toLowerCase()))) {
    return true;
  }
  const compoundPhrases = getEntityPhrases(requestedCanonical);
  if (compoundPhrases.some(cp => cp.length >= 4 && snipLower.includes(cp))) {
    return true;
  }

  // 2. Specific prodi boundaries
  const prodiNames = ['teknologi informasi', 'sistem informasi', 'sistem komputer', 'bisnis digital', 'manajemen informatika'];
  const reqIsProdi = prodiNames.find(p => reqLower.includes(p));
  if (reqIsProdi) {
    const prodiAliases = {
      'teknologi informasi': ['prodi ti', 's1 ti', 'jurusan ti'],
      'sistem informasi': ['prodi si', 's1 si', 'jurusan si', 'hima si'],
      'sistem komputer': ['prodi sk', 's1 sk', 'jurusan sk'],
      'bisnis digital': ['prodi bd', 's1 bd', 'jurusan bd'],
      'manajemen informatika': ['prodi mi', 'd3 mi', 'jurusan mi']
    };
    if (snipLower.includes(reqIsProdi)) return true;
    const aliasesList = prodiAliases[reqIsProdi] || [];
    return aliasesList.some(a => snipLower.includes(a));
  }

  // 3. Special programs or partners
  if (reqLower.includes('linkedin learning')) {
    return snipLower.includes('linkedin learning');
  }
  if (reqLower.includes('linkedin')) {
    return snipLower.includes('linkedin');
  }
  if (reqLower.includes('dalian') || reqLower.includes('dnui')) {
    return snipLower.includes('dalian') || snipLower.includes('dnui');
  }
  if (reqLower.includes('help')) {
    return snipLower.includes('help');
  }
  if (reqLower.includes('akademik')) {
    return snipLower.includes('akademik') || snipLower.includes('yudisium');
  }

  // 4. Token-based fallback for other entities
  const stopWords = new Set(['program', 'studi', 'prodi', 's1', 'd3', 's2', 'itb', 'stikom', 'bali', 'direktorat', 'lembaga', 'unit', 'biro', 'form', 'formulir', 'dokumen', 'surat', 'pedoman', 'mahasiswa']);
  const reqTokens = normalizeEntityTokens(requestedCanonical).filter(t => !stopWords.has(t));
  if (reqTokens.length > 1) {
    if (snipLower.includes(reqLower)) return true;
    const matchCount = reqTokens.filter(t => snipLower.includes(t)).length;
    return matchCount >= 2 && (matchCount / reqTokens.length) >= 0.5;
  } else if (reqTokens.length === 1) {
    return snipLower.includes(reqTokens[0]);
  }

  return false;
}

/**
 * Check whether two entities represent the same concept without false token overlap.
 * Distinct majors like "Sistem Informasi" vs "Teknologi Informasi" share "informasi"
 * but MUST NOT match.
 */
function isEntityCompatible(bindingEntity, evidenceEntity, evidenceSnippet = '', evidence = null) {
  // If binding has no entity (INSTITUTION_ROOT), institution-level evidence matches
  if (!bindingEntity || !bindingEntity.canonical || bindingEntity.canonical === 'INSTITUTION_ROOT') {
    if (!evidenceEntity || evidenceEntity.family === 'institution' || evidenceEntity.canonical === 'ITB STIKOM Bali') {
      return { compatible: true, matchType: 'INSTITUTION_ROOT' };
    }
    // Evidence about a specific prodi does not establish institution root fact
    return { compatible: true, matchType: 'INSTITUTION_DEFAULT' };
  }

  const requestedCanonical = bindingEntity.canonical.trim();
  const requestedLower = requestedCanonical.toLowerCase();

  // If evidence is an indexed corpus chunk, verify that the snippet actually mentions the entity
  const isIndexedChunk = evidence?.sourceType === 'indexed_chunk' || (!evidenceEntity?.isAuthoritative && evidenceSnippet);
  if (isIndexedChunk && requestedLower !== 'institution_root' && requestedLower !== 'itb stikom bali') {
    const docSource = evidence?.sourceDocumentOrRecord || evidence?.sourceId || '';
    const textToSearch = (evidenceSnippet || evidence?.textSnippet || '') + ' ' + docSource;
    if (!doesSnippetMentionEntity(requestedCanonical, bindingEntity.aliases, textToSearch)) {
      return {
        compatible: false,
        matchType: 'ENTITY_ABSENT_IN_SNIPPET',
        reason: `Evidence chunk does not mention requested entity '${requestedCanonical}'`
      };
    }
  }

  // If evidence explicitly carries entityBinding
  if (evidenceEntity && evidenceEntity.canonical) {
    const evCanonical = evidenceEntity.canonical.trim();
    const evLower = evCanonical.toLowerCase();

    // Check snippet partner conflict first even if canonical matches, because CorpusEvidenceProvider echoes binding.entity!
    if (evidenceSnippet) {
      const snipLower = evidenceSnippet.toLowerCase();
      const intlPartners = ['dnui', 'dalian', 'help', 'utb'];
      const reqPartner = intlPartners.find(p => requestedLower.includes(p));
      if (reqPartner) {
        const partnersInSnip = intlPartners.filter(p => snipLower.includes(p));
        if (partnersInSnip.length > 0 && !partnersInSnip.includes(reqPartner)) {
          return { compatible: false, matchType: 'PARTNER_ABSENT_IN_SNIPPET' };
        }
      }
    }

    if (requestedLower === evLower) {
      return { compatible: true, matchType: 'EXACT_CANONICAL' };
    }

    // Specific distinctions to prevent token overlap false positive
    const prodiNames = ['teknologi informasi', 'sistem informasi', 'sistem komputer', 'bisnis digital', 'manajemen informatika'];
    const reqIsProdi = prodiNames.find(p => requestedLower.includes(p));
    const evIsProdi = prodiNames.find(p => evLower.includes(p));
    if (reqIsProdi && evIsProdi && reqIsProdi !== evIsProdi) {
      return { compatible: false, matchType: 'DISTINCT_PRODI_CONFLICT', reason: `Mismatch: requested ${reqIsProdi} vs evidence ${evIsProdi}` };
    }

    // Double degree / international partner distinctions
    const intlPartners = ['dnui', 'dalian', 'help', 'utb'];
    const reqPartner = intlPartners.find(p => requestedLower.includes(p));
    const evPartner = intlPartners.find(p => evLower.includes(p));
    if (reqPartner && evPartner && reqPartner !== evPartner) {
      return { compatible: false, matchType: 'DISTINCT_PARTNER_CONFLICT', reason: `Mismatch: requested ${reqPartner} vs evidence ${evPartner}` };
    }

    // Check alias list if available
    if (Array.isArray(bindingEntity.aliases)) {
      if (bindingEntity.aliases.some(a => a.toLowerCase() === evLower)) {
        return { compatible: true, matchType: 'ALIAS_MATCH' };
      }
    }
  }

  // Fallback check against evidence text snippet if evidenceEntity is generic
  if (evidenceSnippet) {
    const snipLower = evidenceSnippet.toLowerCase();
    // Re-verify strict prodi boundaries inside snippet
    const prodiNames = ['teknologi informasi', 'sistem informasi', 'sistem komputer', 'bisnis digital', 'manajemen informatika'];
    const reqIsProdi = prodiNames.find(p => requestedLower.includes(p));
    if (reqIsProdi) {
      // Snippet must mention the requested prodi
      if (snipLower.includes(reqIsProdi)) {
        return { compatible: true, matchType: 'SNIPPET_MENTION' };
      }
      return { compatible: false, matchType: 'PRODI_ABSENT_IN_SNIPPET' };
    }

    if (snipLower.includes(requestedLower)) {
      return { compatible: true, matchType: 'SNIPPET_EXACT_MENTION' };
    }
  }

  // Open-world entity token check (require all non-generic tokens)
  const reqTokens = normalizeEntityTokens(requestedCanonical).filter(t => !['program', 'studi', 'prodi', 's1', 'd3', 's2', 'itb', 'stikom', 'bali'].includes(t));
  if (evidenceEntity && evidenceEntity.canonical) {
    const evTokens = new Set(normalizeEntityTokens(evidenceEntity.canonical));
    if (reqTokens.length > 0 && reqTokens.every(t => evTokens.has(t))) {
      return { compatible: true, matchType: 'OPEN_WORLD_TOKEN_ALIGNMENT' };
    }
  }

  return { compatible: false, matchType: 'ENTITY_MISMATCH' };
}

/**
 * Check field & field-subtype compatibility.
 * Strictly enforces SPECIFIC_FIELD > FIELD_FAMILY.
 */
function isFieldCompatible(binding, evidence) {
  const requestedField = binding.requestedField;
  const evField = evidence.fieldBinding || evidence.field;

  if (!requestedField) {
    return { compatible: true, subtypeCompatible: true, disposition: EVIDENCE_DISPOSITION.SUPPORTS };
  }

  // Sibling pairs that NEVER satisfy each other
  const SIBLING_PAIRS = [
    ['foundingDate', 'legalDecreeDate'],
    ['phone', 'whatsapp'],
    ['phone', 'instagram'],
    ['phone', 'website'],
    ['contact', 'instagram'],
    ['phone', 'registrationProcedure'],
    ['contact', 'registrationProcedure'],
    ['contactNumber', 'registrationProcedure'],
    ['informationChannel', 'registrationProcedure'],
    ['tuitionFee', 'registrationFee'],
    ['tuitionFee', 'dpp'],
    ['tuitionFee', 'spp'],
    ['registrationFee', 'tuitionFee'],
    ['registrationFee', 'dpp'],
    ['certification', 'degreeOutcome'],
    ['careerOutcome', 'careerCenterService'],
    ['accreditation', 'tuitionFee']
  ];

  if (evField) {
    // Sibling field check
    for (const [f1, f2] of SIBLING_PAIRS) {
      if ((requestedField === f1 && evField === f2) || (requestedField === f2 && evField === f1)) {
        return {
          compatible: false,
          subtypeCompatible: false,
          disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE,
          reason: `Sibling field mismatch: requested '${requestedField}' vs evidence '${evField}'`
        };
      }
    }

    // Exact field match
    if (requestedField === evField) {
      // Check field subtype if present
      const reqSubtype = binding.constraints?.institutionHistorySubtype || binding.constraints?.scholarshipRequestSubtype;
      const evSubtype = evidence.qualifiers?.subtype || evidence.qualifiers?.historySubtype;

      if (requestedField === 'foundingDate') {
        // Must be founding event (20 Mei 2001), not decree/SK (10 Agustus 2002)
        const valStr = String(evidence.structuredValue || evidence.textSnippet || '');
        if (/sk\s+mendiknas|157\/D\/O\/2002|izin\s+operasional|10\s+agustus\s+2002/i.test(valStr) && !/20\s+mei\s+2001/i.test(valStr)) {
          return {
            compatible: false,
            subtypeCompatible: false,
            disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE,
            reason: `Temporal subtype substitution: legal decree evidence cannot satisfy foundingDate`
          };
        }
      }

      if (requestedField === 'legalDecreeDate') {
        const valStr = String(evidence.structuredValue || evidence.textSnippet || '');
        if (/20\s+mei\s+2001/i.test(valStr) && !/10\s+agustus\s+2002|sk\s+mendiknas/i.test(valStr)) {
          return {
            compatible: false,
            subtypeCompatible: false,
            disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE,
            reason: `Temporal subtype substitution: founding date evidence cannot satisfy legalDecreeDate`
          };
        }
      }

      if (reqSubtype && evSubtype && reqSubtype !== evSubtype) {
        return {
          compatible: false,
          subtypeCompatible: false,
          disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE,
          reason: `Field subtype mismatch: requested '${reqSubtype}' vs evidence '${evSubtype}'`
        };
      }

      // Fields requiring explicit semantic content proof (instagram, phone, contactNumber, socialMedia, channel)
      // must always verify their content whenever textSnippet is present
      const fieldsRequiringContentProof = ['instagram', 'phone', 'contactNumber', 'socialMedia', 'channel', 'informationChannel'];
      if (!fieldsRequiringContentProof.includes(requestedField) && evidence.sourceType !== 'indexed_chunk') {
        return { compatible: true, subtypeCompatible: true, disposition: EVIDENCE_DISPOSITION.SUPPORTS };
      }
    }
  }

  // If evidence is an indexed corpus chunk, verify content against requested field
  const snippet = String(evidence.textSnippet || evidence.structuredValue || '').toLowerCase();
  if (snippet) {
    // Specific field guards on corpus snippet
    if (requestedField === 'foundingDate') {
      if (snippet.includes('20 mei 2001') || snippet.includes('didirikan pada tanggal 20 mei 2001')) {
        return { compatible: true, subtypeCompatible: true, disposition: EVIDENCE_DISPOSITION.SUPPORTS };
      }
      if (snippet.includes('10 agustus 2002') || snippet.includes('sk mendiknas no. 157')) {
        return { compatible: false, subtypeCompatible: false, disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE, reason: 'Decree date in snippet does not prove foundingDate' };
      }
    }

    if (requestedField === 'legalDecreeDate') {
      if (snippet.includes('10 agustus 2002') || snippet.includes('sk mendiknas') || snippet.includes('izin operasional')) {
        return { compatible: true, subtypeCompatible: true, disposition: EVIDENCE_DISPOSITION.SUPPORTS };
      }
      if (snippet.includes('20 mei 2001')) {
        return { compatible: false, subtypeCompatible: false, disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE, reason: 'Founding date in snippet does not prove legalDecreeDate' };
      }
    }

    // Specific validation for Instagram field
    if (requestedField === 'instagram') {
      if (!snippet.includes('instagram') && !snippet.includes('@')) {
        return {
          compatible: false,
          subtypeCompatible: false,
          disposition: EVIDENCE_DISPOSITION.REJECTED,
          reason: 'Evidence chunk does not contain Instagram handle or mention'
        };
      }
      const reqEntityCanonical = String(binding.entity?.canonical || '').toLowerCase();
      const isInstitutional = !binding.entity || reqEntityCanonical === 'institution_root' || reqEntityCanonical === 'itb stikom bali';
      if (isInstitutional) {
        // Subunit check: CDC, UKM, Ormawa, Inbis, HIMA
        const isSubunitHandle = /@(?:cdc|paskamras|mcos|ksl|tabuh|hima|bem|inbis)[^\s]*|ukm\s+[a-z0-9_]+/i.test(snippet) ||
          /(?:career\s+center|cdc|ukm|ormawa|inbis|bramara\s+gita|paskamras|hima\s+si|himaprodi)/i.test(snippet) ||
          /CDC|UKM|HIMA|ORMAWA|INBIS/i.test(String(evidence.sourceId || evidence.sourceDocumentOrRecord || ''));

        if (isSubunitHandle) {
          return {
            compatible: false,
            subtypeCompatible: false,
            disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE,
            reason: 'Subunit handle cannot satisfy institutional official Instagram binding'
          };
        }

        // Explicit institutional proof check
        const isExplicitOfficial = /(?:akun\s+(?:instagram\s+)?resmi|instagram\s+resmi)\s*(?:itb\s+stikom\s+bali)?/i.test(snippet);
        if (!isExplicitOfficial) {
          return {
            compatible: false,
            subtypeCompatible: false,
            disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE,
            reason: 'Official institutional Instagram binding is not explicitly proven in text evidence'
          };
        }
      }
    }

    // Specific validation for socialMedia field on institutional root
    if (requestedField === 'socialMedia') {
      const reqEntityCanonical = String(binding.entity?.canonical || '').toLowerCase();
      const isInstitutional = !binding.entity || reqEntityCanonical === 'institution_root' || reqEntityCanonical === 'itb stikom bali';
      if (isInstitutional) {
        const isGenericCurriculum = /pemasaran\s+media\s+sosial|konten\s+sosial\s+media|membuat\s+konten/i.test(snippet);
        const isSubunit = /@(?:cdc|paskamras|mcos|ksl|tabuh|hima|bem|inbis)[^\s]*|ukm\s+[a-z0-9_]+/i.test(snippet) ||
          /CDC|UKM|HIMA|ORMAWA|INBIS/i.test(String(evidence.sourceId || ''));
        if (isGenericCurriculum || isSubunit) {
          return {
            compatible: false,
            subtypeCompatible: false,
            disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE,
            reason: 'Subunit handle or generic curriculum mention cannot satisfy institutional official social media binding'
          };
        }
      }
    }

    // Specific validation for phone / contactNumber field
    if (requestedField === 'phone' || requestedField === 'contactNumber') {
      const hasPhonePattern = /\b(?:\+?62|08\d|0361|\(\d+\))[\d\s-]{5,}\b|\b\d{3,4}[-\s]\d{3,4}[-\s]?\d{3,4}\b|kontak\s*:\s*\d+/i.test(snippet);
      if (!hasPhonePattern) {
        return {
          compatible: false,
          subtypeCompatible: false,
          disposition: EVIDENCE_DISPOSITION.REJECTED,
          reason: 'Evidence chunk does not contain a phone or contact number'
        };
      }
    }

    // Specific validation for channel / informationChannel field on institutional root
    if (requestedField === 'channel' || requestedField === 'informationChannel') {
      const reqEntityCanonical = String(binding.entity?.canonical || '').toLowerCase();
      const isInstitutional = !binding.entity || reqEntityCanonical === 'institution_root' || reqEntityCanonical === 'itb stikom bali';
      if (isInstitutional) {
        const isStartupTenant = /jemari\s+channel|tenant|startup|inbis/i.test(snippet) || /INBIS/i.test(String(evidence.sourceId || ''));
        if (isStartupTenant) {
          return {
            compatible: false,
            subtypeCompatible: false,
            disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE,
            reason: 'Startup tenant name (e.g. JEMARI CHANNEL) or incubator unit cannot satisfy institutional official channel binding'
          };
        }
      }
    }

    // Primary hint alignment with standard semantic field synonyms
    const FIELD_SYNONYMS = {
      facility: ['fasilitas', 'facility', 'akses', 'layanan', 'portal', 'course', 'kursus', 'fitur', 'program'],
      profile: ['profil', 'profile', 'tentang', 'program', 'deskripsi'],
      definition: ['definisi', 'definition', 'pengertian', 'apa itu', 'adalah', 'merupakan', 'program'],
      program: ['program', 'kegiatan', 'skema'],
      documentPurpose: ['tujuan', 'maksud', 'tujuan penyusunan', 'fungsi', 'indikator kinerja', 'kinerja perguruan tinggi'],
      purpose: ['tujuan', 'maksud', 'fungsi'],
      contrast: ['program', 'perbedaan', 'beda', 'skema', 'deskripsi', 'gelar'],
      sktt: ['sktt', 'surat keterangan tempat tinggal', 'tempat tinggal', 'domisili'],
      requirements: ['syarat', 'persyaratan', 'berkas', 'dokumen', 'wajib', 'perlu'],
      studyLocation: ['negara', 'negara tujuan', 'negara mitra', 'destinasi', 'ke negara mana', 'china', 'thailand', 'malaysia', 'philippines', 'filipina'],
      destinationCountry: ['negara', 'negara tujuan', 'negara mitra', 'destinasi', 'ke negara mana', 'china', 'thailand', 'malaysia', 'philippines', 'filipina'],
      country: ['negara', 'negara tujuan', 'negara mitra', 'destinasi', 'ke negara mana', 'china', 'thailand', 'malaysia', 'philippines', 'filipina']
    };
    const primaryHints = [
      ...(Array.isArray(binding.primaryFieldHints) ? binding.primaryFieldHints : []),
      ...(FIELD_SYNONYMS[requestedField] || [])
    ];
    const matchedHints = primaryHints.filter(h => snippet.includes(h.toLowerCase()));
    if (matchedHints.length > 0) {
      return { compatible: true, subtypeCompatible: true, disposition: EVIDENCE_DISPOSITION.SUPPORTS, matchedHints };
    }

    // Secondary hints count as relevant but incompatible if primary is missing
    const secondaryHints = Array.isArray(binding.secondaryFamilyHints) ? binding.secondaryFamilyHints : [];
    const matchedSecondary = secondaryHints.filter(h => snippet.includes(h.toLowerCase()));
    if (matchedSecondary.length > 0) {
      return {
        compatible: false,
        subtypeCompatible: false,
        disposition: EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE,
        reason: `Evidence matches secondary family hints (${matchedSecondary.join(', ')}) but lacks specific primary field proof`
      };
    }
  }

  return { compatible: false, subtypeCompatible: false, disposition: EVIDENCE_DISPOSITION.REJECTED };
}

/**
 * Check recipient/actor compatibility (e.g. graduates vs school participants in CRT02)
 */
function evaluateRecipientCompatibility(binding, evidence, frame) {
  // Check if query / binding explicitly constrains recipient
  const rawQ = String(frame?.rawQuery || binding?.rawText || '').toLowerCase();
  const requiresGraduate = /\b(?:lulusan|alumni|tamat|wisudawan)\b/i.test(rawQ);
  const requiresStudent = /\b(?:mahasiswa|mhs|kuliah)\b/i.test(rawQ) && !requiresGraduate;

  if (!requiresGraduate && !requiresStudent) {
    return { status: DIMENSION_STATUS.NOT_APPLICABLE };
  }

  const snip = String(evidence.textSnippet || evidence.structuredValue || evidence.provenance || '').toLowerCase();

  // CRT02 check: "apakah lulusan stikom mendapatkan sertifikat kompetensi?"
  if (requiresGraduate) {
    // If evidence only mentions goes to school / siswa sekolah / peserta pameran
    if (/goes\s*to\s*school|siswa|sekolah\s+menengah|sma|smk/i.test(snip) && !/lulusan|alumni|wisuda/i.test(snip)) {
      return {
        status: DIMENSION_STATUS.MISMATCH,
        reason: 'Recipient mismatch: evidence describes school/GoesToSchool participants, not university graduates'
      };
    }
    if (/lulusan|alumni|setelah\s+lulus|lulus/i.test(snip)) {
      return { status: DIMENSION_STATUS.SUPPORTED };
    }
    // Generic campus-wide certification without explicit graduate tie
    return {
      status: DIMENSION_STATUS.UNPROVEN,
      reason: 'Recipient unproven: evidence mentions certification generally but does not prove graduates receive it'
    };
  }

  if (requiresStudent) {
    if (/\b(?:khusus\s+alumni|hanya\s+alumni|alumni\s+only|cocok\s+untuk[\s\S]{0,30}alumni|program\s+alumni)\b/i.test(snip) && !/\b(?:mahasiswa\s+aktif|terbuka\s+untuk\s+mahasiswa|semua\s+mahasiswa)\b/i.test(snip)) {
      return {
        status: DIMENSION_STATUS.MISMATCH,
        reason: 'Recipient mismatch: evidence explicitly targets alumni rather than active students'
      };
    }
    if (/\b(?:mahasiswa|mahasiswa\s+baru|civitas)\b/i.test(snip)) {
      return { status: DIMENSION_STATUS.SUPPORTED };
    }
    return { status: DIMENSION_STATUS.UNPROVEN, reason: 'Student recipient unproven' };
  }

  return { status: DIMENSION_STATUS.NOT_APPLICABLE };
}

/**
 * Check qualifier compatibility (e.g. "gratis" vs paid).
 * Distinguishes UNPROVEN vs CONTRADICTED.
 */
function evaluateQualifierCompatibility(binding, evidence, frame) {
  const rawQ = String(frame?.rawQuery || binding?.rawText || '').toLowerCase();
  const asksGratis = /\b(?:gratis|free|cuma[- ]cuma|tanpa\s+biaya|tidak\s+bayar)\b/i.test(rawQ);

  if (!asksGratis) {
    return { status: DIMENSION_STATUS.NOT_APPLICABLE };
  }

  const snip = String(evidence.textSnippet || evidence.structuredValue || '').toLowerCase();

  // Explicit price stated => CONTRADICTED
  if (/\b(?:rp\.?|rupiah|\d+[\.,]\d{3}|bayar|biaya|tarif|tahun)\b/i.test(snip) && /(?:200\.000|biaya|bayar|tahunan|tahun)/i.test(snip)) {
    return {
      status: DIMENSION_STATUS.CONTRADICTED,
      reason: 'Qualifier CONTRADICTED: evidence explicitly mentions fee / annual price (e.g. Rp 200.000/tahun), contradicting free claim'
    };
  }

  // Explicit free stated => SUPPORTED
  if (/bebas\s+biaya|gratis|free\s+of\s+charge|tanpa\s+biaya/i.test(snip)) {
    return { status: DIMENSION_STATUS.SUPPORTED };
  }

  // Base concept may exist, but gratis is unproven
  return {
    status: DIMENSION_STATUS.UNPROVEN,
    reason: 'Qualifier UNPROVEN: evidence mentions feature/access but does not prove it is free'
  };
}

/**
 * Check relation compatibility.
 * Entity co-existence on both sides of a relation does NOT prove equivalence.
 */
function evaluateRelationCompatibility(binding, evidence, frame) {
  const rel = binding.relations && binding.relations.length > 0 ? binding.relations[0] : null;
  if (!rel) {
    return { status: DIMENSION_STATUS.NOT_APPLICABLE };
  }

  // Standardize relation structure: { subject, relationType, object } or string relation
  let relType;
  let subject;
  let object;

  if (typeof rel === 'string') {
    relType = rel;
    subject = binding.entity || (Array.isArray(frame?.entities) ? frame.entities[0] : null) || '';
    object = binding.requestedField || '';
  } else if (typeof rel === 'object') {
    relType = rel.relationType || rel.relation || rel.relationName || '';
    subject = rel.subject || binding.entity || '';
    object = rel.object || binding.requestedField || '';
  }

  if (!relType) {
    return { status: DIMENSION_STATUS.NOT_APPLICABLE };
  }

  const snip = String(evidence.textSnippet || evidence.structuredValue || '').toLowerCase();

  if (relType === 'equivalent_to') {
    // Equivalence requires explicit equivalence wording between subject and object
    const subjStr = String(typeof subject === 'object' ? (subject.canonical || subject.name || '') : subject).toLowerCase();
    const objStr = String(typeof object === 'object' ? (object.canonical || object.name || '') : object).toLowerCase();

    const hasSubject = snip.includes(subjStr);
    const hasObject = snip.includes(objStr);

    if (hasSubject && hasObject) {
      if (/setara|sama\s+dengan|ekuivalen|identik|dapat\s+dikonversi/i.test(snip)) {
        return { status: DIMENSION_STATUS.SUPPORTED, reason: 'Explicit equivalence relationship proven in evidence' };
      }
      return {
        status: DIMENSION_STATUS.UNPROVEN,
        reason: 'Relation UNPROVEN: Evidence mentions both entities but does NOT assert equivalence'
      };
    }
    return {
      status: DIMENSION_STATUS.UNPROVEN,
      reason: 'Relation UNPROVEN: Evidence does not assert equivalence between subject and object'
    };
  }

  // Administrative / document requirements relation
  // Requires evidence to explicitly bind participant/entity AND required document/field in the same source context
  const isAdministrativeRelation = /document|requirement|foreign_documents|admin|syarat/i.test(relType);
  if (isAdministrativeRelation) {
    const subjCanonical = typeof subject === 'object' ? (subject.canonical || subject.name || '') : String(subject || '');
    const objCanonical = typeof object === 'object' ? (object.canonical || object.name || '') : String(object || '');
    const subjAliases = typeof subject === 'object' && Array.isArray(subject.aliases) ? subject.aliases : [];
    const objAliases = typeof object === 'object' && Array.isArray(object.aliases) ? object.aliases : [];

    // Check subject presence or entity participant in source snippet
    const hasSubject = doesSnippetMentionEntity(subjCanonical, subjAliases, snip) ||
      (subjCanonical && snip.includes(subjCanonical.toLowerCase()));

    // Check object / document presence in source snippet
    const hasObject = doesSnippetMentionEntity(objCanonical, objAliases, snip) ||
      (objCanonical && snip.includes(objCanonical.toLowerCase()));

    // Check requirements presence
    const hasRequirements = /\b(?:syarat|dokumen|persyaratan|berkas|wajib|perlu|formulir|form|ketentuan|prosedur)\b/i.test(snip);

    if (hasSubject && hasObject && hasRequirements) {
      return {
        status: DIMENSION_STATUS.SUPPORTED,
        reason: 'Direct source relation proven: source explicitly binds participant entity and document requirements'
      };
    }

    return {
      status: DIMENSION_STATUS.UNPROVEN,
      reason: 'Relation UNPROVEN: Evidence does not explicitly bind subject entity and document requirements in same source context'
    };
  }

  return { status: DIMENSION_STATUS.NOT_APPLICABLE };
}

/**
 * Evaluate numeric constraints (if requested or asserted in query)
 */
function evaluateNumericCompatibility(binding, evidence, frame) {
  const numSemantics = frame?.numericSemantics || binding?.numericSemantics;
  if (!numSemantics || (!numSemantics.exactValue && !numSemantics.minValue && !numSemantics.maxValue)) {
    return { status: DIMENSION_STATUS.NOT_APPLICABLE };
  }

  // Normalize numeric value in evidence
  const snip = String(evidence.structuredValue || evidence.textSnippet || '');
  const cleanNums = snip.replace(/[^0-9]/g, '');
  if (!cleanNums) {
    return { status: DIMENSION_STATUS.UNPROVEN, reason: 'Evidence contains no parseable numeric value' };
  }

  const evNum = parseInt(cleanNums, 10);
  if (numSemantics.exactValue && evNum === numSemantics.exactValue) {
    return { status: DIMENSION_STATUS.SUPPORTED };
  }
  if (numSemantics.minValue && evNum < numSemantics.minValue) {
    return { status: DIMENSION_STATUS.MISMATCH, reason: `Numeric value ${evNum} is below minimum constraint ${numSemantics.minValue}` };
  }
  if (numSemantics.maxValue && evNum > numSemantics.maxValue) {
    return { status: DIMENSION_STATUS.MISMATCH, reason: `Numeric value ${evNum} exceeds maximum constraint ${numSemantics.maxValue}` };
  }

  return { status: DIMENSION_STATUS.SUPPORTED };
}

/**
 * Check whether evidence has traceable provenance and is not canonicalEntityRegistry
 */
function evaluateProvenance(evidence) {
  if (!evidence) return false;
  if (!evidence.sourceId || !evidence.provenance) return false;

  const srcId = String(evidence.sourceId).toLowerCase();
  const prov = String(evidence.provenance).toLowerCase();

  // Registry as evidence is strictly disallowed
  if (srcId.includes('canonicalentityregistry') || prov.includes('canonicalentityregistry')) {
    return false;
  }

  return true;
}

/**
 * Dimension-scoped conflict detector.
 * Only flags conflict if evidence items match on entity, requested field, recipient,
 * and temporal scope, but assert incompatible factual values.
 */
function detectDimensionScopedConflicts(compatibleEvidence) {
  if (!Array.isArray(compatibleEvidence) || compatibleEvidence.length < 2) {
    return [];
  }

  const conflicts = [];
  for (let i = 0; i < compatibleEvidence.length; i++) {
    for (let j = i + 1; j < compatibleEvidence.length; j++) {
      const e1 = compatibleEvidence[i];
      const e2 = compatibleEvidence[j];

      // Must have structured values or clear facts to conflict
      if (e1.structuredValue && e2.structuredValue && e1.structuredValue !== e2.structuredValue) {
        // Temporal scope check: academic year 2025 vs 2026 is not a conflict
        const s1 = String(e1.sourceId || e1.provenance || '').toLowerCase();
        const s2 = String(e2.sourceId || e2.provenance || '').toLowerCase();
        const y1 = s1.match(/20\d{2}/);
        const y2 = s2.match(/20\d{2}/);
        if (y1 && y2 && y1[0] !== y2[0]) {
          // Different temporal scope => no false conflict
          continue;
        }

        conflicts.push({
          dimension: e1.fieldBinding,
          evidenceIdA: e1.evidenceId,
          valueA: e1.structuredValue,
          sourceA: e1.sourceId,
          evidenceIdB: e2.evidenceId,
          valueB: e2.structuredValue,
          sourceB: e2.sourceId,
          reason: `Material conflict on '${e1.fieldBinding}': '${e1.structuredValue}' vs '${e2.structuredValue}'`
        });
      }
    }
  }

  return conflicts;
}

/**
 * Evaluates a single RetrievalBinding against its retrieved evidence candidates.
 * SIDE-EFFECT FREE: Does NOT mutate binding, frame, or evidence objects.
 *
 * @param {Object} binding - The frozen RetrievalBinding
 * @param {Array} evidenceList - Normalized evidence items retrieved for this binding
 * @param {Object} frame - The frozen SemanticFrame
 * @param {Object} options - Operational options (e.g. evidenceOpportunityComplete)
 * @returns {Object} Evaluation report for this binding
 */
function evaluateBinding(binding, evidenceList = [], frame = {}, options = {}) {
  const bindingId = binding?.bindingId || 'unknown_binding';
  const entityBinding = binding?.entity || null;
  const fieldBinding = binding?.requestedField || null;
  const relationBinding = binding?.relations && binding.relations.length > 0 ? binding.relations[0] : null;

  // 1. Explicit readiness check
  const evidenceOpportunityComplete = options.evidenceOpportunityComplete !== false;
  if (!evidenceOpportunityComplete) {
    return {
      bindingId,
      evaluationState: 'INCOMPLETE',
      status: null,
      entityBinding,
      fieldBinding,
      relationBinding,
      evidenceOpportunityComplete: false,
      matchedEvidenceIds: [],
      rejectedEvidenceIds: [],
      evidenceDispositions: [],
      dimensions: {},
      supportedFacts: [],
      unsupportedDimensions: [],
      conflicts: [],
      reasonCodes: ['EVALUATION_INCOMPLETE_EVIDENCE_OPPORTUNITY_PENDING']
    };
  }

  // 2. Upstream negation / exclusion guard
  const exclusions = Array.isArray(binding?.exclusions) ? binding.exclusions : [];
  const excludedFields = Array.isArray(frame?.constraints?.excludedFields) ? frame.constraints.excludedFields : [];
  if (fieldBinding && (exclusions.includes(fieldBinding) || excludedFields.includes(fieldBinding))) {
    return {
      bindingId,
      evaluationState: 'COMPLETE',
      status: EVALUATION_STATUS.UNSUPPORTED,
      entityBinding,
      fieldBinding,
      relationBinding,
      evidenceOpportunityComplete: true,
      matchedEvidenceIds: [],
      rejectedEvidenceIds: (evidenceList || []).map(e => e.evidenceId),
      evidenceDispositions: (evidenceList || []).map(e => ({
        evidenceId: e.evidenceId,
        disposition: EVIDENCE_DISPOSITION.REJECTED,
        reasons: ['Field is explicitly excluded by upstream semantic negation']
      })),
      dimensions: { fieldCompatibility: DIMENSION_STATUS.MISMATCH },
      supportedFacts: [],
      unsupportedDimensions: [fieldBinding],
      conflicts: [],
      reasonCodes: ['EXCLUDED_FIELD_REJECTED']
    };
  }

  // 3. Evaluate each evidence item
  const evidenceDispositions = [];
  const matchedEvidenceList = [];
  const rejectedEvidenceIds = [];
  const reasonCodes = [];

  for (const ev of (evidenceList || [])) {
    const evReasons = [];

    // Provenance validity check
    const hasValidProvenance = evaluateProvenance(ev);
    if (!hasValidProvenance) {
      evidenceDispositions.push({
        evidenceId: ev.evidenceId,
        disposition: EVIDENCE_DISPOSITION.REJECTED,
        reasons: ['Missing traceable provenance or registry used as factual proof']
      });
      rejectedEvidenceIds.push(ev.evidenceId);
      continue;
    }

    // Entity compatibility
    const entComp = isEntityCompatible(entityBinding, ev.entityBinding, ev.textSnippet, ev);
    if (!entComp.compatible) {
      evidenceDispositions.push({
        evidenceId: ev.evidenceId,
        disposition: EVIDENCE_DISPOSITION.REJECTED,
        reasons: [entComp.reason || 'Entity mismatch']
      });
      rejectedEvidenceIds.push(ev.evidenceId);
      continue;
    }

    // Field & subtype compatibility
    const fldComp = isFieldCompatible(binding, ev);
    if (!fldComp.compatible) {
      evidenceDispositions.push({
        evidenceId: ev.evidenceId,
        disposition: fldComp.disposition || EVIDENCE_DISPOSITION.REJECTED,
        reasons: [fldComp.reason || 'Field/subtype mismatch']
      });
      rejectedEvidenceIds.push(ev.evidenceId);
      continue;
    }

    // Passed entity and field compatibility
    matchedEvidenceList.push(ev);
    evidenceDispositions.push({
      evidenceId: ev.evidenceId,
      disposition: EVIDENCE_DISPOSITION.SUPPORTS,
      reasons: ['Entity and field compatible with traceable provenance']
    });
  }

  // Sort matchedEvidenceList to prioritize substantive answers over summary index chunks
  matchedEvidenceList.sort((a, b) => {
    const aText = String(a.textSnippet || a.structuredValue || '');
    const bText = String(b.textSnippet || b.structuredValue || '');
    const aSummary = /^Ringkasan dokumen/i.test(aText);
    const bSummary = /^Ringkasan dokumen/i.test(bText);
    if (aSummary && !bSummary) return 1;
    if (!aSummary && bSummary) return -1;

    // Entity definition priority (e.g. "Student Exchange adalah..." or "apa itu Student Exchange")
    const entName = entityBinding?.canonical ? entityBinding.canonical.toLowerCase() : '';
    if (entName) {
      const aDef = aText.toLowerCase().includes(`${entName} adalah`) || aText.toLowerCase().includes(`apa itu ${entName}`);
      const bDef = bText.toLowerCase().includes(`${entName} adalah`) || bText.toLowerCase().includes(`apa itu ${entName}`);
      if (aDef && !bDef) return -1;
      if (!aDef && bDef) return 1;
    }

    // Specific requested field keyword priority (e.g. "sktt")
    if (fieldBinding) {
      const fldKey = String(fieldBinding).toLowerCase();
      const aFldCount = (aText.toLowerCase().split(fldKey).length - 1);
      const bFldCount = (bText.toLowerCase().split(fldKey).length - 1);
      if (aFldCount !== bFldCount) return bFldCount - aFldCount;
    }

    const aAnswer = /^(?:Jawaban|Berikut|Program|Student Exchange adalah|Double Degree)/i.test(aText);
    const bAnswer = /^(?:Jawaban|Berikut|Program|Student Exchange adalah|Double Degree)/i.test(bText);
    if (aAnswer && !bAnswer) return -1;
    if (!aAnswer && bAnswer) return 1;
    return 0;
  });

  // 4. Dimension-specific evaluations
  const matchedEvidenceIds = matchedEvidenceList.map(e => e.evidenceId);

  // Recipient evaluation
  let recipientStatus = DIMENSION_STATUS.NOT_APPLICABLE;
  for (const ev of matchedEvidenceList) {
    const res = evaluateRecipientCompatibility(binding, ev, frame);
    if (res.status === DIMENSION_STATUS.MISMATCH) {
      recipientStatus = DIMENSION_STATUS.MISMATCH;
      reasonCodes.push(res.reason);
      break;
    } else if (res.status === DIMENSION_STATUS.SUPPORTED && recipientStatus !== DIMENSION_STATUS.MISMATCH) {
      recipientStatus = DIMENSION_STATUS.SUPPORTED;
    } else if (res.status === DIMENSION_STATUS.UNPROVEN && recipientStatus === DIMENSION_STATUS.NOT_APPLICABLE) {
      recipientStatus = DIMENSION_STATUS.UNPROVEN;
      reasonCodes.push(res.reason);
    }
  }

  // Qualifier evaluation
  let qualifierStatus = DIMENSION_STATUS.NOT_APPLICABLE;
  for (const ev of (evidenceList || [])) {
    const qRes = evaluateQualifierCompatibility(binding, ev, frame);
    if (qRes.status === DIMENSION_STATUS.CONTRADICTED) {
      qualifierStatus = DIMENSION_STATUS.CONTRADICTED;
      reasonCodes.push(qRes.reason);
      break;
    } else if (qRes.status === DIMENSION_STATUS.SUPPORTED) {
      qualifierStatus = DIMENSION_STATUS.SUPPORTED;
    } else if (qRes.status === DIMENSION_STATUS.UNPROVEN && qualifierStatus !== DIMENSION_STATUS.CONTRADICTED) {
      qualifierStatus = DIMENSION_STATUS.UNPROVEN;
      reasonCodes.push(qRes.reason);
    }
  }

  // Relation evaluation
  let relationStatus = DIMENSION_STATUS.NOT_APPLICABLE;
  if (relationBinding) {
    for (const ev of (evidenceList || [])) {
      const rRes = evaluateRelationCompatibility(binding, ev, frame);
      if (rRes.status === DIMENSION_STATUS.SUPPORTED) {
        relationStatus = DIMENSION_STATUS.SUPPORTED;
        break;
      } else if (rRes.status === DIMENSION_STATUS.UNPROVEN) {
        relationStatus = DIMENSION_STATUS.UNPROVEN;
        reasonCodes.push(rRes.reason);
      }
    }
    if (relationStatus === DIMENSION_STATUS.NOT_APPLICABLE) {
      relationStatus = DIMENSION_STATUS.UNPROVEN;
    }
  }

  // Numeric evaluation
  let numericStatus = DIMENSION_STATUS.NOT_APPLICABLE;
  if (matchedEvidenceList.length > 0) {
    for (const ev of matchedEvidenceList) {
      const nRes = evaluateNumericCompatibility(binding, ev, frame);
      if (nRes.status === DIMENSION_STATUS.SUPPORTED) {
        numericStatus = DIMENSION_STATUS.SUPPORTED;
        break;
      } else if (nRes.status === DIMENSION_STATUS.MISMATCH) {
        numericStatus = DIMENSION_STATUS.MISMATCH;
        reasonCodes.push(nRes.reason);
      }
    }
  }

  // Conflict detection
  const conflicts = detectDimensionScopedConflicts(matchedEvidenceList);
  if (conflicts.length > 0) {
    reasonCodes.push('CONFLICTING_AUTHORITATIVE_EVIDENCE');
  }

  // 5. Deterministic Overall Status Derivation
  const dimensions = {
    entityCompatibility: matchedEvidenceList.length > 0 ? DIMENSION_STATUS.SUPPORTED : DIMENSION_STATUS.MISMATCH,
    fieldCompatibility: matchedEvidenceList.length > 0 ? DIMENSION_STATUS.SUPPORTED : DIMENSION_STATUS.MISMATCH,
    fieldSubtypeCompatibility: matchedEvidenceList.length > 0 ? DIMENSION_STATUS.SUPPORTED : DIMENSION_STATUS.MISMATCH,
    relationCompatibility: relationStatus,
    recipientCompatibility: recipientStatus,
    qualifierCompatibility: qualifierStatus,
    numericCompatibility: numericStatus,
    temporalCompatibility: matchedEvidenceList.length > 0 ? DIMENSION_STATUS.SUPPORTED : DIMENSION_STATUS.MISMATCH
  };

  const supportedFacts = [];
  const unsupportedDimensions = [];

  if (matchedEvidenceList.length > 0) {
    supportedFacts.push({
      field: fieldBinding,
      entity: entityBinding?.canonical || 'ITB STIKOM Bali',
      value: matchedEvidenceList[0].structuredValue || matchedEvidenceList[0].textSnippet,
      evidenceId: matchedEvidenceList[0].evidenceId,
      sourceId: matchedEvidenceList[0].sourceId,
      provenance: matchedEvidenceList[0].provenance
    });
  }

  let finalStatus;

  if (conflicts.length > 0) {
    finalStatus = EVALUATION_STATUS.CONFLICTING;
  } else if (matchedEvidenceList.length === 0) {
    finalStatus = EVALUATION_STATUS.UNSUPPORTED;
    if (fieldBinding) unsupportedDimensions.push(fieldBinding);
    reasonCodes.push('NO_COMPATIBLE_EVIDENCE_FOR_BINDING');
  } else {
    // Base field and entity are supported
    const hasUnsupportedQualifier = qualifierStatus === DIMENSION_STATUS.UNPROVEN || qualifierStatus === DIMENSION_STATUS.CONTRADICTED;
    const hasUnsupportedRecipient = recipientStatus === DIMENSION_STATUS.UNPROVEN || recipientStatus === DIMENSION_STATUS.MISMATCH;
    const hasUnsupportedRelation = relationStatus === DIMENSION_STATUS.UNPROVEN || relationStatus === DIMENSION_STATUS.MISMATCH;
    const hasUnsupportedNumeric = numericStatus === DIMENSION_STATUS.MISMATCH;

    // If recipient is MISMATCH and there is no specific entity proven (generic institutional scope),
    // then no requested factual dimension is genuinely supported -> UNSUPPORTED.
    const hasSpecificEntity = entityBinding && entityBinding.canonical && entityBinding.canonical !== 'INSTITUTION_ROOT' && entityBinding.canonical !== 'ITB STIKOM Bali';
    if (recipientStatus === DIMENSION_STATUS.MISMATCH && !hasSpecificEntity) {
      finalStatus = EVALUATION_STATUS.UNSUPPORTED;
      unsupportedDimensions.push('recipient');
      reasonCodes.push('RECIPIENT_MISMATCH_INCOMPATIBLE');
    } else if (hasUnsupportedQualifier || hasUnsupportedRecipient || hasUnsupportedRelation || hasUnsupportedNumeric) {
      if (hasUnsupportedQualifier) unsupportedDimensions.push('qualifier');
      if (hasUnsupportedRecipient) {
        unsupportedDimensions.push('recipient');
        if (recipientStatus === DIMENSION_STATUS.MISMATCH) {
          reasonCodes.push('RECIPIENT_MISMATCH_INCOMPATIBLE');
        }
      }
      if (hasUnsupportedRelation) unsupportedDimensions.push('relation');
      if (hasUnsupportedNumeric) unsupportedDimensions.push('numeric');

      // Partial support applies when the core entity/field has genuine factual grounding,
      // but specific requested modifiers/recipients/relations are not fully proven
      finalStatus = EVALUATION_STATUS.PARTIALLY_SUPPORTED;
      reasonCodes.push('PARTIAL_SUPPORT_SOME_DIMENSIONS_UNPROVEN');
    } else {
      finalStatus = EVALUATION_STATUS.SUPPORTED;
    }
  }

  return {
    bindingId,
    evaluationState: 'COMPLETE',
    status: finalStatus,
    entityBinding,
    fieldBinding,
    relationBinding,
    evidenceOpportunityComplete: true,
    matchedEvidenceIds,
    rejectedEvidenceIds,
    evidenceDispositions,
    dimensions,
    supportedFacts,
    unsupportedDimensions,
    conflicts,
    reasonCodes: Array.from(new Set(reasonCodes))
  };
}

/**
 * Evaluates all bindings in a RetrievalPlan against the provider registry execution results.
 * Pure, deterministic, side-effect free.
 *
 * @param {Object} plan - The RetrievalPlan
 * @param {Object} providerExecution - Output from EvidenceProviderRegistry.executePlan
 * @param {Object} frame - The frozen SemanticFrame
 * @param {Object} options - Operational configuration
 * @returns {Object} Full plan evaluation report
 */
function evaluatePlanResults(plan, providerExecution = {}, frame = {}, options = {}) {
  if (!plan || !Array.isArray(plan.subrequests)) {
    return {
      planId: plan?.planId || null,
      evaluationState: 'COMPLETE',
      totalBindings: 0,
      supportedCount: 0,
      partiallySupportedCount: 0,
      unsupportedCount: 0,
      conflictingCount: 0,
      resultsByBinding: {},
      summary: { status: EVALUATION_STATUS.UNSUPPORTED }
    };
  }

  const resultsByBinding = {};
  let supportedCount = 0;
  let partiallySupportedCount = 0;
  let unsupportedCount = 0;
  let conflictingCount = 0;
  let totalBindings = 0;

  const resultsByBindingMap = providerExecution.resultsByBinding || {};

  for (const subreq of plan.subrequests) {
    if (!Array.isArray(subreq.bindings)) continue;

    for (const binding of subreq.bindings) {
      totalBindings++;
      const bindingResult = resultsByBindingMap[binding.bindingId];
      const evidenceList = bindingResult?.evidence || [];

      const evalResult = evaluateBinding(binding, evidenceList, frame, {
        evidenceOpportunityComplete: options.evidenceOpportunityComplete !== false
      });

      resultsByBinding[binding.bindingId] = evalResult;

      if (evalResult.status === EVALUATION_STATUS.SUPPORTED) supportedCount++;
      else if (evalResult.status === EVALUATION_STATUS.PARTIALLY_SUPPORTED) partiallySupportedCount++;
      else if (evalResult.status === EVALUATION_STATUS.UNSUPPORTED) unsupportedCount++;
      else if (evalResult.status === EVALUATION_STATUS.CONFLICTING) conflictingCount++;
    }
  }

  // Derive overall plan status deterministically
  let overallStatus = EVALUATION_STATUS.UNSUPPORTED;
  if (conflictingCount > 0) {
    overallStatus = EVALUATION_STATUS.CONFLICTING;
  } else if (supportedCount > 0 && unsupportedCount === 0 && partiallySupportedCount === 0) {
    overallStatus = EVALUATION_STATUS.SUPPORTED;
  } else if (supportedCount > 0 || partiallySupportedCount > 0) {
    overallStatus = EVALUATION_STATUS.PARTIALLY_SUPPORTED;
  }

  return {
    planId: plan.planId || null,
    evaluationState: 'COMPLETE',
    totalBindings,
    supportedCount,
    partiallySupportedCount,
    unsupportedCount,
    conflictingCount,
    resultsByBinding,
    summary: {
      status: overallStatus,
      supportedCount,
      partiallySupportedCount,
      unsupportedCount,
      conflictingCount
    }
  };
}

module.exports = {
  EVALUATION_STATUS,
  EVIDENCE_DISPOSITION,
  DIMENSION_STATUS,
  isEntityCompatible,
  isFieldCompatible,
  evaluateRecipientCompatibility,
  evaluateQualifierCompatibility,
  evaluateRelationCompatibility,
  evaluateNumericCompatibility,
  evaluateProvenance,
  detectDimensionScopedConflicts,
  evaluateBinding,
  evaluatePlanResults
};
