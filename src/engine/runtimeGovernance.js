const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const ensuredRuntimeTables = new Set();
const failedRuntimeTables = new Map();
let ragTracePersistFailureUntil = 0;

function numberEnv(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

function envExplicitlySet(name) {
  return process.env[name] !== undefined && process.env[name] !== null && String(process.env[name]).trim() !== '';
}

function withTimeout(promise, timeoutMs, timeoutValue) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeoutId;
  return Promise.race([
    promise.finally(() => { if (timeoutId) clearTimeout(timeoutId); }),
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(timeoutValue), timeoutMs);
    })
  ]);
}

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (!v) return defaultValue;
  return v === 'true' || v === '1' || v === 'yes' || v === 'y' || v === 'on';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function clamp(value, max = 500) {
  const s = String(value || '');
  return s.length > max ? s.slice(0, max) : s;
}

function safeWarn(meta, message) {
  try {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(meta, message);
      return;
    }
  } catch (_) {}
  try {
    console.warn(message, meta);
  } catch (_) {}
}

const AUTHORITY_TIERS = {
  tier_1_official_decree: { tier: 1, weight: 100, label: 'SK Rektor / Regulasi Formal' },
  tier_2_official_announcement: { tier: 2, weight: 80, label: 'Pengumuman Resmi BAAK / PMB / Kalender' },
  tier_3_curriculum_guideline: { tier: 3, weight: 60, label: 'Pedoman Akademik / Kurikulum / Brosur' },
  tier_4_supporting_doc: { tier: 4, weight: 40, label: 'Profil Unit / UKM / Dokumen Pendukung' },
  tier_unknown: { tier: 99, weight: 0, label: 'Dokumen Tanpa Otoritas Terverifikasi' }
};

function normalizeStatus(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return 'validity_unknown';
  }
  const status = String(value).trim().toLowerCase();
  if (['approved', 'active', 'published', 'valid'].includes(status)) return 'active';
  if (['superseded', 'replaced'].includes(status)) return 'superseded';
  if (['expired', 'inactive', 'obsolete'].includes(status)) return 'expired';
  if (['archived', 'archive', 'historical'].includes(status)) return 'archived';
  if (['draft', 'pending', 'review', 'template'].includes(status)) return 'draft';
  if (['rejected', 'blocked'].includes(status)) return 'rejected';
  if (['validity_unknown', 'unknown', 'unverified'].includes(status)) return 'validity_unknown';
  return 'validity_unknown';
}

function normalizeAuthority(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return 'tier_unknown';
  }
  const val = String(value).trim().toLowerCase();
  if (val === '1' || val === 'tier_1' || /^(tier_?1|decree|sk|rektor|regulasi|formal_policy|academic_policy)/i.test(val)) {
    return 'tier_1_official_decree';
  }
  if (val === '2' || val === 'tier_2' || /^(tier_?2|announcement|pengumuman|edaran|calendar|kalender|academic_announcement|academic_calendar)/i.test(val)) {
    return 'tier_2_official_announcement';
  }
  if (val === '3' || val === 'tier_3' || /^(tier_?3|guideline|pedoman|kurikulum|curriculum|handbook|brochure|academic_handbook)/i.test(val)) {
    return 'tier_3_curriculum_guideline';
  }
  if (val === '4' || val === 'tier_4' || /^(tier_?4|supporting|profile|profil|ukm|ormawa|general_profile|faq|template)/i.test(val)) {
    return 'tier_4_supporting_doc';
  }
  return 'tier_unknown';
}

function getAuthorityTier(value) {
  const code = normalizeAuthority(value);
  const meta = AUTHORITY_TIERS[code] || AUTHORITY_TIERS.tier_unknown;
  return { code, ...meta };
}

function compareAuthority(authA, authB) {
  const tierA = getAuthorityTier(authA);
  const tierB = getAuthorityTier(authB);
  return tierA.weight - tierB.weight;
}

