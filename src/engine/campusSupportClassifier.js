const { normalizeUserQuery } = require('../utils/queryNormalizer');

const ENTITY_ALIASES = {
  'career center': 'career_center',
  'karier center': 'career_center',
  'karir center': 'career_center',
  'pusat karier': 'career_center',
  'pusat karir': 'career_center',
  'language learning center': 'language_learning_center',
  'llc': 'language_learning_center',
  'inkubator bisnis': 'inkubator_bisnis',
  'inkubator': 'inkubator_bisnis',
  'inbis': 'inkubator_bisnis',
  'softskill': 'softskill_program',
  'program pengembangan softskill': 'softskill_program',
  'hi think': 'hi_think',
  'hithink': 'hi_think',
  'student exchange': 'student_exchange',
  'pertukaran mahasiswa': 'student_exchange',
  'exchange program': 'student_exchange',
  'short course': 'short_course',
  'gccp': 'gccp',
  'gcpp': 'gccp',
  'bccp': 'bccp',
  'perpustakaan': 'library',
  'lab': 'lab',
  'laboratorium': 'lab',
  'ukm': 'ukm',
  'ormawa': 'ormawa'
};

const NEGATIVE_CONTROL_PATTERNS = [
  'biaya kuliah', 'harga kuliah', 'ukt', 'dpp', 'beasiswa', 'jurusan', 'program studi',
  'fakultas', 'cara daftar', 'pendaftaran', 'registrasi', 'halo', 'terima kasih', 'thanks',
  'double degree', 'dual degree', 'visa', 'itas', 'kitas', 'akreditasi'
];

function normalizeText(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function containsPhrase(text, phrase) {
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'iu').test(text);
}

