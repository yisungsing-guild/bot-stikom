'use strict';

/**
 * tests/accreditationIntegrityRegression.test.js
 *
 * Work Order 1B — Accreditation Single Source of Truth Regression Suite.
 * Validates:
 * 1. All 6 study programs use the exact same canonical source (officialProgramAccreditation).
 * 2. No duplication of rank or decree numbers in academicCatalog or evidenceProviderRegistry.
 * 3. S1 TI and S1 BD answer Baik — BAN-PT with official decree numbers.
 * 4. D3 MI answers historical facts with expiration date 17 Nov 2026 and returns SAFE_UNKNOWN for current active status.
 * 5. S2 SI does not claim unproven official rank, returning SAFE_UNKNOWN.
 * 6. Generic verifier rejects conflicting ranks, false agencies, ungrounded active claims, and unproven ranks.
 * 7. Single Source of Truth dynamism: downstream consumers hydrate from canonical registry.
 * 8. Ambiguous accreditation inquiries without target prodi yield SAFE_UNKNOWN.
 */

const fs = require('fs');
const path = require('path');

const CANONICAL_FACTS_REGISTRY = require('../data/runtime/canonical_academic_facts_registry.json');

const {
  PROGRAM_ACCREDITATION_REGISTRY,
  resolveProgramAccreditationEntry,
  getProgramAccreditationFact,
  INSTITUTIONAL_ACADEMIC_CATALOG
} = require('../src/core/academicCatalog');

const {
  AcademicProgramEvidenceProvider
} = require('../src/engine/evidenceProviderRegistry');

const {
  synthesizeAnswer
} = require('../src/core/groundedAnswerGenerator');

const {
  verifyFinalAnswer
} = require('../src/core/finalAnswerVerifier');

