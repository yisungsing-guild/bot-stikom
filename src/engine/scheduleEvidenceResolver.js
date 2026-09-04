const ragEngine = require('./ragEngine');

const STATUS = {
  EVIDENCE_FOUND: 'EVIDENCE_FOUND',
  VERSIONED_FALLBACK: 'VERSIONED_FALLBACK',
  UNSUPPORTED_WAVE: 'UNSUPPORTED_WAVE',
  NO_COMPATIBLE_EVIDENCE: 'NO_COMPATIBLE_EVIDENCE'
};

const VERSIONED_FALLBACK_PROVENANCE = {
  source: 'versioned_pmb_calendar_snapshot',
  sourceType: 'versioned_fallback',
  documentId: 'pmb-calendar-2026-2027-snapshot',
  trainingId: null,
  evidenceVersion: 'pmb-calendar-2026-2027-v1',
  academicPeriod: '2026/2027',
  validFrom: '2025-10-28',
  validUntil: '2026-09-11',
  provenance: 'Bundled PMB calendar snapshot for TA 2026/2027 used only when compatible indexed calendar evidence is unavailable.'
};

const VERSIONED_FALLBACK_WINDOWS = [
  { key: 'KHUSUS', display: 'Gelombang Khusus', masa: '28 Oktober 2025 s/d 27 Desember 2025', startYmd: '2025-10-28', endYmd: '2025-12-27' },
  { key: 'IA', display: 'Gelombang I A', masa: '28 Desember 2025 s/d 31 Januari 2026', startYmd: '2025-12-28', endYmd: '2026-01-31' },
  { key: 'IB', display: 'Gelombang I B', masa: '1 Februari 2026 s/d 14 Februari 2026', startYmd: '2026-02-01', endYmd: '2026-02-14' },
  { key: 'IC', display: 'Gelombang I C', masa: '15 Februari 2026 s/d 7 Maret 2026', startYmd: '2026-02-15', endYmd: '2026-03-07' },
  { key: 'IIA', display: 'Gelombang II A', masa: '8 Maret 2026 s/d 28 Maret 2026', startYmd: '2026-03-08', endYmd: '2026-03-28' },
  { key: 'IIB', display: 'Gelombang II B', masa: '29 Maret 2026 s/d 18 April 2026', startYmd: '2026-03-29', endYmd: '2026-04-18' },
  { key: 'IIC', display: 'Gelombang II C', masa: '19 April 2026 s/d 2 Mei 2026', startYmd: '2026-04-19', endYmd: '2026-05-02' },
  { key: 'IIIA', display: 'Gelombang III A', masa: '3 Mei 2026 s/d 16 Mei 2026', startYmd: '2026-05-03', endYmd: '2026-05-16' },
  { key: 'IIIB', display: 'Gelombang III B', masa: '17 Mei 2026 s/d 30 Mei 2026', startYmd: '2026-05-17', endYmd: '2026-05-30' },
  { key: 'IIIC', display: 'Gelombang III C', masa: '31 Mei 2026 s/d 4 Juli 2026', startYmd: '2026-05-31', endYmd: '2026-07-04' },
  { key: 'IVA', display: 'Gelombang IV A', masa: '5 Juli 2026 s/d 18 Juli 2026', startYmd: '2026-07-05', endYmd: '2026-07-18' },
  { key: 'IVB', display: 'Gelombang IV B', masa: '19 Juli 2026 s/d 1 Agustus 2026', startYmd: '2026-07-19', endYmd: '2026-08-01' },
  { key: 'IVC', display: 'Gelombang IV C', masa: '2 Agustus 2026 s/d 15 Agustus 2026', startYmd: '2026-08-02', endYmd: '2026-08-15' },
  { key: 'SISIPAN1', display: 'Gelombang Sisipan 1', masa: '16 Agustus 2026 s/d 29 Agustus 2026', startYmd: '2026-08-16', endYmd: '2026-08-29' },
  { key: 'SISIPAN2', display: 'Gelombang Sisipan 2', masa: '30 Agustus 2026 s/d 11 September 2026', startYmd: '2026-08-30', endYmd: '2026-09-11' }
];

function romanToWaveGroup(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  if (s === '1' || s === 'I' || s === 'SATU') return 'I';
  if (s === '2' || s === 'II' || s === 'DUA') return 'II';
  if (s === '3' || s === 'III' || s === 'TIGA') return 'III';
  if (s === '4' || s === 'IV' || s === 'EMPAT') return 'IV';
  if (s === 'KHUSUS') return 'KHUSUS';
  return '';
}