function classifyCampusSupportQuery(queryUnderstanding) {
  const incoming = queryUnderstanding && typeof queryUnderstanding === 'object' ? queryUnderstanding : { rawQuestion: String(queryUnderstanding || '') };
  const rawQuestion = String(incoming.rawQuestion || incoming.query || '').trim();
  const normalizedText = String(
    incoming.normalizedText || incoming.normalizedQuery || normalizeUserQuery(rawQuestion).normalizedText || rawQuestion || ''
  ).trim();
  const lower = normalizeText(normalizedText || rawQuestion);

  const contextSignal = incoming.context && typeof incoming.context === 'object' ? JSON.stringify(incoming.context) : '';
  const intentSignal = String(incoming.intent || incoming.intentSignal || 'unknown');
  const entitySignal = incoming.entities && typeof incoming.entities === 'object' ? JSON.stringify(incoming.entities) : '';
  const aliasSignal = incoming.entities && Array.isArray(incoming.entities.dynamicAliases) ? incoming.entities.dynamicAliases.join(' ') : '';
  const semanticTopicSignal = Array.isArray(incoming.searchQueries) ? incoming.searchQueries.join(' ') : lower;

  const genericFacilityQuery = /(?:fasilitas|sarana|prasarana|layanan|kampus)(?:\s+(?:kampus|mahasiswa|yang|apa|ada))*\s*(?:apa|apa saja|apa aja|ada apa|punya|tersedia|yang ada)/i.test(lower)
    || /(?:fasilitasnya|fasilitas).*?(?:apa|apa saja|apa aja)/i.test(lower)
    || /(?:kampus\s+punya\s+fasilitas|fasilitas\s+kampus|fasilitas\s+apa\s+saja|fasilitasnya\s+apa\s+aja)/i.test(lower);

  const supportServiceTerms = [
    'layanan mahasiswa', 'layanan karier', 'career center', 'karier center', 'karir center',
    'pusat karier', 'pusat karir', 'llc', 'language learning center', 'inkubator', 'inbis',
    'softskill', 'konsultasi', 'hi think', 'hello think', 'hithink', 'student exchange',
    'pertukaran mahasiswa', 'exchange program', 'gccp', 'gcpp', 'bccp', 'short course'
  ];
  const organizationTerms = [
    'ukm', 'ormawa', 'organisasi mahasiswa', 'unit kegiatan mahasiswa', 'komunitas mahasiswa', 'kegiatan mahasiswa'
  ];
  const facilityTerms = [
    'fasilitas', 'sarana', 'prasarana', 'lab', 'laboratorium', 'perpustakaan', 'lapangan', 'kantin',
    'ruang kelas', 'gedung', 'parkir', 'wifi'
  ];
  const campusContextTerms = ['kampus', 'kampus punya', 'fasilitas kampus'];

  const hasOrganizationHint = organizationTerms.some((term) => containsPhrase(lower, term));
  const hasSupportServiceHint = supportServiceTerms.some((term) => containsPhrase(lower, term));
  const hasFacilityHint = facilityTerms.some((term) => containsPhrase(lower, term));
  const hasCampusContext = campusContextTerms.some((term) => containsPhrase(lower, term));

  let entity = null;
  for (const [pattern, value] of Object.entries(ENTITY_ALIASES)) {
    if (containsPhrase(lower, pattern)) {
      entity = value;
      break;
    }
  }

  const negativeHit = NEGATIVE_CONTROL_PATTERNS.some((pattern) => containsPhrase(lower, pattern));

  const strongCampusSignals = Boolean(entity) || genericFacilityQuery || hasOrganizationHint || hasSupportServiceHint || hasFacilityHint || hasCampusContext;
  const matched = strongCampusSignals && !negativeHit;

  let domain = 'other';
  let category = 'unknown';
  let subtype = null;

  if (matched) {
    domain = 'campus_support';
    if (hasOrganizationHint) {
      category = 'student_organization';
      subtype = 'student_org_list';
    } else if (hasSupportServiceHint || Boolean(entity)) {
      category = 'support_service';
      subtype = 'campus_service';
    } else if (genericFacilityQuery || hasFacilityHint || hasCampusContext) {
      category = 'facility';
      subtype = genericFacilityQuery ? 'generic_facility' : 'facility_list';
    } else {
      category = 'campus_resource';
      subtype = 'resource_query';
    }
  }

  let requestType = 'UNKNOWN';
  if (/(apa\s+itu|itu\s+apa|artinya|definisi|pengertian|jelaskan)/i.test(lower)) requestType = 'DEFINITION';
  else if (/(apa\s+saja|apa\s+aja|yang\s+ada|daftar|tersedia)/i.test(lower)) requestType = 'LIST';
  else if (/(ada\s+(gak|ga|tidak)?|punya|tersedia|adakah|apakah\s+ada)/i.test(lower)) requestType = 'EXISTENCE';
  else if (/(dimana|lokasi|tempat|alamat|letaknya|di mana)/i.test(lower)) requestType = 'LOCATION';
  else if (/(fungsi|manfaat|tujuan|kegunaan|gunanya)/i.test(lower)) requestType = 'FUNCTION';
  else if (/(syarat|persyaratan|boleh|wajib|eligible|memenuhi)/i.test(lower)) requestType = 'ELIGIBILITY';
  else if (/(cara|bagaimana|gimana|prosedur|alur|mengurus|mendaftar|daftar|registrasi|langkah)/i.test(lower)) requestType = 'PROCEDURE';

  const signals = {
    normalizedQuery: normalizedText,
    intentSignal,
    entitySignal,
    aliasSignal,
    semanticTopicSignal,
    contextSignal,
    requestPattern: requestType,
    campusHint: hasCampusContext || hasFacilityHint,
    supportServiceHint: hasSupportServiceHint,
    organizationHint: hasOrganizationHint,
    facilityHint: hasFacilityHint,
    negativeHit,
    knownEntity: entity
  };

  const confidenceScore = matched
    ? Math.min(0.99, 0.45 + (entity ? 0.2 : 0) + (hasOrganizationHint ? 0.12 : 0) + (hasSupportServiceHint ? 0.12 : 0) + (genericFacilityQuery ? 0.18 : 0) + (hasFacilityHint ? 0.12 : 0) + (hasCampusContext ? 0.08 : 0))
    : 0.12;

  return {
    matched,
    domain,
    category,
    subtype,
    entity,
    requestType,
    confidence: Number(confidenceScore.toFixed(2)),
    signals
  };
}

module.exports = { classifyCampusSupportQuery };