describe('Work Order 1B — Accreditation Single Source of Truth Suite', () => {

  // Priority 5.1: Keenam program studi menggunakan sumber canonical yang sama
  test('1. All 6 study programs are defined in canonical registry and consumed uniformly', () => {
    const canonicalMap = CANONICAL_FACTS_REGISTRY.officialProgramAccreditation;
    expect(canonicalMap).toBeDefined();

    const expectedPrograms = [
      'S1 Sistem Informasi',
      'S1 Sistem Komputer',
      'S1 Teknologi Informasi',
      'S1 Bisnis Digital',
      'D3 Manajemen Informatika',
      'S2 Sistem Informasi'
    ];

    for (const prog of expectedPrograms) {
      expect(canonicalMap[prog]).toBeDefined();
      expect(PROGRAM_ACCREDITATION_REGISTRY[prog]).toBeDefined();
      expect(PROGRAM_ACCREDITATION_REGISTRY[prog].canonical).toBe(canonicalMap[prog].program);
      expect(PROGRAM_ACCREDITATION_REGISTRY[prog].rank).toBe(canonicalMap[prog].rank);
      expect(PROGRAM_ACCREDITATION_REGISTRY[prog].agency).toBe(canonicalMap[prog].agency);
      expect(PROGRAM_ACCREDITATION_REGISTRY[prog].decreeNumber).toBe(canonicalMap[prog].decreeNumber);
      expect(PROGRAM_ACCREDITATION_REGISTRY[prog].isCurrentlyActive).toBe(Boolean(canonicalMap[prog].isCurrentlyActive));
    }
  });

  // Priority 5.2: Tidak ada duplikasi peringkat atau nomor SK di modul lain
  test('2. No independent duplicate rank or decree number dictionaries in academicCatalog or evidenceProviderRegistry', () => {
    const catalogSrc = fs.readFileSync(path.join(__dirname, '../src/core/academicCatalog.js'), 'utf8');
    const providerSrc = fs.readFileSync(path.join(__dirname, '../src/engine/evidenceProviderRegistry.js'), 'utf8');

    // Neither file should have hardcoded decree literals in their definition bodies
    expect(catalogSrc).not.toContain("decreeNumber: '5908/SK/BAN-PT/Ak/S/IX/2022'");
    expect(catalogSrc).not.toContain("decreeNumber: '6794/SK/BAN-PT/Ak/S/X/2022'");
    expect(providerSrc).not.toContain("decreeNumber: '5908/SK/BAN-PT/Ak/S/IX/2022'");
    expect(providerSrc).not.toContain("decreeNumber: '6794/SK/BAN-PT/Ak/S/X/2022'");
    expect(providerSrc).not.toContain("decreeNumber: '12450/SK/BAN-PT/Akred-PMT/Dipl-III/XI/2021'");

    // Check that both files hydrate from CANONICAL_FACTS_REGISTRY.officialProgramAccreditation
    expect(catalogSrc).toContain('CANONICAL_FACTS_REGISTRY?.officialProgramAccreditation');
    expect(providerSrc).toContain('CANONICAL_FACTS_REGISTRY?.officialProgramAccreditation');
  });

  // Priority 5.3: S1 TI dan S1 BD menjawab Baik — BAN-PT
  describe('3. S1 TI and S1 BD Accreditation Answers', () => {
    test('S1 Teknologi Informasi returns Baik — BAN-PT under SK 5908', () => {
      const fact = getProgramAccreditationFact('S1 Teknologi Informasi');
      expect(fact.success).toBe(true);
      expect(fact.status).toBe('VERIFIED_ACTIVE');
      expect(fact.rank).toBe('Baik');
      expect(fact.agency).toBe('BAN-PT');
      expect(fact.decreeNumber).toBe('5908/SK/BAN-PT/Ak/S/IX/2022');
      expect(fact.isCurrentlyActive).toBe(true);
      expect(fact.answer).toContain('Baik');
      expect(fact.answer).toContain('BAN-PT');
      expect(fact.answer).toContain('5908/SK/BAN-PT/Ak/S/IX/2022');
      expect(fact.answer).not.toContain('Baik Sekali');
      expect(fact.answer).not.toContain('LAM INFOKOM');
    });

    test('S1 Bisnis Digital returns Baik — BAN-PT under SK 6794', () => {
      const fact = getProgramAccreditationFact('S1 Bisnis Digital');
      expect(fact.success).toBe(true);
      expect(fact.status).toBe('VERIFIED_ACTIVE');
      expect(fact.rank).toBe('Baik');
      expect(fact.agency).toBe('BAN-PT');
      expect(fact.decreeNumber).toBe('6794/SK/BAN-PT/Ak/S/X/2022');
      expect(fact.isCurrentlyActive).toBe(true);
      expect(fact.answer).toContain('Baik');
      expect(fact.answer).toContain('BAN-PT');
      expect(fact.answer).toContain('6794/SK/BAN-PT/Ak/S/X/2022');
      expect(fact.answer).not.toContain('Baik Sekali');
      expect(fact.answer).not.toContain('LAM INFOKOM');
    });
  });

  // Priority 5.4: D3 MI dapat menjawab fakta historis tetapi tidak mengklaim status aktif
  describe('4. D3 Manajemen Informatika Historical vs Current Status', () => {
    test('D3 MI historical query returns verified historical fact with 17 Nov 2026 expiration', () => {
      const histFact = getProgramAccreditationFact('D3 Manajemen Informatika', {
        rawQuery: 'Bagaimana status akreditasi D3 Manajemen Informatika pada periode 2021-2026?'
      });
      expect(histFact.success).toBe(true);
      expect(histFact.status).toBe('HISTORICAL_FACT');
      expect(histFact.rank).toBe('Baik');
      expect(histFact.agency).toBe('BAN-PT');
      expect(histFact.decreeNumber).toBe('12450/SK/BAN-PT/Akred-PMT/Dipl-III/XI/2021');
      expect(histFact.answer).toContain('12450/SK/BAN-PT/Akred-PMT/Dipl-III/XI/2021');
      expect(histFact.answer).toContain('17 November 2021 sampai dengan 17 November 2026');
      expect(histFact.answer).toContain('berakhir pada 17 November 2026');
    });

    test('D3 MI current accreditation inquiry returns SAFE_UNKNOWN disclosing SK expiration', () => {
      const curFact = getProgramAccreditationFact('D3 Manajemen Informatika', {
        rawQuery: 'Apa akreditasi D3 Manajemen Informatika saat ini?'
      });
      expect(curFact.success).toBe(true);
      expect(curFact.status).toBe('SAFE_UNKNOWN');
      expect(curFact.rank).toBeNull();
      expect(curFact.historicalRank).toBe('Baik');
      expect(curFact.isCurrentlyActive).toBe(false);
      expect(curFact.answer).toContain('SAFE_UNKNOWN');
      expect(curFact.answer).toContain('12450/SK/BAN-PT/Akred-PMT/Dipl-III/XI/2021');
      expect(curFact.answer).toContain('17 November 2026');
      expect(curFact.answer).toContain('mengonfirmasi langsung ke Program Studi');
    });
  });

  // Priority 5.5: S2 SI tidak mengklaim peringkat resmi yang belum dibuktikan (SAFE_UNKNOWN)
  describe('5. S2 Sistem Informasi SAFE_UNKNOWN Handling', () => {
    test('S2 SI inquiry returns SAFE_UNKNOWN without claiming unproven official rank', () => {
      const fact = getProgramAccreditationFact('S2 Sistem Informasi', {
        rawQuery: 'Apa akreditasi S2 Sistem Informasi?'
      });
      expect(fact.success).toBe(true);
      expect(fact.status).toBe('SAFE_UNKNOWN');
      expect(fact.rank).toBeNull();
      expect(fact.agency).toBeNull();
      expect(fact.decreeNumber).toBeNull();
      expect(fact.isCurrentlyActive).toBe(false);
      expect(fact.answer).toContain('SAFE_UNKNOWN');
      expect(fact.answer).toContain('belum tersedia');
      expect(fact.answer).toContain('https://pasca.stikom-bali.ac.id');
      expect(fact.answer).not.toMatch(/\bterakreditasi\s+baik\s+sekali\b/i);
    });
  });

  // Priority 5.6: Verifier menolak peringkat atau lembaga yang bertentangan
  describe('6. Generic Verifier Contradiction and Safe Unknown Gates', () => {
    test('Verifier rejects false rank (Baik Sekali) for S1 TI', () => {
      const falseAnswer = 'Program Studi S1 Teknologi Informasi terakreditasi Baik Sekali oleh BAN-PT.';
      const res = verifyFinalAnswer(
        falseAnswer,
        { rawQuery: 'Apa akreditasi S1 Teknologi Informasi?', domain: 'ACCREDITATION', aspects: ['accreditation'] },
        { accepted: [] }
      );
      expect(res.pass).toBe(false);
      expect(res.reason).toContain('contradiction_accreditation_rank');
    });

    test('Verifier rejects false agency (LAM INFOKOM) for S1 BD', () => {
      const falseAnswer = 'Program Studi S1 Bisnis Digital terakreditasi Baik oleh LAM INFOKOM.';
      const res = verifyFinalAnswer(
        falseAnswer,
        { rawQuery: 'Apa akreditasi S1 Bisnis Digital?', domain: 'ACCREDITATION', aspects: ['accreditation'] },
        { accepted: [] }
      );
      expect(res.pass).toBe(false);
      expect(res.reason).toContain('contradiction_accreditation_agency');
    });

    test('Verifier rejects ungrounded active claim for D3 MI without disclosure', () => {
      const falseAnswer = 'Program Studi D3 Manajemen Informatika saat ini aktif terakreditasi resmi Baik oleh BAN-PT.';
      const res = verifyFinalAnswer(
        falseAnswer,
        { rawQuery: 'Apa akreditasi D3 Manajemen Informatika saat ini?', domain: 'ACCREDITATION', aspects: ['accreditation'] },
        { accepted: [] }
      );
      expect(res.pass).toBe(false);
      expect([
        'unverified_active_accreditation_claim_for_expired_sk',
        'unsupported_temporal_claim_zero_evidence'
      ]).toContain(res.reason);
    });

    test('Verifier rejects assertion of official rank for S2 SI without SAFE_UNKNOWN disclosure', () => {
      const falseAnswer = 'Program Studi S2 Sistem Informasi terakreditasi Baik Sekali oleh LAM INFOKOM.';
      const res = verifyFinalAnswer(
        falseAnswer,
        { rawQuery: 'Apa akreditasi S2 Sistem Informasi?', domain: 'ACCREDITATION', aspects: ['accreditation'] },
        { accepted: [] }
      );
      expect(res.pass).toBe(false);
      expect(res.reason).toContain('unverified_accreditation_claim_without_primary_source');
    });

    test('Verifier accepts legitimate SAFE_UNKNOWN answer for S2 SI', () => {
      const safeAnswer = 'Mengenai status akreditasi resmi Program Studi **S2 Sistem Informasi** ITB STIKOM Bali, saat ini dokumen Surat Keputusan (SK) atau sertifikat akreditasi resmi dari BAN-PT maupun LAM INFOKOM belum tersedia dalam basis data resmi kami (SAFE_UNKNOWN).\n\nUntuk konfirmasi status akreditasi terkini dan dokumen penetapan resmi, silakan merujuk langsung ke laman resmi Direktorat Pascasarjana di **https://pasca.stikom-bali.ac.id** atau menghubungi sekretariat pascasarjana.';
      const res = verifyFinalAnswer(
        safeAnswer,
        { rawQuery: 'Apa akreditasi S2 Sistem Informasi?', domain: 'ACCREDITATION', aspects: ['accreditation'] },
        { accepted: [] }
      );
      expect(res.outcome).toBe('SAFE_UNKNOWN');
      expect(res.handledSafely).toBe(true);
    });
  });

  // Priority 5.7: Registry berubah dan seluruh konsumen membaca perubahan yang sama
  describe('7. Single Source of Truth Hydration Across Downstream Consumers', () => {
    test('AcademicProgramEvidenceProvider and academicCatalog reflect identical accreditation data from canonical registry', async () => {
      const provider = new AcademicProgramEvidenceProvider();
      const canonicalMap = CANONICAL_FACTS_REGISTRY.officialProgramAccreditation;

      for (const [progName, canonData] of Object.entries(canonicalMap)) {
        // 1. Check academicCatalog registry entry
        const catEntry = PROGRAM_ACCREDITATION_REGISTRY[progName];
        expect(catEntry.rank).toBe(canonData.rank);
        expect(catEntry.agency).toBe(canonData.agency);
        expect(catEntry.decreeNumber).toBe(canonData.decreeNumber);
        expect(catEntry.isCurrentlyActive).toBe(Boolean(canonData.isCurrentlyActive));

        // 2. Check evidenceProvider authoritativeSpecs
        const spec = provider.authoritativeSpecs[progName];
        expect(spec).toBeDefined();
        expect(spec.accreditation).toBe(canonData.rank);
        expect(spec.agency).toBe(canonData.agency);
        expect(spec.decreeNumber).toBe(canonData.decreeNumber);
        expect(spec.isCurrentlyActive).toBe(Boolean(canonData.isCurrentlyActive));
      }
    });
  });

  // Priority 5.8: Pertanyaan akreditasi yang ambigu menghasilkan SAFE_UNKNOWN
  describe('8. Ambiguous Accreditation Query Handling', () => {
    test('Ambiguous program accreditation inquiry yields safe clarification without target prodi', async () => {
      const res = await synthesizeAnswer(
        {
          rawQuery: 'Bagaimana status akreditasi program studi di kampus?',
          domain: 'ACCREDITATION',
          aspects: ['accreditation']
        },
        [],
        { accepted: [] }
      );

      expect(res.success).toBe(true);
      expect(res.source).toBe('canonical_accreditation_registry');
      expect(res.status).toBe('AMBIGUOUS_PROGRAM_SAFE_UNKNOWN');
      expect(res.answer).toContain('Mohon informasikan program studi mana yang ingin Kakak ketahui akreditasinya');
      expect(res.answer).toContain('S1 Sistem Informasi');
      expect(res.answer).toContain('S1 Teknologi Informasi');
    });

    test('Institutional accreditation inquiry returns verified institutional SK', async () => {
      const res = await synthesizeAnswer(
        {
          rawQuery: 'Apa akreditasi institusi ITB STIKOM Bali?',
          domain: 'ACCREDITATION',
          aspects: ['accreditation']
        },
        [],
        { accepted: [] }
      );

      expect(res.success).toBe(true);
      expect(res.source).toBe('canonical_accreditation_registry');
      expect(res.status).toBe('INSTITUTIONAL_ACCREDITATION');
      expect(res.answer).toContain('Baik Sekali');
      expect(res.answer).toContain('3033/SK/BAN-PT/Ak.KP/PT/XII/2025');
      expect(res.answer).toContain('14 November 2028');
    });
  });
});