function normalizeScheduleWaveKey(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (s === 'KHUSUS') return 'KHUSUS';
  const sis = /^SISIPAN([0-9]{1,2})$/.exec(s);
  if (sis) return `SISIPAN${sis[1]}`;
  const m = /^([1-4]|I{1,3}|IV|SATU|DUA|TIGA|EMPAT)([A-C])?$/.exec(s);
  if (!m) return s;
  const group = romanToWaveGroup(m[1]);
  return group ? `${group}${m[2] || ''}` : s;
}

function formatWaveKeyForDisplay(waveKey) {
  const key = normalizeScheduleWaveKey(waveKey);
  if (!key) return '';
  if (key === 'KHUSUS') return 'Khusus';
  const sis = /^SISIPAN([0-9]{1,2})$/.exec(key);
  if (sis) return `Sisipan ${sis[1]}`;
  const m = /^(I{1,3}|IV)([A-C])?$/.exec(key);
  if (m) return m[2] ? `${m[1]} ${m[2]}` : m[1];
  return key;
}

function scheduleWaveGroupOfKey(key) {
  const s = normalizeScheduleWaveKey(key);
  if (s === 'KHUSUS') return 'KHUSUS';
  if (/^IV[A-C]?$/.test(s)) return 'IV';
  if (/^III[A-C]?$/.test(s)) return 'III';
  if (/^II[A-C]?$/.test(s)) return 'II';
  if (/^I[A-C]?$/.test(s)) return 'I';
  return '';
}

function parseRequestedScheduleWave(question) {
  const q = String(question || '');
  const matches = Array.from(q.matchAll(/\b(?:gel(?:ombang)?|gbg)?\s*(khusus|[1-4]|i{1,3}|iv|satu|dua|tiga|empat)\s*([a-c])?\b/gi))
    .filter((m) => /\b(?:gel(?:ombang)?|gbg|khusus|sisipan)\b/i.test(m[0]) || !!m[2]);
  const m = matches.length ? matches[matches.length - 1] : null;
  if (!m) return null;
  const group = romanToWaveGroup(m[1]);
  const suffix = String(m[2] || '').trim().toUpperCase();
  if (!group) return null;
  return { group, key: group === 'KHUSUS' ? 'KHUSUS' : `${group}${suffix}`, hasSuffix: Boolean(suffix) };
}

function hasExplicitUnsupportedWave(question) {
  const q = String(question || '');
  const m = /\b(?:gel(?:ombang)?|gbg)\s+([0-9ivxlcdm]+)\b/i.exec(q);
  if (!m) return false;
  return !romanToWaveGroup(m[1]);
}
function compactDateRangeText(masaRaw) {
  const s = String(masaRaw || '').replace(/\s{2,}/g, ' ').trim();
  if (!s) return '';
  const parts = s.split(/\s*(?:s\s*\/\s*d|s\s*d|s\.\s*d|sd|hingga|sampai)\s*/i).filter(Boolean);
  if (parts.length < 2) return s;
  const prettify = (v) => String(v || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (w.length <= 2 ? w.toUpperCase() : (w.charAt(0).toUpperCase() + w.slice(1))))
    .join(' ');
  return `${prettify(parts[0])} - ${prettify(parts[1])}`;
}

function normalizeWindow(row, provenance) {
  if (!row || !row.key || !row.masa || !row.startYmd || !row.endYmd) return null;
  const key = normalizeScheduleWaveKey(row.key);
  if (!key) return null;
  return {
    key,
    display: row.display || (key === 'KHUSUS' ? 'Gelombang Khusus' : `Gelombang ${formatWaveKeyForDisplay(key)}`),
    masa: String(row.masa || '').replace(/\s{2,}/g, ' ').trim(),
    startYmd: row.startYmd,
    endYmd: row.endYmd,
    testing: row.testing || null,
    pengumuman: row.pengumuman || null,
    registrasi: row.registrasi || null,
    provenance
  };
}