function validateDocumentNaming(filenameOrTitle) {
  if (!filenameOrTitle || typeof filenameOrTitle !== 'string') {
    return { valid: false, error: 'Nama dokumen wajib diisi.' };
  }
  const trimmed = filenameOrTitle.trim();
  if (trimmed.length < 3) {
    return { valid: false, error: 'Nama dokumen terlalu pendek (minimal 3 karakter).' };
  }
  if (trimmed.length > 255) {
    return { valid: false, error: 'Nama dokumen terlalu panjang (maksimal 255 karakter).' };
  }

  // Preserve logical titles with slashes (e.g. "SK 629/2025" or "Yudisium 2026/2027")
  // Only extract basename if it looks like an actual file path
  const looksLikePath = /^[a-zA-Z]:[\\/]|^[\\/]|\.\.[\\/]/.test(trimmed);
  const baseName = looksLikePath ? path.basename(trimmed) : trimmed;

  const knownExtensions = new Set([
    '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.txt',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'
  ]);
  const rawExt = path.extname(baseName).toLowerCase();
  const hasKnownExt = knownExtensions.has(rawExt);
  const ext = hasKnownExt ? rawExt : '';
  const nameWithoutExt = ext ? baseName.slice(0, -ext.length).trim() : baseName.trim();

  if (baseName.startsWith('.') && (!baseName.includes('.', 1) || nameWithoutExt.startsWith('.'))) {
    return { valid: false, error: 'Nama dokumen tidak boleh hanya berupa ekstensi file.' };
  }

  if (!nameWithoutExt || nameWithoutExt.length < 2) {
    return { valid: false, error: 'Nama dokumen tidak boleh hanya berupa ekstensi file.' };
  }

  // Block dangerous or forbidden characters
  if (/[<>|?*\x00-\x1f]/.test(baseName)) {
    return { valid: false, error: 'Nama dokumen mengandung karakter yang tidak diizinkan (<, >, |, ?, *).' };
  }
  // For file names without spaces (likely physical file paths), also block colons and quotes
  if (!baseName.includes(' ') && /[<>:"|?*]/.test(baseName)) {
    return { valid: false, error: 'Nama dokumen mengandung karakter yang tidak diizinkan (<, >, :, ", |, ?, *).' };
  }

  const lowerName = nameWithoutExt.toLowerCase().replace(/[\s_\-\.\/]+/g, ' ').trim();
  const ambiguousExactNames = new Set([
    'test', 'testing', 'test1', 'test2', 'coba', 'percobaan',
    'dokumen', 'dokumen baru', 'dokumen baru 1', 'dokumen 1', 'dokumen_baru',
    'document', 'new document', 'new doc', 'doc', 'doc1',
    'file', 'file baru', 'new file', 'untitled', 'untitled document',
    'baru', 'contoh', 'sample', 'dummy', 'temp', 'temporary',
    'asdf', 'qwerty', '123', '1234', '12345', 'aaa', 'bbb',
    'data', 'data baru', 'input', 'teks', 'text'
  ]);

  if (ambiguousExactNames.has(lowerName)) {
    return {
      valid: false,
      error: `Nama dokumen '${baseName}' terlalu ambigu atau tidak informatif. Gunakan nama deskriptif yang mencerminkan isi dokumen (misal: 'SK_Biaya_Kuliah_2026.pdf', 'Jadwal_Yudisium_Genap_2026.pdf', atau 'Pedoman_Akademik_S1.pdf').`
    };
  }

  if (/^\d+$/.test(lowerName) || /^([a-z])\1+$/.test(lowerName)) {
    return {
      valid: false,
      error: `Nama dokumen '${baseName}' tidak informatif. Gunakan nama yang mencerminkan subjek atau topik dokumen.`
    };
  }

  return { valid: true, sanitizedName: baseName, nameWithoutExt, ext };
}

function validateDocumentValidityDates(validFrom, validUntil, options = {}) {
  let parsedFrom = null;
  let parsedUntil = null;

  const requireValidFrom = options.requireValidFrom !== undefined ? Boolean(options.requireValidFrom) : false;
  const requireValidUntil = options.requireValidUntil !== undefined ? Boolean(options.requireValidUntil) : false;
  const noExpiryFlag = Boolean(
    options.noExpiry === true ||
    options.noExpiry === 'true' ||
    options.noExpiry === 1 ||
    options.noExpiry === '1'
  );

  // 1. Validate validFrom
  if (validFrom !== undefined && validFrom !== null && String(validFrom).trim() !== '') {
    const fromDate = new Date(validFrom);
    if (isNaN(fromDate.getTime())) {
      return { valid: false, error: "Tanggal mulai berlaku ('validFrom') harus berupa format tanggal yang valid (contoh: YYYY-MM-DD).", field: 'validFrom' };
    }
    parsedFrom = fromDate.toISOString();
  } else if (requireValidFrom) {
    return { valid: false, error: "Tanggal mulai berlaku ('validFrom') wajib diisi.", field: 'validFrom' };
  }

  // 2. Validate validUntil
  const rawUntilStr = validUntil !== undefined && validUntil !== null ? String(validUntil).trim().toLowerCase() : '';
  const isExplicitIndefinite = noExpiryFlag || ['none', 'null', 'tidak_ada', 'tidak ada', 'berlaku_sampai_dicabut', 'sampai_dicabut'].includes(rawUntilStr);

  if (isExplicitIndefinite) {
    parsedUntil = null; // null represents indefinite / berlaku sampai dicabut
  } else if (rawUntilStr !== '') {
    const untilDate = new Date(validUntil);
    if (isNaN(untilDate.getTime())) {
      return { valid: false, error: "Tanggal expired ('validUntil') harus berupa format tanggal yang valid (contoh: YYYY-MM-DD).", field: 'validUntil' };
    }
    parsedUntil = untilDate.toISOString();
  } else if (requireValidUntil) {
    return { valid: false, error: "Tanggal expired ('validUntil') wajib diisi, atau pilih opsi 'Berlaku sampai dicabut'.", field: 'validUntil' };
  }

  // 3. Consistency check: validUntil must not be earlier than validFrom
  if (parsedFrom && parsedUntil) {
    const fromMs = new Date(parsedFrom).getTime();
    const untilMs = new Date(parsedUntil).getTime();
    if (untilMs < fromMs) {
      return {
        valid: false,
        error: "Tanggal expired ('validUntil') tidak boleh lebih awal dari tanggal mulai berlaku ('validFrom').",
        field: 'validUntil'
      };
    }
  }

  return {
    valid: true,
    validFrom: parsedFrom,
    validUntil: parsedUntil // null represents indefinite / berlaku sampai dicabut
  };
}

function validateDocumentIntakeGovernance(payload = {}, options = {}) {
  if (payload.documentTitle !== undefined && String(payload.documentTitle).trim() === '') {
    return { valid: false, error: "Nama / Judul Dokumen ('documentTitle') wajib diisi.", field: 'documentTitle' };
  }
  if (options.requireDocumentTitle && !String(payload.documentTitle || payload.title || '').trim()) {
    return { valid: false, error: "Nama / Judul Dokumen ('documentTitle') wajib diisi.", field: 'documentTitle' };
  }

  const isExplicitTitleProvided = Boolean(payload.documentTitle || payload.title);
  const name = payload.documentTitle || payload.title || payload.filename || payload.name;
  const nameResult = validateDocumentNaming(name);
  if (!nameResult.valid) {
    return { valid: false, error: nameResult.error, field: isExplicitTitleProvided ? 'documentTitle' : 'filename' };
  }

  const noExpiry = Boolean(
    payload.noExpiry === true ||
    payload.noExpiry === 'true' ||
    payload.noExpiry === 1 ||
    payload.noExpiry === '1' ||
    payload.isIndefinite === true
  );

  const requireValidFrom = options.requireValidFrom !== undefined ? Boolean(options.requireValidFrom) : true;
  const requireValidUntil = options.requireValidUntil !== undefined ? Boolean(options.requireValidUntil) : !noExpiry;

  const dateResult = validateDocumentValidityDates(payload.validFrom, payload.validUntil || payload.validTo, {
    requireValidFrom,
    requireValidUntil,
    noExpiry
  });
  if (!dateResult.valid) {
    return { valid: false, error: dateResult.error, field: dateResult.field || 'validUntil' };
  }

  // Authority validation
  const rawAuthority = payload.authority !== undefined ? payload.authority : (payload.sourceAuthority !== undefined ? payload.sourceAuthority : payload.authorityTier);
  let authority;
  if (rawAuthority === undefined || rawAuthority === null || String(rawAuthority).trim() === '') {
    if (options.requireAuthority === true) {
      return { valid: false, error: "Tingkat otoritas ('authority') wajib diisi.", field: 'authority' };
    }
    authority = 'tier_2_official_announcement';
  } else {
    authority = normalizeAuthority(rawAuthority);
    if (authority === 'tier_unknown') {
      return { valid: false, error: "Tingkat otoritas ('authority') tidak valid. Pilih Tier 1 s.d Tier 4 yang sah.", field: 'authority' };
    }
  }

  // Status validation
  const rawStatus = payload.status !== undefined ? payload.status : payload.governanceStatus;
  let status;
  if (rawStatus === undefined || rawStatus === null || String(rawStatus).trim() === '') {
    if (options.requireStatus === true) {
      return { valid: false, error: "Status dokumen ('status') wajib diisi.", field: 'status' };
    }
    status = 'active';
  } else {
    const normalizedRaw = String(rawStatus).trim().toLowerCase();
    const validStatuses = ['active', 'draft', 'superseded', 'archived', 'approved', 'published', 'valid', 'expired', 'replaced'];
    if (!validStatuses.includes(normalizedRaw)) {
      return { valid: false, error: "Status dokumen ('status') tidak valid. Pilih active, draft, superseded, atau archived.", field: 'status' };
    }
    status = normalizeStatus(rawStatus);
  }

  // If status is active but validUntil has already passed, automatically set status to expired
  let finalStatus = status;
  if (finalStatus === 'active' && dateResult.validUntil) {
    const untilMs = new Date(dateResult.validUntil).getTime();
    if (untilMs < Date.now()) {
      finalStatus = 'expired';
    }
  }

  const documentTitle = String(payload.documentTitle || payload.title || nameResult.sanitizedName).trim();
  const originalFilename = String(
    payload.originalFilename ||
    ((payload.documentTitle || payload.title) && payload.filename ? payload.filename : '') ||
    payload.sourceFile ||
    ''
  ).trim() || null;

  const governanceMetadata = buildDocumentGovernanceMetadata({
    ...payload,
    filename: documentTitle,
    documentTitle,
    originalFilename,
    validFrom: dateResult.validFrom,
    validUntil: dateResult.validUntil,
    validTo: dateResult.validUntil,
    status: finalStatus,
    governanceStatus: finalStatus,
    authority,
    sourceAuthority: authority
  });

  return {
    valid: true,
    sanitizedFilename: documentTitle,
    filename: documentTitle,
    documentTitle,
    originalFilename,
    validFrom: dateResult.validFrom,
    validUntil: dateResult.validUntil,
    status: finalStatus,
    authority,
    governanceMetadata
  };
}

function buildDocumentGovernanceMetadata(input = {}) {
  const documentTitle = String(input.documentTitle || input.title || input.filename || '').trim();
  const originalFilename = String(
    input.originalFilename ||
    ((input.documentTitle || input.title) && input.filename ? input.filename : '') ||
    input.sourceFile ||
    ''
  ).trim() || null;
  const filename = documentTitle || String(input.filename || '').trim();
  const divisionKey = String(input.divisionKey || '').trim() || null;
  const nowIso = new Date().toISOString();
  const explicitOwner = String(input.owner || input.governanceOwner || '').trim();
  const source = String(input.source || '').trim() || 'unknown';
  const status = normalizeStatus(input.status || input.governanceStatus || 'active');
  const authority = normalizeAuthority(input.authority || input.sourceAuthority || input.authorityTier);
  const tierMeta = getAuthorityTier(authority);

  return {
    documentTitle: documentTitle || null,
    originalFilename: originalFilename || null,
    filename: filename || null,
    owner: explicitOwner || divisionKey || 'general',
    status,
    version: String(input.version || input.governanceVersion || '').trim() || `${source}-${sha256(filename || nowIso).slice(0, 10)}`,
    validFrom: input.validFrom || null,
    validTo: input.validTo || input.validUntil || null,
    validUntil: input.validUntil || input.validTo || null,
    sourceAuthority: authority,
    authority,
    authorityTier: tierMeta.tier,
    authorityWeight: tierMeta.weight,
    supersedes: input.supersedes || null,
    supersededBy: input.supersededBy || null,
    notes: String(input.notes || '').trim() || null
  };
}

function parseDateMs(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function getTrainingGovernance(row = {}) {
  const metadata = row.governanceMetadata && typeof row.governanceMetadata === 'object'
    ? row.governanceMetadata
    : {};
  const rawStatus = row.governanceStatus || row.status || metadata.status || null;
  const status = normalizeStatus(rawStatus);

  const rawTier = Number(row.authorityTier || metadata.authorityTier) || null;
  const rawAuthority = row.authority || row.sourceAuthority || metadata.authority || metadata.sourceAuthority || row.source || (rawTier ? `tier_${rawTier}` : null);
  const authority = normalizeAuthority(rawAuthority);
  const tierMeta = getAuthorityTier(authority);
  const resolvedTier = (rawTier && rawTier >= 1 && rawTier <= 4) ? rawTier : (authority !== 'tier_unknown' ? tierMeta.tier : null);

  const validFromVal = row.validFrom ? new Date(row.validFrom).toISOString() : (metadata.validFrom ? new Date(metadata.validFrom).toISOString() : null);
  const validToVal = row.validTo ? new Date(row.validTo).toISOString() : (metadata.validTo ? new Date(metadata.validTo).toISOString() : (row.validUntil ? new Date(row.validUntil).toISOString() : (metadata.validUntil ? new Date(metadata.validUntil).toISOString() : null)));

  return {
    owner: row.governanceOwner || row.owner || metadata.owner || row.divisionKey || 'general',
    status,
    version: row.governanceVersion || row.version || metadata.version || null,
    validFrom: validFromVal,
    validTo: validToVal,
    validUntil: validToVal,
    sourceAuthority: authority,
    authority,
    authorityTier: resolvedTier || 99,
    authorityWeight: tierMeta.weight,
    supersedes: row.supersedes || metadata.supersedes || null,
    supersededBy: row.supersededBy || metadata.supersededBy || null
  };
}

function isTrainingGovernanceAllowed(row = {}, options = {}) {
  const allowHistorical = Boolean(options.allowHistorical);
  const allowUnknown = Boolean(options.allowUnknown || envFlag('RAG_ALLOW_UNKNOWN_GOVERNANCE', false));
  const governance = getTrainingGovernance(row);

  // 1. Missing or unknown governance -> fail closed
  if (governance.status === 'validity_unknown') {
    return allowUnknown;
  }

  // 2. Incomplete metadata check: must have valid authority tier (1..4)
  if (!governance.authorityTier || governance.authorityTier < 1 || governance.authorityTier > 4 || governance.authority === 'tier_unknown') {
    return false;
  }

  // 3. Historical query handling
  if (allowHistorical) {
    if (['archived', 'superseded', 'expired'].includes(governance.status)) {
      if (options.query) {
        const q = String(options.query).toLowerCase();
        const content = String(row.output || row.input || row.question || row.answer || '').toLowerCase();
        const isHistoryQuery = /\b(?:sejarah|pendiri|didirikan|berdiri|awal\s+mula|tokoh|yayasan)\b/i.test(q);
        const isOperational = /\b(?:pmb|jadwal|gelombang|loket|spp|registrasi|biaya\s+kuliah)\b/i.test(content) && !/\b(?:sejarah|pendiri|didirikan|awal\s+mula)\b/i.test(content);
        if (isHistoryQuery && isOperational) {
          return false;
        }
      }
      return true;
    }
    if (['approved', 'active'].includes(governance.status)) {
      const now = options.referenceTime ? parseDateMs(options.referenceTime) : Date.now();
      const from = parseDateMs(governance.validFrom);
      if (from && from > now && !envFlag('RAG_ALLOW_FUTURE_DOCUMENTS', false)) {
        return false;
      }
      return true;
    }
    return false;
  }

  // 4. Current operational checks
  if (envFlag('RAG_ALLOW_DRAFT_DOCUMENTS', false) && governance.status === 'draft') return true;
  if (envFlag('RAG_ALLOW_SUPERSEDED_DOCUMENTS', false) && governance.status === 'superseded') return true;
  if (envFlag('RAG_ALLOW_ARCHIVED_DOCUMENTS', false) && governance.status === 'archived') return true;

  if (['superseded', 'archived', 'rejected', 'expired', 'draft', 'validity_unknown'].includes(governance.status)) return false;
  if (!['approved', 'active'].includes(governance.status)) return false;

  if (governance.supersededBy && !envFlag('RAG_ALLOW_SUPERSEDED_DOCUMENTS', false)) return false;

  const now = options.referenceTime ? parseDateMs(options.referenceTime) : Date.now();
  const from = parseDateMs(governance.validFrom);
  const to = parseDateMs(governance.validTo || governance.validUntil);
  if (from && from > now && !envFlag('RAG_ALLOW_FUTURE_DOCUMENTS', false)) return false;
  if (to && to < now && !envFlag('RAG_ALLOW_EXPIRED_DOCUMENTS', false)) return false;
  return true;
}

function isChunkGovernanceAllowed(chunk = {}, options = {}) {
  if (!chunk || typeof chunk !== 'object') return false;
  const allowHistorical = Boolean(options.allowHistorical);
  const allowUnknown = Boolean(options.allowUnknown || envFlag('RAG_ALLOW_UNKNOWN_GOVERNANCE', false));

  // Determine status
  const rawStatus = chunk.governanceStatus || chunk.status || (chunk.metadata && chunk.metadata.status) || (chunk.governanceMetadata && chunk.governanceMetadata.status) || null;
  const status = normalizeStatus(rawStatus);

  if (status === 'validity_unknown') {
    return allowUnknown;
  }

  // Determine authority and tier
  const rawTier = Number(chunk.authorityTier || (chunk.governanceMetadata && chunk.governanceMetadata.authorityTier)) || null;
  const rawAuthority = chunk.authority || (chunk.metadata && chunk.metadata.authority) || (chunk.governanceMetadata && chunk.governanceMetadata.authority) || (rawTier ? `tier_${rawTier}` : null);
  const authority = normalizeAuthority(rawAuthority);
  const resolvedTier = (rawTier && rawTier >= 1 && rawTier <= 4) ? rawTier : (authority !== 'tier_unknown' ? getAuthorityTier(authority).tier : null);

  // Incomplete / partial metadata: authority must be Tier 1..4
  if (!resolvedTier || resolvedTier < 1 || resolvedTier > 4 || authority === 'tier_unknown') {
    return false;
  }

  // Historical query handling
  if (allowHistorical) {
    if (['archived', 'superseded', 'expired'].includes(status)) {
      if (options.query) {
        const q = String(options.query).toLowerCase();
        const chunkText = String(chunk.chunk || chunk.content || chunk.text || '').toLowerCase();
        const filename = String(chunk.filename || '').toLowerCase();

        const isHistoryQuery = /\b(?:sejarah|pendiri|didirikan|berdiri|awal\s+mula|tokoh|yayasan)\b/i.test(q);
        const isOperationalChunk = /\b(?:pmb|jadwal|gelombang|loket|spp|registrasi|biaya\s+kuliah)\b/i.test(chunkText) && !/\b(?:sejarah|pendiri|didirikan|awal\s+mula)\b/i.test(chunkText);

        if (isHistoryQuery && isOperationalChunk) {
          return false;
        }

        const yearMatches = q.match(/\b(19\d\d|20[0-2]\d)\b/g);
        if (yearMatches && yearMatches.length > 0) {
          const chunkMentionsYear = yearMatches.some(y => chunkText.includes(y) || filename.includes(y));
          if (!chunkMentionsYear && !isHistoryQuery) {
            return false;
          }
        }
      }
      return true;
    }
    if (['approved', 'active'].includes(status)) {
      const now = options.referenceTime ? parseDateMs(options.referenceTime) : Date.now();
      const validFrom = parseDateMs(chunk.validFrom || (chunk.metadata && chunk.metadata.validFrom) || (chunk.governanceMetadata && chunk.governanceMetadata.validFrom));
      if (validFrom && validFrom > now && !envFlag('RAG_ALLOW_FUTURE_DOCUMENTS', false)) {
        return false;
      }
      return true;
    }
    return false;
  }

  // Current operational checks
  if (envFlag('RAG_ALLOW_DRAFT_DOCUMENTS', false) && status === 'draft') return true;
  if (envFlag('RAG_ALLOW_SUPERSEDED_DOCUMENTS', false) && status === 'superseded') return true;
  if (envFlag('RAG_ALLOW_ARCHIVED_DOCUMENTS', false) && status === 'archived') return true;

  if (['superseded', 'archived', 'rejected', 'expired', 'draft', 'validity_unknown'].includes(status)) return false;
  if (!['approved', 'active'].includes(status)) return false;

  const supersededBy = chunk.supersededBy || (chunk.metadata && chunk.metadata.supersededBy) || (chunk.governanceMetadata && chunk.governanceMetadata.supersededBy);
  if (supersededBy && !envFlag('RAG_ALLOW_SUPERSEDED_DOCUMENTS', false)) return false;

  const now = options.referenceTime ? parseDateMs(options.referenceTime) : Date.now();
  const validFrom = parseDateMs(chunk.validFrom || (chunk.metadata && chunk.metadata.validFrom) || (chunk.governanceMetadata && chunk.governanceMetadata.validFrom));
  const validTo = parseDateMs(chunk.validUntil || chunk.validTo || (chunk.metadata && (chunk.metadata.validUntil || chunk.metadata.validTo)) || (chunk.governanceMetadata && (chunk.governanceMetadata.validUntil || chunk.governanceMetadata.validTo)));

  if (validFrom && validFrom > now && !envFlag('RAG_ALLOW_FUTURE_DOCUMENTS', false)) return false;
  if (validTo && validTo < now && !envFlag('RAG_ALLOW_EXPIRED_DOCUMENTS', false)) return false;

  return true;
}

function filterGovernedChunks(chunks = [], options = {}) {
  const list = Array.isArray(chunks) ? chunks : [];
  return list.filter(c => isChunkGovernanceAllowed(c, options));
}

function enrichChunkWithGovernance(chunk = {}, defaultGovernance = {}) {
  if (!chunk || typeof chunk !== 'object') return chunk;
  const gov = Object.assign({}, defaultGovernance, chunk.governanceMetadata || chunk.governance || (chunk.metadata && (chunk.metadata.governanceMetadata || chunk.metadata.governance)) || {});

  const rawStatus = chunk.governanceStatus || chunk.status || gov.status || null;
  const status = normalizeStatus(rawStatus);

  const rawAuthority = chunk.authority || gov.authority || gov.sourceAuthority || null;
  const authority = normalizeAuthority(rawAuthority);
  const tierMeta = getAuthorityTier(authority);

  // If status is not explicitly known, or authority is unknown, FAIL-CLOSED to validity_unknown
  const finalStatus = (status === 'validity_unknown' || authority === 'tier_unknown') && !['superseded', 'expired', 'archived', 'draft', 'rejected'].includes(status)
    ? 'validity_unknown'
    : status;

  const validFrom = chunk.validFrom || gov.validFrom || null;
  const validUntil = chunk.validUntil || chunk.validTo || gov.validUntil || gov.validTo || null;
  const version = chunk.version || chunk.trainingVersion || gov.version || null;
  const documentTitle = chunk.documentTitle || gov.documentTitle || null;
  const originalFilename = chunk.originalFilename || gov.originalFilename || chunk.sourceFile || gov.sourceFile || null;
  const filename = documentTitle || gov.filename || chunk.filename || null;

  return {
    ...chunk,
    filename: filename || chunk.filename,
    governanceStatus: finalStatus,
    status: finalStatus,
    validFrom,
    validUntil,
    version,
    documentTitle: documentTitle || filename,
    originalFilename,
    authority,
    authorityTier: tierMeta.tier,
    supersedes: chunk.supersedes || gov.supersedes || null,
    supersededBy: chunk.supersededBy || gov.supersededBy || null,
    governanceMetadata: {
      ...gov,
      documentTitle,
      originalFilename,
      status: finalStatus,
      authority,
      authorityTier: tierMeta.tier,
      authorityWeight: tierMeta.weight,
      version,
      validFrom,
      validUntil,
      supersedes: chunk.supersedes || gov.supersedes || null,
      supersededBy: chunk.supersededBy || gov.supersededBy || null
    }
  };
}

function filterGovernedTrainingRows(rows = [], options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter(r => isTrainingGovernanceAllowed(r, options));
}

async function safeEnsureRuntimeTable(prisma, tableName, sql) {
  if (!prisma || !tableName || !sql || ensuredRuntimeTables.has(tableName)) return;
  const now = Date.now();
  const failedUntil = failedRuntimeTables.get(tableName) || 0;
  if (failedUntil > now) return;
  const timeoutMs = numberEnv('RUNTIME_AUDIT_DB_TIMEOUT_MS', 750);
  const failureTtlMs = numberEnv('RUNTIME_AUDIT_FAILURE_TTL_MS', 60000);
  try {
    const result = await withTimeout(prisma.$executeRawUnsafe(sql), timeoutMs, { timeout: true });
    if (result && result.timeout) {
      failedRuntimeTables.set(tableName, Date.now() + failureTtlMs);
      safeWarn({ tableName, timeoutMs }, '[RuntimeGovernance] skipped runtime table ensure after timeout');
      return;
    }
    ensuredRuntimeTables.add(tableName);
  } catch (err) {
    failedRuntimeTables.set(tableName, Date.now() + failureTtlMs);
    safeWarn({ tableName, err: err && err.message ? err.message : String(err) }, '[RuntimeGovernance] failed to ensure runtime table');
  }
}

async function ensureRuntimeAuditTables(prisma) {
  if (!prisma) return;
  await safeEnsureRuntimeTable(prisma, 'InboundEventDedupe', `
    CREATE TABLE IF NOT EXISTS "InboundEventDedupe" (
      "id" TEXT PRIMARY KEY,
      "provider" TEXT NOT NULL DEFAULT 'whatsapp',
      "chatId" TEXT NOT NULL,
      "messageId" TEXT,
      "dedupeKey" TEXT NOT NULL UNIQUE,
      "textHash" TEXT,
      "inboundTs" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await safeEnsureRuntimeTable(prisma, 'UserFeedback', `
    CREATE TABLE IF NOT EXISTS "UserFeedback" (
      "id" TEXT PRIMARY KEY,
      "chatId" TEXT NOT NULL,
      "feedbackType" TEXT NOT NULL,
      "userText" TEXT NOT NULL,
      "lastBotAnswer" TEXT,
      "lastBotSource" TEXT,
      "status" TEXT NOT NULL DEFAULT 'open',
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await safeEnsureRuntimeTable(prisma, 'RagTrace', `
    CREATE TABLE IF NOT EXISTS "RagTrace" (
      "id" TEXT PRIMARY KEY,
      "chatId" TEXT,
      "question" TEXT NOT NULL,
      "normalizedQuestion" TEXT,
      "intent" TEXT,
      "source" TEXT,
      "confidenceScore" DOUBLE PRECISION,
      "confidenceTier" TEXT,
      "routeStage" TEXT,
      "selectedContextCount" INTEGER NOT NULL DEFAULT 0,
      "topSources" JSONB,
      "debug" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function buildInboundDedupeKey(event = {}) {
  const chatId = String(event.chatId || '').trim();
  const provider = String(event.provider || event.source || 'whatsapp').trim().toLowerCase();
  const messageId = String(event.messageId || event.fonnteMessageId || '').trim();
  const inboundTs = event.inboundTs || event.ts || event.timestamp || '';
  const textHash = sha256(String(event.text || event.normalizedText || '').replace(/\s+/g, ' ').trim().toLowerCase());
  if (messageId) return `${provider}:id:${messageId}`;
  return `${provider}:text:${chatId}:${String(inboundTs || '').trim()}:${textHash}`;
}

async function rememberInboundEventPersistent(prisma, event = {}) {
  if (!envFlag('PERSISTENT_INBOUND_DEDUPE', true)) return { duplicate: false, skipped: true };
  const chatId = String(event.chatId || '').trim();
  const text = String(event.text || '').trim();
  if (!prisma || !chatId || !text) return { duplicate: false, skipped: true };

  await ensureRuntimeAuditTables(prisma);
  const dedupeKey = buildInboundDedupeKey(event);
  const id = sha256(dedupeKey);
  try {
    await prisma.inboundEventDedupe.create({
      data: {
        id,
        provider: String(event.provider || event.source || 'whatsapp').slice(0, 40),
        chatId,
        messageId: event.messageId ? String(event.messageId).slice(0, 160) : null,
        dedupeKey,
        textHash: sha256(text),
        inboundTs: event.inboundTs ? new Date(event.inboundTs) : null
      }
    });
    return { duplicate: false, dedupeKey };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (err && err.code === 'P2002') return { duplicate: true, dedupeKey, reason: 'unique_dedupe_key' };
    if (/does not exist|Unknown arg|Unknown field|no such table|column .* does not exist/i.test(msg)) {
      safeWarn({ err: msg }, '[RuntimeGovernance] persistent inbound dedupe unavailable');
      return { duplicate: false, skipped: true, reason: 'schema_unavailable' };
    }
    safeWarn({ err: msg }, '[RuntimeGovernance] persistent inbound dedupe failed');
    return { duplicate: false, skipped: true, reason: 'error' };
  }
}

function detectUserFeedback(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (/\b(?:jawaban|jawabannya|respon|respons|balasan)\b.*\b(?:salah|keliru|ngaco|tidak\s+sesuai|ga\s+sesuai|nggak\s+sesuai|tidak\s+nyambung|ga\s+nyambung|kurang\s+tepat)\b/i.test(t)) return 'wrong_answer';
  if (/\b(?:salah\s+jawab|jawabannya\s+salah|kurang\s+tepat|tidak\s+nyambung|ga\s+nyambung|nggak\s+nyambung)\b/i.test(t)) return 'wrong_answer';
  if (/\b(?:sudah\s+benar|jawabannya\s+benar|terjawab|sesuai)\b/i.test(t)) return 'positive';
  return null;
}

async function recordUserFeedback(prisma, payload = {}) {
  const feedbackType = payload.feedbackType || detectUserFeedback(payload.userText);
  if (!feedbackType || !prisma) return { recorded: false };
  await ensureRuntimeAuditTables(prisma);
  const id = crypto.randomUUID ? crypto.randomUUID() : sha256(`${Date.now()}:${Math.random()}`);
  const data = {
    id,
    chatId: String(payload.chatId || ''),
    feedbackType,
    userText: clamp(payload.userText, 1200),
    lastBotAnswer: payload.lastBotAnswer ? clamp(payload.lastBotAnswer, 2500) : null,
    lastBotSource: payload.lastBotSource ? clamp(payload.lastBotSource, 180) : null,
    status: feedbackType === 'positive' ? 'closed' : 'open',
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
  };
  try {
    await prisma.userFeedback.create({ data });
    return { recorded: true, id, feedbackType };
  } catch (err) {
    safeWarn({ err: err && err.message ? err.message : String(err) }, '[RuntimeGovernance] failed to record user feedback');
    return { recorded: false, feedbackType };
  }
}


async function queueFeedbackForReview(prisma, payload = {}) {
  if (!prisma || !prisma.ragEvalItem || typeof prisma.ragEvalItem.upsert !== 'function') return { queued: false };
  const feedbackType = payload.feedbackType || detectUserFeedback(payload.userText);
  if (!feedbackType || feedbackType === 'positive') return { queued: false, skipped: true, feedbackType };
  await ensureRuntimeAuditTables(prisma);

  const rawQ = clamp(payload.question || payload.userText || 'User feedback requires review', 2000);
  const normalized = clamp(String(rawQ || '').toLowerCase().replace(/s+/g, ' ').trim(), 2000) || 'feedback-review';
  const reason = feedbackType === 'wrong_answer' ? 'feedback_wrong_answer' : `feedback_${feedbackType}`;
  const keySeed = `${payload.divisionKey || 'global'}|${reason}|${normalized}|${payload.lastBotSource || ''}`;
  const key = sha256(keySeed);
  const contexts = {
    chatId: payload.chatId || null,
    feedbackId: payload.feedbackId || null,
    feedbackType,
    userText: clamp(payload.userText, 1200),
    lastBotSource: payload.lastBotSource ? clamp(payload.lastBotSource, 180) : null,
    lastBotAnswer: payload.lastBotAnswer ? clamp(payload.lastBotAnswer, 1800) : null,
    reviewType: 'admin_review_queue'
  };

  try {
    await prisma.ragEvalItem.upsert({
      where: { key },
      create: {
        key,
        question: rawQ || keySeed,
        normalized: normalized || keySeed,
        divisionKey: payload.divisionKey || null,
        reason,
        minScore: null,
        topScore: null,
        contexts
      },
      update: {
        occurrences: { increment: 1 },
        question: rawQ || undefined,
        divisionKey: payload.divisionKey || null,
        reason,
        contexts,
        resolvedAt: null
      }
    });
    return { queued: true, reason, key };
  } catch (err) {
    safeWarn({ err: err && err.message ? err.message : String(err) }, '[RuntimeGovernance] failed to queue feedback review');
    return { queued: false, reason };
  }
}
function extractLastBotMessage(sessionData = {}) {
  const messages = Array.isArray(sessionData.messages) ? sessionData.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i] || {};
    if (String(item.direction || '').toLowerCase() === 'bot' && String(item.message || '').trim()) {
      return String(item.message || '');
    }
  }
  return sessionData.lastBotAnswer ? String(sessionData.lastBotAnswer) : '';
}

function extractLastBotSource(sessionData = {}) {
  if (sessionData.composerLastSource) return String(sessionData.composerLastSource);
  if (sessionData.composerTelemetry && sessionData.composerTelemetry.source) return String(sessionData.composerTelemetry.source);
  return '';
}

function inferMemoryTopic(text = '') {
  const t = String(text || '').toLowerCase();
  if (/\b(double\s*degree|dual\s*degree|dnui|help|utb)\b/i.test(t)) return 'double_degree';
  if (/\b(pmb|pendaftaran|daftar|maba|calon\s+mahasiswa)\b/i.test(t)) return 'pmb';
  if (/\b(biaya|ukt|dpp|pembayaran|bayar|potongan)\b/i.test(t)) return 'fee';
  if (/\b(beasiswa|kip|1k1s|skss|prestasi)\b/i.test(t)) return 'scholarship';
  if (/\b(rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(t)) return 'rpl';
  if (/\b(yudisium|wisuda|sidang|skripsi|tugas\s+akhir|semester)\b/i.test(t)) return 'academic';
  if (/\b(career|karir|karier|lowongan|magang|pelatihan|pekerjaan)\b/i.test(t)) return 'career';
  if (/\b(prodi|program\s+studi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika)\b/i.test(t)) return 'program';
  return null;
}

async function updateConversationMemory(prisma, chatId, patch = {}) {
  if (!prisma || !chatId) return false;
  if (!envFlag('CONVERSATION_MEMORY_ENABLED', process.env.NODE_ENV !== 'test')) return false;
  try {
    const session = await prisma.session.findUnique({ where: { chatId } });
    const currentState = session && session.state ? session.state : 'root';
    const prevData = session && session.data && typeof session.data === 'object' ? session.data : {};
    const nowIso = new Date().toISOString();
    const prevMemory = prevData.conversationMemory && typeof prevData.conversationMemory === 'object' ? prevData.conversationMemory : {};
    const topic = patch.topic || inferMemoryTopic(patch.userText || patch.answer || '') || prevMemory.lastTopic || null;
    const nextMemory = {
      ...prevMemory,
      lastTopic: topic,
      lastUserText: patch.userText ? clamp(patch.userText, 500) : prevMemory.lastUserText || null,
      lastAnswerPreview: patch.answer ? clamp(patch.answer, 500) : prevMemory.lastAnswerPreview || null,
      lastSource: patch.source || prevMemory.lastSource || null,
      lastConfidenceScore: typeof patch.confidenceScore === 'number' ? patch.confidenceScore : prevMemory.lastConfidenceScore || null,
      updatedAt: nowIso
    };
    await prisma.session.upsert({
      where: { chatId },
      create: { chatId, state: currentState, data: { ...prevData, conversationMemory: nextMemory } },
      update: { state: currentState, data: { ...prevData, conversationMemory: nextMemory } }
    });
    return true;
  } catch (err) {
    safeWarn({ chatId, err: err && err.message ? err.message : String(err) }, '[RuntimeGovernance] failed to update conversation memory');
    return false;
  }
}

function buildTopSources(contexts = []) {
  return (Array.isArray(contexts) ? contexts : []).slice(0, 5).map((ctx, idx) => ({
    rank: idx + 1,
    id: ctx && (ctx.id || ctx.chunkId || ctx.sourceId || ctx.trainingId) ? String(ctx.id || ctx.chunkId || ctx.sourceId || ctx.trainingId).slice(0, 160) : null,
    source: ctx && (ctx.filename || ctx.source || ctx.sourceFile) ? String(ctx.filename || ctx.source || ctx.sourceFile).slice(0, 220) : null,
    trainingId: ctx && ctx.trainingId ? String(ctx.trainingId) : null,
    score: Number.isFinite(Number(ctx && ctx.score)) ? Number(ctx.score) : null,
    reason: ctx && ctx.reason ? String(ctx.reason).slice(0, 160) : null,
    governance: ctx && ctx.metadata && ctx.metadata.governance ? ctx.metadata.governance : (ctx && ctx.governance ? ctx.governance : null)
  }));
}

async function recordRagTrace(prisma, payload = {}) {
  const persistDefault = process.env.NODE_ENV === 'test' && !envExplicitlySet('RAG_TRACE_PERSIST') ? false : true;
  if (!envFlag('RAG_TRACE_PERSIST', persistDefault)) return { recorded: false, skipped: true };
  if (!prisma || !payload.question) return { recorded: false };
  if (ragTracePersistFailureUntil > Date.now()) return { recorded: false, skipped: true, reason: 'recent_trace_persist_failure' };
  await ensureRuntimeAuditTables(prisma);
  const id = crypto.randomUUID ? crypto.randomUUID() : sha256(`${Date.now()}:${Math.random()}`);
  const data = {
    id,
    chatId: payload.chatId ? String(payload.chatId) : null,
    question: clamp(payload.question, 2000),
    normalizedQuestion: payload.normalizedQuestion ? clamp(payload.normalizedQuestion, 2000) : null,
    intent: payload.intent ? clamp(payload.intent, 120) : null,
    source: payload.source ? clamp(payload.source, 180) : null,
    confidenceScore: Number.isFinite(Number(payload.confidenceScore)) ? Number(payload.confidenceScore) : null,
    confidenceTier: payload.confidenceTier ? clamp(payload.confidenceTier, 40) : null,
    routeStage: payload.routeStage ? clamp(payload.routeStage, 160) : null,
    selectedContextCount: Array.isArray(payload.contexts) ? payload.contexts.length : 0,
    topSources: buildTopSources(payload.contexts),
    debug: payload.debug && typeof payload.debug === 'object' ? payload.debug : {}
  };
  try {
    const timeoutMs = numberEnv('RAG_TRACE_PERSIST_TIMEOUT_MS', numberEnv('RUNTIME_AUDIT_DB_TIMEOUT_MS', 750));
    const failureTtlMs = numberEnv('RUNTIME_AUDIT_FAILURE_TTL_MS', 60000);
    const result = await withTimeout(prisma.ragTrace.create({ data }), timeoutMs, { timeout: true });
    if (result && result.timeout) {
      ragTracePersistFailureUntil = Date.now() + failureTtlMs;
      safeWarn({ timeoutMs }, '[RuntimeGovernance] skipped RAG trace persistence after timeout');
      return { recorded: false, timeout: true };
    }
    return { recorded: true, id };
  } catch (err) {
    ragTracePersistFailureUntil = Date.now() + numberEnv('RUNTIME_AUDIT_FAILURE_TTL_MS', 60000);
    safeWarn({ err: err && err.message ? err.message : String(err) }, '[RuntimeGovernance] failed to record RAG trace');
    return { recorded: false };
  }
}

function appendRuntimeAuditJsonl(filename, payload) {
  try {
    const outDir = path.join(__dirname, '..', '..', 'tmp');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.appendFileSync(path.join(outDir, filename), JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n');
  } catch (err) {
    // ignore file audit errors
  }
}

module.exports = {
  AUTHORITY_TIERS,
  normalizeStatus,
  normalizeAuthority,
  getAuthorityTier,
  compareAuthority,
  validateDocumentNaming,
  validateDocumentValidityDates,
  validateDocumentIntakeGovernance,
  buildDocumentGovernanceMetadata,
  getTrainingGovernance,
  isTrainingGovernanceAllowed,
  filterGovernedTrainingRows,
  isChunkGovernanceAllowed,
  filterGovernedChunks,
  enrichChunkWithGovernance,
  rememberInboundEventPersistent,
  detectUserFeedback,
  recordUserFeedback,
  queueFeedbackForReview,
  extractLastBotMessage,
  extractLastBotSource,
  updateConversationMemory,
  recordRagTrace,
  appendRuntimeAuditJsonl,
  buildTopSources
};
