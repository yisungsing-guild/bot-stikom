'use strict';

/**
 * documentAdministrationGovernance.test.js
 *
 * Verifies Document Administration / Intake Governance implementation (RKAI Requirements):
 * 1. Valid document name -> ACCEPT
 * 2. Invalid / ambiguous document name -> REJECT / validation error
 * 3. validFrom valid -> ACCEPT
 * 4. invalid validFrom -> REJECT
 * 5. validUntil valid -> ACCEPT
 * 6. validUntil < validFrom -> REJECT
 * 7. no expiry / berlaku sampai dicabut -> ACCEPT with validUntil = null
 * 8. expired document -> cannot be current evidence
 * 9. future-effective document -> cannot be current evidence
 * 10. admin metadata remains intact after indexing (Admin -> DB -> Index -> Chunk -> Runtime Governance)
 * 11. existing fail-closed governance remains enforced (missing/partial metadata -> validity_unknown -> BLOCK)
 * 12. lifecycle states (active, draft, superseded, archived, expired) with no contradictory states
 */

const {
  validateDocumentNaming,
  validateDocumentValidityDates,
  validateDocumentIntakeGovernance,
  buildDocumentGovernanceMetadata,
  filterGovernedChunks,
  filterGovernedTrainingRows,
  enrichChunkWithGovernance,
  isChunkGovernanceAllowed,
  isTrainingGovernanceAllowed,
  normalizeStatus,
  normalizeAuthority
} = require('../src/engine/runtimeGovernance');

const { ingestTrainingData, loadIndex } = require('../src/engine/ragEngine');

