'use strict';

/**
 * coverageRemediation.test.js
 *
 * Regression test suite for Phase 4B Knowledge Coverage Remediation:
 * - Scope A: Retrieval & Taxonomy Aliases (Olahraga <-> Basket/Futsal, Dual <-> Double Degree, GCCP, Pascasarjana, Konsentrasi S2)
 * - Scope B: SION Routing -> IT Domain
 * - Safety Invariants: No false positives, preservation of general fallback, authoritative answers unescalated.
 */

const { resolveEscalationTopic, routeAdminEscalation } = require('../src/engine/adminEscalationRouter');
const { normalizeQueryForRetrieval } = require('../src/engine/ragEngine');
const { normalizeUserQuery } = require('../src/utils/queryNormalizer');
const { validateChunkRelevanceToQuestion } = require('../src/engine/evidenceValidator');
const { resolveCanonicalConcept } = require('../src/engine/canonicalConceptRegistry');

describe('Phase 4B Coverage Remediation Test Suite', () => {

  const testContactOverrides = {
    academic: { phone: '0812-3456-0001' },
    finance: { phone: '0812-3456-0002' },
    student_affairs: { phone: '0812-3456-0003' },
    admission: { phone: '0812-3456-0004' },
    it: { phone: '0812-3456-0005' },
    general: { phone: '0812-3456-0000' }
  };

  describe('Scope B: SION Routing to IT Domain', () => {
    test('kendala SION routes to IT admin', () => {
      const result = resolveEscalationTopic(null, 'Saya mengalami kendala SION');
      expect(result.topic).toBe('it');
    });

    test('SION tidak bisa login routes to IT admin', () => {
      const result = resolveEscalationTopic(null, 'SION tidak bisa login');
      expect(result.topic).toBe('it');
    });

    test('SION error routes to IT admin', () => {
      const result = resolveEscalationTopic(null, 'SION error');
      expect(result.topic).toBe('it');
    });

    test('SION bermasalah routes to IT admin', () => {
      const result = resolveEscalationTopic(null, 'SION bermasalah');
      expect(result.topic).toBe('it');
    });

    test('Question 33: "Saya mengalami kendala SION, harus menghubungi siapa?" routes to IT', () => {
      const result = resolveEscalationTopic(null, 'Saya mengalami kendala SION, harus menghubungi siapa?');
      expect(result.topic).toBe('it');
      
      const escalation = routeAdminEscalation({
        rawQuery: 'Saya mengalami kendala SION, harus menghubungi siapa?',
        hasSufficientEvidence: false,
        evidenceEvaluation: { isAnswerable: false },
        contactOverrides: testContactOverrides
      });
      expect(escalation.escalated).toBe(true);
      expect(escalation.topic).toBe('it');
      expect(escalation.contact.label).toBe('Admin IT');
    });

    test('Safety: unknown non-IT query still falls back to general admin', () => {
      const result = resolveEscalationTopic(null, 'halo permisi mau info umum tentang kegiatan');
      expect(result.topic).toBe('general');
    });
  });

  describe('Scope A1: UKM Olahraga <-> Basket/Futsal Taxonomy Expansion', () => {
    test('normalizeQueryForRetrieval expands "olahraga" to basket and futsal', () => {
      const expanded = normalizeQueryForRetrieval('Apakah ada UKM bidang Olahraga?');
      expect(expanded.toLowerCase()).toContain('basket');
      expect(expanded.toLowerCase()).toContain('futsal');
      expect(expanded.toLowerCase()).toContain('ukm');
    });

    test('canonicalConceptRegistry resolves "olahraga" and "futsal" to concept_sports', () => {
      const c1 = resolveCanonicalConcept('olahraga');
      const c2 = resolveCanonicalConcept('futsal');
      const c3 = resolveCanonicalConcept('basket');
      expect(c1).not.toBeNull();
      expect(c1.id).toBe('concept_sports');
      expect(c2.id).toBe('concept_sports');
      expect(c3.id).toBe('concept_sports');
    });

    test('evidenceValidator relevance check passes basket chunk for olahraga query', () => {
      const chunk = { chunk: 'Profil UKM Basket ITB STIKOM Bali merupakan wadah kegiatan mahasiswa bola basket.' };
      const relevance = validateChunkRelevanceToQuestion(chunk, 'Apakah ada UKM bidang Olahraga?', 'GENERAL');
      expect(relevance.relevant).toBe(true);
    });
  });

  describe('Scope A2: Dual Degree <-> Double Degree Synonym Bridge', () => {
    test('normalizeUserQuery bridges "dual degree" to "double degree"', () => {
      const norm = normalizeUserQuery('Apakah ada program dual degree?');
      expect(norm.normalizedText).toContain('double degree');
    });

    test('normalizeQueryForRetrieval includes double degree when query has dual degree', () => {
      const expanded = normalizeQueryForRetrieval('Apakah ada program dual degree?');
      expect(expanded.toLowerCase()).toContain('double degree');
    });

    test('canonicalConceptRegistry maps dual degree and double degree to concept_dual_degree', () => {
      const c1 = resolveCanonicalConcept('dual degree');
      const c2 = resolveCanonicalConcept('double degree');
      expect(c1).not.toBeNull();
      expect(c1.id).toBe('concept_dual_degree');
      expect(c2.id).toBe('concept_dual_degree');
    });

    test('evidenceValidator relevance check passes double degree chunk for dual degree query', () => {
      const chunk = { chunk: 'Program Double Degree ITB STIKOM Bali bekerja sama dengan Dalian Neusoft University of Information (DNUI) China dan HELP University Malaysia.' };
      const relevance = validateChunkRelevanceToQuestion(chunk, 'Apakah ada program dual degree?', 'GENERAL');
      expect(relevance.relevant).toBe(true);
    });
  });

  describe('Scope A3: GCCP Student Exchange Expansion', () => {
    test('normalizeQueryForRetrieval expands "GCCP" to student exchange, keuntungan, and program exchange', () => {
      const expanded = normalizeQueryForRetrieval('Apa itu program GCCP dan apa keuntungannya?');
      expect(expanded.toLowerCase()).toContain('student exchange');
      expect(expanded.toLowerCase()).toContain('keuntungan');
      expect(expanded.toLowerCase()).toContain('global cross cultural program');
    });

    test('canonicalConceptRegistry maps "gccp" to concept_exchange_program', () => {
      const c = resolveCanonicalConcept('gccp');
      expect(c).not.toBeNull();
      expect(c.id).toBe('concept_exchange_program');
    });

    test('evidenceValidator relevance check passes student exchange chunk for GCCP keuntungan query', () => {
      const chunk = { chunk: 'Global Cross Cultural Program (GCCP) adalah program pertukaran budaya. Manfaat mengikuti Student Exchange adalah pengalaman internasional dan memperluas jaringan global.' };
      const relevance = validateChunkRelevanceToQuestion(chunk, 'Apa itu program GCCP dan apa keuntungannya?', 'GENERAL');
      expect(relevance.relevant).toBe(true);
    });
  });

  describe('Scope A4: Pascasarjana / S2 <-> Magister Sistem Informasi', () => {
    test('normalizeQueryForRetrieval expands "pascasarjana" to Magister Sistem Informasi and S2', () => {
      const expanded = normalizeQueryForRetrieval('Program studi apa saja di Pascasarjana?');
      expect(expanded.toLowerCase()).toContain('magister sistem informasi');
      expect(expanded.toLowerCase()).toContain('s2');
    });

    test('canonicalConceptRegistry maps pascasarjana, magister, and s2 to concept_postgraduate', () => {
      const c1 = resolveCanonicalConcept('pascasarjana');
      const c2 = resolveCanonicalConcept('s2');
      const c3 = resolveCanonicalConcept('magister');
      expect(c1).not.toBeNull();
      expect(c1.id).toBe('concept_postgraduate');
      expect(c2.id).toBe('concept_postgraduate');
      expect(c3.id).toBe('concept_postgraduate');
    });
  });

  describe('Scope A5: Konsentrasi Magister Sistem Informasi', () => {
    test('normalizeQueryForRetrieval expands "konsentrasi" to 4 research focuses', () => {
      const expanded = normalizeQueryForRetrieval('Apa saja konsentrasi Program Magister Sistem Informasi?');
      expect(expanded.toLowerCase()).toContain('data science');
      expect(expanded.toLowerCase()).toContain('cyber security');
      expect(expanded.toLowerCase()).toContain('enterprise system');
      expect(expanded.toLowerCase()).toContain('medical informatics');
    });

    test('evidenceValidator relevance check passes 4-concentration chunk for konsentrasi query', () => {
      const chunk = { chunk: 'Fokus penelitian dan konsentrasi Magister Sistem Informasi meliputi Cyber Security, Data Science, Enterprise System, dan Medical Informatics.' };
      const relevance = validateChunkRelevanceToQuestion(chunk, 'Apa saja konsentrasi Program Magister Sistem Informasi?', 'GENERAL');
      expect(relevance.relevant).toBe(true);
    });
  });

  describe('Safety & Negative Guard Tests', () => {
    test('unrelated query is not polluted with sports or pascasarjana keywords', () => {
      const expanded = normalizeQueryForRetrieval('Apakah kampus buka pada hari Minggu?');
      expect(expanded.toLowerCase()).not.toContain('basket');
      expect(expanded.toLowerCase()).not.toContain('futsal');
      expect(expanded.toLowerCase()).not.toContain('pascasarjana');
      expect(expanded.toLowerCase()).not.toContain('cyber security');
    });

    test('high confidence authoritative answer does not escalate even with taxonomy terms', () => {
      const escalation = routeAdminEscalation({
        rawQuery: 'Berapa biaya kuliah Program Magister Sistem Informasi?',
        answer: 'Biaya pendaftaran sebesar Rp 500.000 dan SPP Rp 9.000.000 per semester.',
        hasSufficientEvidence: true,
        answerConfidence: 0.95,
        evidenceEvaluation: {
          isAnswerable: true,
          evidenceCoverage: 1.0,
          contradictionCount: 0
        },
        contactOverrides: testContactOverrides
      });
      expect(escalation.escalated).toBe(false);
      expect(escalation.contact).toBeNull();
    });

    test('genuine unrelated document fails relevance check cleanly', () => {
      const chunk = { chunk: 'Tata tertib perpustakaan melarang membawa makanan dan minuman ke dalam ruang baca.' };
      const relevance = validateChunkRelevanceToQuestion(chunk, 'Apakah ada program dual degree?', 'GENERAL');
      expect(relevance.relevant).toBe(false);
    });
  });

});
