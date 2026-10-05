'use strict';

/**
 * adminContacts.js
 *
 * Centralized Contact Configuration for STIKOM Bali Admin Escalation & Human Handoff.
 *
 * Invariants:
 * 1. ZERO PHANTOM NUMBERS: Never outputs placeholder, dummy, or invented phone numbers.
 * 2. OPERATOR-CONFIGURED: Official contact numbers are populated from environment variables
 *    or operator configuration. Default phone is empty string ("").
 * 3. FAIL-CLOSED FALLBACK: If phone is missing/empty, returns label only without phantom number.
 * 4. CANONICAL TOPIC KEYS: Exactly 6 canonical topic categories:
 *    - academic: Admin Akademik
 *    - finance: Admin Keuangan
 *    - student_affairs: Admin Kemahasiswaan
 *    - admission: Admin PMB
 *    - it: Admin IT
 *    - general: Admin STIKOM Bali (Admin Umum)
 */

const CANONICAL_CONTACT_TOPICS = Object.freeze([
  'academic',
  'finance',
  'student_affairs',
  'admission',
  'it',
  'general'
]);

/**
 * Returns the centralized contact configuration dictionary.
 * Reads environment variables at runtime with operator fallback support.
 *
 * @param {object} [customOverrides] Optional operator overrides
 * @returns {Record<string, { key: string, label: string, phone: string, hasPhone: boolean }>}
 */
function getContactConfig(customOverrides = {}) {
  const env = process.env || {};

  const cleanPhone = (val) => {
    if (!val || typeof val !== 'string') return '';
    const trimmed = val.trim();
    // Guard against placeholder strings like "<KONTAK_RESMI>" or "TODO"
    if (/^[<\[]?(?:kontak[_\s]resmi|nomor[_\s]resmi|todo|dummy|none)[>\]]?$/i.test(trimmed)) {
      return '';
    }
    return trimmed;
  };

  const baseConfig = {
    academic: {
      key: 'academic',
      label: 'Admin Akademik',
      phone: cleanPhone(customOverrides.academic?.phone || env.ADMIN_CONTACT_ACADEMIC || '')
    },
    finance: {
      key: 'finance',
      label: 'Admin Keuangan',
      phone: cleanPhone(customOverrides.finance?.phone || env.ADMIN_CONTACT_FINANCE || '')
    },
    student_affairs: {
      key: 'student_affairs',
      label: 'Admin Kemahasiswaan',
      phone: cleanPhone(customOverrides.student_affairs?.phone || env.ADMIN_CONTACT_STUDENT_AFFAIRS || '')
    },
    admission: {
      key: 'admission',
      label: 'Admin PMB',
      phone: cleanPhone(customOverrides.admission?.phone || env.ADMIN_CONTACT_ADMISSION || '')
    },
    it: {
      key: 'it',
      label: 'Admin IT',
      phone: cleanPhone(customOverrides.it?.phone || env.ADMIN_CONTACT_IT || '')
    },
    general: {
      key: 'general',
      label: 'Admin STIKOM Bali',
      phone: cleanPhone(customOverrides.general?.phone || env.ADMIN_CONTACT_GENERAL || '')
    }
  };

  const finalized = {};
  for (const topic of CANONICAL_CONTACT_TOPICS) {
    const item = baseConfig[topic];
    finalized[topic] = Object.freeze({
      key: item.key,
      label: item.label,
      phone: item.phone,
      hasPhone: Boolean(item.phone && item.phone.length > 0)
    });
  }

  return Object.freeze(finalized);
}

/**
 * Retrieves the specific contact for a canonical topic key.
 * If topic is invalid, unrecognized, or missing, falls back to 'general'.
 *
 * @param {string} topicKey
 * @param {object} [customOverrides]
 * @returns {{ key: string, label: string, phone: string, hasPhone: boolean }}
 */
function getAdminContact(topicKey, customOverrides = {}) {
  const config = getContactConfig(customOverrides);
  const normalizedKey = String(topicKey || '').trim().toLowerCase();
  if (config[normalizedKey]) {
    return config[normalizedKey];
  }
  return config.general;
}

/**
 * Formats the contact call-to-action string cleanly.
 * If phone is available: "silakan hubungi [Label] di [Phone]."
 * If phone is missing: "silakan hubungi [Label]."
 *
 * @param {{ label: string, phone?: string, hasPhone?: boolean }} contact
 * @param {object} [options]
 * @returns {string} Formatted contact sentence
 */
function formatContactCallToAction(contact, options = {}) {
  const label = contact?.label || 'Admin STIKOM Bali';
  const phone = contact?.phone?.trim();
  const prefix = options.prefix || 'silakan hubungi';

  if (contact?.hasPhone && phone) {
    return `${prefix} ${label} di ${phone}.`;
  }
  return `${prefix} ${label}.`;
}

/**
 * Returns the contact configuration schema description for operator documentation.
 */
function getContactConfigSchema() {
  return {
    type: 'object',
    description: 'Centralized Administrative Escalation Contact Directory',
    topics: CANONICAL_CONTACT_TOPICS,
    envMapping: {
      academic: 'ADMIN_CONTACT_ACADEMIC',
      finance: 'ADMIN_CONTACT_FINANCE',
      student_affairs: 'ADMIN_CONTACT_STUDENT_AFFAIRS',
      admission: 'ADMIN_CONTACT_ADMISSION',
      it: 'ADMIN_CONTACT_IT',
      general: 'ADMIN_CONTACT_GENERAL'
    },
    defaultState: 'Empty string (phone numbers require operator configuration; fail-closed without hallucination)'
  };
}

module.exports = {
  CANONICAL_CONTACT_TOPICS,
  getContactConfig,
  getAdminContact,
  formatContactCallToAction,
  getContactConfigSchema
};