function fallbackIsValidFor(currentDate) {
  const d = String(currentDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return true;
  return d >= VERSIONED_FALLBACK_PROVENANCE.validFrom && d <= VERSIONED_FALLBACK_PROVENANCE.validUntil;
}

function getIndexedWindows(options = {}) {
  if (typeof options.getIndexedWindows === 'function') return options.getIndexedWindows() || [];
  if (!ragEngine || typeof ragEngine.extractScheduleRegistrationWindowsFromIndex !== 'function') return [];
  return ragEngine.extractScheduleRegistrationWindowsFromIndex() || [];
}

function pickWindows(options = {}) {
  const indexed = getIndexedWindows(options)
    .map((row) => normalizeWindow(row, {
      source: 'indexed_calendar_evidence',
      sourceType: 'indexed_calendar',
      documentId: row.documentId || row.id || null,
      trainingId: row.trainingId || null,
      evidenceVersion: row.trainingVersion || row.evidenceVersion || null,
      provenance: 'Extracted from compatible indexed PMB calendar evidence.'
    }))
    .filter(Boolean);
  if (indexed.length) return { status: STATUS.EVIDENCE_FOUND, windows: indexed, provenance: indexed[0].provenance, sourceType: 'indexed_calendar' };
  if (options.allowVersionedFallback !== false && fallbackIsValidFor(options.currentDate)) {
    return {
      status: STATUS.VERSIONED_FALLBACK,
      windows: VERSIONED_FALLBACK_WINDOWS.map((row) => normalizeWindow(row, VERSIONED_FALLBACK_PROVENANCE)).filter(Boolean),
      provenance: VERSIONED_FALLBACK_PROVENANCE,
      sourceType: VERSIONED_FALLBACK_PROVENANCE.sourceType
    };
  }
  return { status: STATUS.NO_COMPATIBLE_EVIDENCE, windows: [], provenance: null, sourceType: 'none' };
}

function resolveAdmissionScheduleEvidence(options = {}) {
  const picked = pickWindows(options);
  const normalizedWave = options.waveKey ? normalizeScheduleWaveKey(options.waveKey) : '';
  const requestedWave = options.requestedWave || (normalizedWave
    ? { key: normalizedWave, group: scheduleWaveGroupOfKey(normalizedWave), hasSuffix: /[A-C]$/.test(normalizedWave) || normalizedWave === 'KHUSUS' || /^SISIPAN/.test(normalizedWave) }
    : parseRequestedScheduleWave(options.question));
  if (!requestedWave && hasExplicitUnsupportedWave(options.question)) {
    return { ...picked, status: STATUS.UNSUPPORTED_WAVE, requestedWave: null, matches: [], waveKey: null };
  }
  if (!picked.windows.length) return { ...picked, requestedWave, matches: [], waveKey: requestedWave ? requestedWave.key : null };
  const matches = requestedWave ? picked.windows.filter((w) => {
    const key = normalizeScheduleWaveKey(w.key);
    if (requestedWave.key === 'KHUSUS') return key === 'KHUSUS';
    if (requestedWave.hasSuffix) return key === normalizeScheduleWaveKey(requestedWave.key);
    return scheduleWaveGroupOfKey(key) === requestedWave.group;
  }) : [];
  if (requestedWave && !matches.length) return { ...picked, status: STATUS.UNSUPPORTED_WAVE, requestedWave, matches: [], waveKey: requestedWave.key };
  return { ...picked, requestedWave, matches, waveKey: requestedWave ? requestedWave.key : null };
}

function formatScheduleItems(windows) {
  return (windows || []).map((w) => `- ${w.display}: ${compactDateRangeText(w.masa)}`).join('\n');
}

function formatAdmissionScheduleOverviewMessage(evidence) {
  const windows = evidence && Array.isArray(evidence.windows) ? evidence.windows : [];
  if (!windows.length) return 'Saya belum menemukan data kalender PMB yang cukup lengkap untuk menjawab jadwal tersebut secara aman.';
  const period = evidence.provenance && evidence.provenance.academicPeriod ? ` (TA ${evidence.provenance.academicPeriod})` : '';
  return [
    `Kalender pendaftaran PMB${period}:`,
    '',
    'Masa pendaftaran per gelombang:',
    formatScheduleItems(windows),
    '',
    'Balas gelombangnya (mis. "II B" / "III A" / "Khusus"), nanti saya kirim jadwal detailnya.'
  ].join('\n').trim();
}

function formatAdmissionScheduleWaveDetailMessage(row) {
  if (!row || !row.key) return '';
  const pretty = row.key === 'KHUSUS' ? 'Gelombang Khusus' : `Gelombang ${formatWaveKeyForDisplay(row.key)}`;
  const lines = [
    `Jadwal ${pretty}:`,
    '',
    `- Masa pendaftaran: ${compactDateRangeText(row.masa)}`
  ];
  if (row.testing) lines.push(`- Testing: ${compactDateRangeText(row.testing)}`);
  if (row.pengumuman) lines.push(`- Pengumuman: ${compactDateRangeText(row.pengumuman)}`);
  if (row.registrasi) lines.push(`- Masa registrasi ulang: ${compactDateRangeText(row.registrasi)}`);
  lines.push('', 'Mau saya bantu cek jadwal gelombang lain? (contoh: II A / II C)');
  return lines.join('\n').trim();
}

module.exports = {
  STATUS,
  VERSIONED_FALLBACK_PROVENANCE,
  VERSIONED_FALLBACK_WINDOWS,
  resolveAdmissionScheduleEvidence,
  parseRequestedScheduleWave,
  normalizeScheduleWaveKey,
  scheduleWaveGroupOfKey,
  formatWaveKeyForDisplay,
  compactDateRangeText,
  formatScheduleItems,
  formatAdmissionScheduleOverviewMessage,
  formatAdmissionScheduleWaveDetailMessage
};
