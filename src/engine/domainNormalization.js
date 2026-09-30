'use strict';

/**
 * Centralized Canonical Domain Normalization Boundary
 *
 * Ensures all components (queryUnderstanding, contextAuthority, semanticFrame,
 * semanticContract, semanticRagEngine) operate on identical canonical domain values.
 */
const DOMAIN_ALIASES = Object.freeze({
  facility: 'campus_facility',
  facilities: 'campus_facility',
  'campus facility': 'campus_facility',
  'fasilitas kampus': 'campus_facility',
  fasilitas: 'campus_facility',
  foreign_student_admin: 'international_admin',
  'international admin': 'international_admin',
  'foreign student admin': 'international_admin',
  tuition: 'fee',
  ukm: 'student_organization',
  extracurricular: 'student_organization',
  organization: 'student_organization',
  pmb_requirements: 'registration',
  pmb_procedure: 'registration',
  pmb_how: 'registration',
  pmb: 'registration',
  schedule: 'pmb_schedule',
  institution_history: 'institution_profile',
  institution: 'institution_profile',
  curriculum: 'program_curriculum'
});

function normalizeCanonicalDomain(domain) {
  if (!domain) return 'general';
  const key = String(domain).trim().toLowerCase();
  return DOMAIN_ALIASES[key] || key;
}

module.exports = {
  DOMAIN_ALIASES,
  normalizeCanonicalDomain
};