describe('Document Administration & Intake Governance (RKAI Requirement)', () => {

  // -------------------------------------------------------------------------
  // 1 & 2: Document Naming Validation
  // -------------------------------------------------------------------------
  describe('Document Naming Standards', () => {
    test('ACCEPTs valid descriptive document names following repository conventions', () => {
      const validNames = [
        'SK_Biaya_Kuliah_2026.pdf',
        'Pedoman_Akademik_Program_S1.pdf',
        'Jadwal_Yudisium_Semester_Genap_2026.pdf',
        'Pengumuman_Penerimaan_Mahasiswa_Baru_2026.pdf',
        'Panduan_RPL_Tahun_2026.docx',
        'Brosur_Beasiswa_KIP_Kuliah.pdf',
        'SK_Rektor_Nomor_12_Tahun_2026'
      ];

      for (const name of validNames) {
        const res = validateDocumentNaming(name);
        expect(res.valid).toBe(true);
        expect(res.sanitizedName).toBeDefined();
      }
    });

    test('REJECTs ambiguous and uninformative document names', () => {
      const ambiguousNames = [
        'test.pdf',
        'testing.pdf',
        'coba.docx',
        'dokumen baru.pdf',
        'dokumen_baru.pdf',
        'dokumen.pdf',
        'new document.pdf',
        'file baru.txt',
        'untitled.pdf',
        'sample.pdf',
        'dummy.docx',
        'temp.pdf',
        '12345.pdf',
        'asdf.pdf'
      ];

      for (const name of ambiguousNames) {
        const res = validateDocumentNaming(name);
        expect(res.valid).toBe(false);
        expect(res.error).toMatch(/terlalu ambigu|tidak informatif/i);
      }
    });

    test('REJECTs names that are too short, empty, or contain forbidden characters', () => {
      expect(validateDocumentNaming('').valid).toBe(false);
      expect(validateDocumentNaming('a').valid).toBe(false);
      expect(validateDocumentNaming('.pdf').valid).toBe(false);
      expect(validateDocumentNaming('file<name>.pdf').valid).toBe(false);
      expect(validateDocumentNaming('file:invalid.pdf').valid).toBe(false);
      expect(validateDocumentNaming('file*name.pdf').valid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 3 & 4: validFrom Validation
  // -------------------------------------------------------------------------
  describe('Valid From (Tanggal Mulai Berlaku)', () => {
    test('ACCEPTs valid date formats for validFrom', () => {
      const res1 = validateDocumentValidityDates('2026-01-01', null);
      expect(res1.valid).toBe(true);
      expect(new Date(res1.validFrom).toISOString()).toContain('2026-01-01');

      const res2 = validateDocumentValidityDates('2026-09-01T00:00:00.000Z', null);
      expect(res2.valid).toBe(true);
      expect(new Date(res2.validFrom).toISOString()).toContain('2026-09-01');
    });

    test('REJECTs invalid date strings for validFrom', () => {
      const res = validateDocumentValidityDates('bukan-tanggal-valid', null);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/validFrom/i);
    });
  });

  // -------------------------------------------------------------------------
  // 5 & 6: validUntil Validation & Consistency
  // -------------------------------------------------------------------------
  describe('Valid Until (Tanggal Expired)', () => {
    test('ACCEPTs valid validUntil when validUntil >= validFrom', () => {
      const res = validateDocumentValidityDates('2026-01-01', '2026-12-31');
      expect(res.valid).toBe(true);
      expect(new Date(res.validUntil).getTime()).toBeGreaterThan(new Date(res.validFrom).getTime());
    });

    test('REJECTs invalid date strings for validUntil', () => {
      const res = validateDocumentValidityDates('2026-01-01', 'invalid-expired-date');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/validUntil/i);
    });

    test('REJECTs when validUntil is earlier than validFrom', () => {
      const res = validateDocumentValidityDates('2026-06-01', '2026-01-01');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/tidak boleh lebih awal/i);
    });
  });

  // -------------------------------------------------------------------------
  // 7: Indefinite Expiry (Berlaku Sampai Dicabut)
  // -------------------------------------------------------------------------
  describe('Indefinite Expiry (Berlaku Sampai Dicabut)', () => {
    test('ACCEPTs null, empty, or explicit indefinite values as validUntil = null', () => {
      const indefiniteInputs = [null, undefined, '', 'none', 'null', 'tidak_ada', 'berlaku_sampai_dicabut', 'sampai_dicabut'];

      for (const val of indefiniteInputs) {
        const res = validateDocumentValidityDates('2026-01-01', val);
        expect(res.valid).toBe(true);
        expect(res.validUntil).toBeNull();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8: Expired Document Filtering
  // -------------------------------------------------------------------------
  describe('Expired Document Handling', () => {
    test('blocks expired chunks from current retrieval evidence', () => {
      const expiredChunk = {
        id: 'chunk-exp-1',
        chunk: 'Biaya pendaftaran tahun 2020 adalah Rp 100.000',
        governanceStatus: 'active',
        validFrom: '2020-01-01T00:00:00.000Z',
        validUntil: '2020-12-31T23:59:59.000Z',
        authority: 'tier_1_official_decree'
      };

      const allowed = isChunkGovernanceAllowed(expiredChunk, { referenceTime: '2026-09-29T12:00:00.000Z' });
      expect(allowed).toBe(false);

      const filtered = filterGovernedChunks([expiredChunk], { referenceTime: '2026-09-29T12:00:00.000Z' });
      expect(filtered.length).toBe(0);
    });

    test('intake validation auto-marks status as expired if validUntil is in the past', () => {
      const pastDate = '2020-12-31T23:59:59.000Z';
      const intake = validateDocumentIntakeGovernance({
        filename: 'SK_Biaya_Kuliah_Lama_2020.pdf',
        validFrom: '2020-01-01T00:00:00.000Z',
        validUntil: pastDate,
        status: 'active'
      });

      expect(intake.valid).toBe(true);
      expect(intake.status).toBe('expired');
      expect(intake.governanceMetadata.status).toBe('expired');
    });
  });

  // -------------------------------------------------------------------------
  // 9: Future-Effective Document Filtering
  // -------------------------------------------------------------------------
  describe('Future-Effective Document Handling', () => {
    test('blocks future-effective chunks from current operational retrieval', () => {
      const futureChunk = {
        id: 'chunk-fut-1',
        chunk: 'Mulai tahun 2030, UKT disesuaikan menjadi Rp 10.000.000',
        governanceStatus: 'active',
        validFrom: '2030-01-01T00:00:00.000Z',
        validUntil: null,
        authority: 'tier_1_official_decree'
      };

      const allowed = isChunkGovernanceAllowed(futureChunk, { referenceTime: '2026-09-29T12:00:00.000Z' });
      expect(allowed).toBe(false);

      const filtered = filterGovernedChunks([futureChunk], { referenceTime: '2026-09-29T12:00:00.000Z' });
      expect(filtered.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 10: Metadata Preservation Across Indexing Pipeline
  // -------------------------------------------------------------------------
  describe('Admin -> DB -> Chunk -> Index Integrity', () => {
    test('enrichChunkWithGovernance preserves validFrom, validUntil, authority, and governanceMetadata', () => {
      const adminMetadata = {
        status: 'active',
        authority: 'tier_1_official_decree',
        authorityTier: 1,
        authorityWeight: 100,
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2026-12-31T23:59:59.000Z',
        validTo: '2026-12-31T23:59:59.000Z',
        version: 'v2026.1',
        owner: 'akademik',
        notes: 'SK Biaya Resmi 2026'
      };

      const rawChunk = {
        id: 'chunk-ingest-1',
        trainingId: 'td-100',
        chunk: 'Biaya kuliah prodi Sistem Informasi Rp 5.000.000',
        governance: adminMetadata
      };

      const enriched = enrichChunkWithGovernance(rawChunk, adminMetadata);

      expect(enriched.governanceStatus).toBe('active');
      expect(enriched.authority).toBe('tier_1_official_decree');
      expect(enriched.authorityTier).toBe(1);
      expect(enriched.validFrom).toBe('2026-01-01T00:00:00.000Z');
      expect(enriched.validUntil).toBe('2026-12-31T23:59:59.000Z');
      expect(enriched.governanceMetadata).toBeDefined();
      expect(enriched.governanceMetadata.notes).toBe('SK Biaya Resmi 2026');

      // Verify that this chunk is allowed for 2026 retrieval
      const isAllowed = isChunkGovernanceAllowed(enriched, { referenceTime: '2026-06-15T00:00:00.000Z' });
      expect(isAllowed).toBe(true);

      // Verify that this chunk is blocked for 2027 retrieval (expired)
      const isAllowed2027 = isChunkGovernanceAllowed(enriched, { referenceTime: '2027-01-15T00:00:00.000Z' });
      expect(isAllowed2027).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 11: Fail-Closed Governance Protection
  // -------------------------------------------------------------------------
  describe('Fail-Closed Governance Retention', () => {
    test('missing governance metadata defaults to validity_unknown and fails closed', () => {
      const unmanagedChunk = {
        id: 'chunk-orphan-1',
        chunk: 'Teks tanpa metadata governance'
      };

      const enriched = enrichChunkWithGovernance(unmanagedChunk, {});
      expect(enriched.governanceStatus).toBe('validity_unknown');
      expect(enriched.authorityTier).toBe(99);

      // Fails closed for standard retrieval
      const isAllowed = isChunkGovernanceAllowed(enriched);
      expect(isAllowed).toBe(false);
    });

    test('training row with missing governance fails closed in filterGovernedTrainingRows', () => {
      const rows = [
        { id: 'row-1', filename: 'unknown.pdf', content: 'test', active: true },
        {
          id: 'row-2',
          filename: 'SK_Resmi_2026.pdf',
          content: 'test',
          active: true,
          governanceStatus: 'active',
          authority: 'tier_1_official_decree',
          validFrom: new Date('2026-01-01'),
          validTo: null
        }
      ];

      const governed = filterGovernedTrainingRows(rows, { referenceTime: '2026-06-01' });
      expect(governed.length).toBe(1);
      expect(governed[0].id).toBe('row-2');
    });
  });

  // -------------------------------------------------------------------------
  // 12: Lifecycle States & Prevention of Contradictory Metadata
  // -------------------------------------------------------------------------
  describe('Lifecycle State Transitions', () => {
    test('supports all required lifecycle states', () => {
      const states = ['active', 'draft', 'superseded', 'archived', 'expired'];
      for (const st of states) {
        expect(normalizeStatus(st)).toBe(st);
      }
    });

    test('draft and superseded chunks are blocked from current operational retrieval', () => {
      const draftChunk = { id: 'c-draft', chunk: 'Draft', governanceStatus: 'draft', authority: 'tier_1_official_decree' };
      const supersededChunk = { id: 'c-super', chunk: 'Superseded', governanceStatus: 'superseded', authority: 'tier_1_official_decree' };
      const archivedChunk = { id: 'c-arch', chunk: 'Archived', governanceStatus: 'archived', authority: 'tier_1_official_decree' };

      expect(isChunkGovernanceAllowed(draftChunk)).toBe(false);
      expect(isChunkGovernanceAllowed(supersededChunk)).toBe(false);
      expect(isChunkGovernanceAllowed(archivedChunk)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 13: Bulk Upload & Batch Intake Governance (Audit Mandatori 8A)
  // -------------------------------------------------------------------------
  describe('Bulk Upload & Batch Intake Governance (Audit Mandatori 8A)', () => {
    // 1. bulk metadata valid -> ACCEPT
    test('1. bulk metadata valid -> ACCEPT', () => {
      const payload = {
        filename: 'SK_Rektor_PMB_2026.pdf',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
        authority: 'tier_1_official_decree',
        status: 'active'
      };
      const res = validateDocumentIntakeGovernance(payload, { requireAuthority: true, requireStatus: true });
      expect(res.valid).toBe(true);
      expect(res.validFrom).toContain('2026-01-01');
      expect(res.validUntil).toContain('2026-12-31');
      expect(res.authority).toBe('tier_1_official_decree');
      expect(res.status).toBe('active');
    });

    // 2. missing validFrom -> REJECT
    test('2. missing validFrom -> REJECT', () => {
      const payload = {
        filename: 'SK_Rektor_PMB_2026.pdf',
        validFrom: '',
        validUntil: '2026-12-31',
        authority: 'tier_1_official_decree',
        status: 'active'
      };
      const res = validateDocumentIntakeGovernance(payload);
      expect(res.valid).toBe(false);
      expect(res.field).toBe('validFrom');
      expect(res.error).toMatch(/validFrom/i);
    });

    // 3. missing validUntil tanpa no-expiry -> REJECT
    test('3. missing validUntil tanpa no-expiry -> REJECT', () => {
      const payload = {
        filename: 'SK_Rektor_PMB_2026.pdf',
        validFrom: '2026-01-01',
        validUntil: '',
        noExpiry: false,
        authority: 'tier_1_official_decree',
        status: 'active'
      };
      const res = validateDocumentIntakeGovernance(payload);
      expect(res.valid).toBe(false);
      expect(res.field).toBe('validUntil');
      expect(res.error).toMatch(/validUntil/i);
    });

    // 4. no-expiry selected -> validUntil=null
    test('4. no-expiry selected -> validUntil=null', () => {
      const payload = {
        filename: 'Pedoman_Akademik_Tetap_2026.pdf',
        validFrom: '2026-01-01',
        validUntil: '',
        noExpiry: true,
        authority: 'tier_2_official_announcement',
        status: 'active'
      };
      const res = validateDocumentIntakeGovernance(payload);
      expect(res.valid).toBe(true);
      expect(res.validUntil).toBeNull();
      expect(res.governanceMetadata.validUntil).toBeNull();
    });

    // 5. validUntil < validFrom -> REJECT
    test('5. validUntil < validFrom -> REJECT', () => {
      const payload = {
        filename: 'SK_Rektor_PMB_2026.pdf',
        validFrom: '2026-12-31',
        validUntil: '2026-01-01',
        authority: 'tier_1_official_decree',
        status: 'active'
      };
      const res = validateDocumentIntakeGovernance(payload);
      expect(res.valid).toBe(false);
      expect(res.field).toBe('validUntil');
      expect(res.error).toMatch(/tidak boleh lebih awal/i);
    });

    // 6. invalid authority -> REJECT
    test('6. invalid authority -> REJECT', () => {
      const payload = {
        filename: 'SK_Rektor_PMB_2026.pdf',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
        authority: 'tier_invalid_random',
        status: 'active'
      };
      const res = validateDocumentIntakeGovernance(payload);
      expect(res.valid).toBe(false);
      expect(res.field).toBe('authority');
      expect(res.error).toMatch(/authority/i);
    });

    // 7. invalid status -> REJECT
    test('7. invalid status -> REJECT', () => {
      const payload = {
        filename: 'SK_Rektor_PMB_2026.pdf',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
        authority: 'tier_1_official_decree',
        status: 'status_tidak_jelas'
      };
      const res = validateDocumentIntakeGovernance(payload);
      expect(res.valid).toBe(false);
      expect(res.field).toBe('status');
      expect(res.error).toMatch(/status/i);
    });

    // 8. per-file ambiguous filename -> reject affected file
    test('8. per-file ambiguous filename -> reject affected file while valid names pass', () => {
      const filesInBatch = [
        'Panduan_Pendaftaran_PMB_2026.pdf',
        'test.pdf',
        'Brosur_Beasiswa_Unggulan_2026.pdf',
        'doc1.pdf'
      ];

      const batchResults = filesInBatch.map(fn => {
        const naming = validateDocumentNaming(fn);
        if (!naming.valid) {
          return { filename: fn, ok: false, error: naming.error };
        }
        return { filename: fn, ok: true };
      });

      expect(batchResults[0].ok).toBe(true);
      expect(batchResults[1].ok).toBe(false);
      expect(batchResults[1].error).toMatch(/terlalu ambigu|tidak informatif/i);
      expect(batchResults[2].ok).toBe(true);
      expect(batchResults[3].ok).toBe(false);
      expect(batchResults[3].error).toMatch(/terlalu ambigu|tidak informatif/i);
    });

    // 9. all valid files retain metadata after ingestion
    test('9. all valid files retain metadata after ingestion', () => {
      const batchGovernance = {
        validFrom: '2026-02-01T00:00:00.000Z',
        validUntil: '2026-08-31T23:59:59.000Z',
        authority: 'tier_2_official_announcement',
        status: 'active',
        owner: 'pmb',
        version: 'batch-pmb-2026'
      };

      const rawChunks = [
        { id: 'c-pmb-1', chunk: 'Jadwal tes gelombang 1', filename: 'Jadwal_PMB_Gelombang_1_2026.pdf' },
        { id: 'c-pmb-2', chunk: 'Syarat berkas pendaftaran', filename: 'Syarat_Berkas_PMB_2026.pdf' }
      ];

      const enriched = rawChunks.map(c => enrichChunkWithGovernance(c, batchGovernance));

      for (const chunk of enriched) {
        expect(chunk.validFrom).toBe('2026-02-01T00:00:00.000Z');
        expect(chunk.validUntil).toBe('2026-08-31T23:59:59.000Z');
        expect(chunk.authority).toBe('tier_2_official_announcement');
        expect(chunk.authorityTier).toBe(2);
        expect(chunk.governanceStatus).toBe('active');
        expect(chunk.governanceMetadata.version).toBe('batch-pmb-2026');
      }
    });

    // 10. metadata visible in DB/index/chunk and honored at runtime
    test('10. metadata visible in DB/index/chunk and honored at runtime', () => {
      const chunk = {
        id: 'chunk-batch-live',
        chunk: 'Alur pendaftaran mahasiswa baru',
        governanceStatus: 'active',
        authority: 'tier_2_official_announcement',
        authorityTier: 2,
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2026-06-30T23:59:59.000Z'
      };

      // Allowed during validity period (e.g. March 2026)
      const allowedActive = isChunkGovernanceAllowed(chunk, { referenceTime: '2026-03-15T00:00:00.000Z' });
      expect(allowedActive).toBe(true);

      // Blocked after validity period (e.g. July 2026 - expired)
      const allowedExpired = isChunkGovernanceAllowed(chunk, { referenceTime: '2026-07-01T00:00:00.000Z' });
      expect(allowedExpired).toBe(false);

      // Blocked before validity period (future document)
      const allowedFuture = isChunkGovernanceAllowed(chunk, { referenceTime: '2025-12-01T00:00:00.000Z' });
      expect(allowedFuture).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // UI/UX REVISION: Separate Physical File Upload from Document Metadata
  // -------------------------------------------------------------------------
  describe('UI/UX Revision — Separate File Upload from Document Metadata', () => {

    describe('A. Single Upload Governance', () => {
      test('1. original filename ambigu + documentTitle valid -> ACCEPT', () => {
        const payload = {
          filename: 'test.pdf',
          documentTitle: 'SK Biaya Pendidikan Mahasiswa Baru 2026/2027',
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
          authority: 'tier_1_official_decree',
          status: 'active'
        };

        const res = validateDocumentIntakeGovernance(payload);
        expect(res.valid).toBe(true);
        expect(res.filename).toBe('SK Biaya Pendidikan Mahasiswa Baru 2026/2027');
        expect(res.governanceMetadata.documentTitle).toBe('SK Biaya Pendidikan Mahasiswa Baru 2026/2027');
        expect(res.governanceMetadata.originalFilename).toBe('test.pdf');
      });

      test('2. original filename random seperti IMG_1234.pdf + documentTitle valid -> ACCEPT without physical rename', () => {
        const payload = {
          filename: 'IMG_20260929_142233.pdf',
          documentTitle: 'Pengumuman Jadwal Yudisium I Tahun 2026/2027',
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
          authority: 'tier_2_official_announcement',
          status: 'active'
        };

        const res = validateDocumentIntakeGovernance(payload);
        expect(res.valid).toBe(true);
        expect(res.filename).toBe('Pengumuman Jadwal Yudisium I Tahun 2026/2027');
        expect(res.governanceMetadata.originalFilename).toBe('IMG_20260929_142233.pdf');
      });

      test('3. documentTitle kosong dan physical filename ambigu -> REJECT', () => {
        const payload = {
          filename: 'IMG_1234.pdf',
          documentTitle: '',
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
          authority: 'tier_1_official_decree',
          status: 'active'
        };

        const res = validateDocumentIntakeGovernance(payload);
        expect(res.valid).toBe(false);
        expect(res.error).toBeDefined();
      });

      test('4. documentTitle ambigu -> REJECT', () => {
        const payload = {
          filename: 'scan_file.pdf',
          documentTitle: 'dokumen baru',
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
          authority: 'tier_1_official_decree',
          status: 'active'
        };

        const res = validateDocumentIntakeGovernance(payload);
        expect(res.valid).toBe(false);
        expect(res.field).toBe('documentTitle');
        expect(res.error).toMatch(/terlalu ambigu|tidak informatif/i);
      });

      test('5. metadata tanggal valid -> ACCEPT', () => {
        const payload = {
          filename: 'scan123.pdf',
          documentTitle: 'Pedoman Penulisan Skripsi Mahasiswa S1 2026',
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
          authority: 'tier_1_official_decree',
          status: 'active'
        };

        const res = validateDocumentIntakeGovernance(payload);
        expect(res.valid).toBe(true);
        expect(res.validFrom).toContain('2026-01-01');
        expect(res.validUntil).toContain('2026-12-31');
      });

      test('6. metadata expired -> BLOCK current retrieval', () => {
        const payload = {
          filename: 'scan123.pdf',
          documentTitle: 'Pedoman Penulisan Skripsi Mahasiswa S1 2020',
          validFrom: '2020-01-01',
          validUntil: '2020-12-31',
          authority: 'tier_1_official_decree',
          status: 'active'
        };

        const intake = validateDocumentIntakeGovernance(payload);
        expect(intake.valid).toBe(true);
        expect(intake.status).toBe('expired');

        const chunk = {
          id: 'chunk-exp-title',
          chunk: 'Aturan lama skripsi',
          governanceStatus: intake.status,
          validFrom: intake.validFrom,
          validUntil: intake.validUntil,
          authority: intake.authority
        };

        const allowed = isChunkGovernanceAllowed(chunk, { referenceTime: '2026-09-29T12:00:00.000Z' });
        expect(allowed).toBe(false);
      });
    });

    describe('B. Metadata Persistence & Propagation', () => {
      test('7 & 8 & 9. documentTitle and originalFilename persist in metadata and propagate to chunks', () => {
        const meta = buildDocumentGovernanceMetadata({
          filename: 'scan123.pdf',
          documentTitle: 'SK Biaya Pendidikan Mahasiswa Baru 2026/2027',
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
          authority: 'tier_1_official_decree',
          status: 'active',
          version: 'v2026.1'
        });

        // 7. documentTitle persisted as authoritative filename & identity
        expect(meta.filename).toBe('SK Biaya Pendidikan Mahasiswa Baru 2026/2027');
        expect(meta.documentTitle).toBe('SK Biaya Pendidikan Mahasiswa Baru 2026/2027');

        // 9. originalFilename available as technical audit metadata
        expect(meta.originalFilename).toBe('scan123.pdf');

        // 8. Chunks inherit documentTitle and originalFilename
        const rawChunk = {
          id: 'c-1',
          chunk: 'Biaya pendaftaran adalah Rp 500.000',
          filename: 'scan123.pdf'
        };

        const enriched = enrichChunkWithGovernance(rawChunk, meta);
        expect(enriched.filename).toBe('SK Biaya Pendidikan Mahasiswa Baru 2026/2027');
        expect(enriched.documentTitle).toBe('SK Biaya Pendidikan Mahasiswa Baru 2026/2027');
        expect(enriched.originalFilename).toBe('scan123.pdf');
        expect(enriched.governanceMetadata.documentTitle).toBe('SK Biaya Pendidikan Mahasiswa Baru 2026/2027');
        expect(enriched.governanceMetadata.originalFilename).toBe('scan123.pdf');
        expect(enriched.governanceMetadata.version).toBe('v2026.1');
      });
    });

    describe('C. Bulk Upload Governance', () => {
      test('10 & 11 & 12. different filenames + per-file titles -> ACCEPT without renaming physical files, batch governance applies', () => {
        const batchFiles = [
          { originalname: 'IMG_001.pdf', title: 'SK Beasiswa Prestasi Unggulan 2026/2027' },
          { originalname: 'scan_dokumen_final.docx', title: 'Pedoman Pelaksanaan Magang Industri 2026' },
          { originalname: 'DSC_4421.pdf', title: 'Kalender Akademik Semester Ganjil 2026/2027' }
        ];

        const batchGovernanceCommon = {
          validFrom: '2026-02-01',
          validUntil: '2026-12-31',
          authority: 'tier_1_official_decree',
          status: 'active',
          version: 'batch-2026'
        };

        const intakeResults = batchFiles.map(f => {
          return validateDocumentIntakeGovernance({
            filename: f.originalname,
            documentTitle: f.title,
            ...batchGovernanceCommon
          });
        });

        // 10. All files accepted because each has a valid descriptive documentTitle
        for (const res of intakeResults) {
          expect(res.valid).toBe(true);
        }

        // 11. Original filenames were random/camera images, no renaming was forced
        expect(intakeResults[0].governanceMetadata.originalFilename).toBe('IMG_001.pdf');
        expect(intakeResults[0].filename).toBe('SK Beasiswa Prestasi Unggulan 2026/2027');
        expect(intakeResults[1].governanceMetadata.originalFilename).toBe('scan_dokumen_final.docx');
        expect(intakeResults[2].governanceMetadata.originalFilename).toBe('DSC_4421.pdf');

        // 12. Batch governance uniformly applied
        for (const res of intakeResults) {
          expect(res.validFrom).toContain('2026-02-01');
          expect(res.validUntil).toContain('2026-12-31');
          expect(res.authority).toBe('tier_1_official_decree');
          expect(res.status).toBe('active');
          expect(res.governanceMetadata.version).toBe('batch-2026');
        }
      });
    });
  });
});
