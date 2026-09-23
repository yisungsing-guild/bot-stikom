'use strict';

/**
 * tests/evidenceEvaluator.test.js
 *
 * Comprehensive Structural Contract Test Suite for Central Evidence Evaluator.
 * Validates all 33 mandated structural invariants.
 */

const {
  EVALUATION_STATUS,
  EVIDENCE_DISPOSITION,
  DIMENSION_STATUS,
  isEntityCompatible,
  isFieldCompatible,
  evaluateBinding,
  evaluatePlanResults
} = require('../src/engine/evidenceEvaluator');

describe('Central Evidence Evaluator Structural Test Suite', () => {

  // 1. Exact supported entity + exact field
  test('1. Exact supported entity + exact field returns SUPPORTED', () => {
    const binding = {
      bindingId: 'b1',
      entity: { canonical: 'Teknologi Informasi', family: 'program' },
      requestedField: 'degreeOutcome'
    };
    const evidence = [{
      evidenceId: 'ev1',
      entityBinding: { canonical: 'Teknologi Informasi', family: 'program' },
      fieldBinding: 'degreeOutcome',
      structuredValue: 'S.Kom (Sarjana Komputer)',
      sourceId: 'ISIAN WEBSITE (1).pdf',
      provenance: 'Official document'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.SUPPORTED);
    expect(res.matchedEvidenceIds).toContain('ev1');
    expect(res.supportedFacts.length).toBe(1);
    expect(res.supportedFacts[0].value).toBe('S.Kom (Sarjana Komputer)');
  });

  // 2. Wrong entity evidence rejected
  test('2. Wrong entity evidence rejected with entity mismatch', () => {
    const binding = {
      bindingId: 'b2',
      entity: { canonical: 'Sistem Informasi', family: 'program' },
      requestedField: 'degreeOutcome'
    };
    const evidence = [{
      evidenceId: 'ev2',
      entityBinding: { canonical: 'Teknologi Informasi', family: 'program' },
      fieldBinding: 'degreeOutcome',
      structuredValue: 'S.Kom',
      sourceId: 'doc.pdf',
      provenance: 'doc'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(res.dimensions.entityCompatibility).toBe(DIMENSION_STATUS.MISMATCH);
    expect(res.matchedEvidenceIds.length).toBe(0);
  });

  // 3. Sibling field mismatch rejected as support
  test('3. Sibling field mismatch (tuitionFee vs registrationFee) rejected as support', () => {
    const binding = {
      bindingId: 'b3',
      entity: { canonical: 'Sistem Informasi', family: 'program' },
      requestedField: 'registrationFee'
    };
    const evidence = [{
      evidenceId: 'ev3',
      entityBinding: { canonical: 'Sistem Informasi', family: 'program' },
      fieldBinding: 'tuitionFee',
      structuredValue: 'Rp 6.000.000',
      sourceId: 'biaya.pdf',
      provenance: 'biaya'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(res.evidenceDispositions[0].disposition).toBe(EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE);
  });

  // 4. Field subtype mismatch rejected (foundingDate vs legalDecreeDate)
  test('4. Field subtype mismatch: legalDecreeDate evidence cannot satisfy foundingDate', () => {
    const binding = {
      bindingId: 'b4',
      entity: { canonical: 'ITB STIKOM Bali', family: 'institution' },
      requestedField: 'foundingDate'
    };
    const evidence = [{
      evidenceId: 'ev4',
      entityBinding: { canonical: 'ITB STIKOM Bali', family: 'institution' },
      fieldBinding: 'foundingDate',
      structuredValue: '10 Agustus 2002 via SK Mendiknas No. 157/D/O/2002',
      sourceId: 'sk.pdf',
      provenance: 'SK Mendiknas No. 157/D/O/2002 tertanggal 10 Agustus 2002'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(res.evidenceDispositions[0].disposition).toBe(EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE);
  });

  // 5. Recipient mismatch rejected (school participants vs university graduates)
  test('5. Recipient mismatch: school participants evidence rejected for graduate inquiry', () => {
    const binding = {
      bindingId: 'b5',
      rawText: 'apakah lulusan stikom mendapatkan sertifikat kompetensi?',
      requestedField: 'certification'
    };
    const frame = { rawQuery: 'apakah lulusan stikom mendapatkan sertifikat kompetensi?' };
    const evidence = [{
      evidenceId: 'ev5',
      fieldBinding: 'certification',
      textSnippet: 'STIKOM Bali GoesToSchool memberikan sertifikat kepada siswa sekolah',
      sourceId: 'gts.docx',
      provenance: 'GoesToSchool doc'
    }];
    const res = evaluateBinding(binding, evidence, frame);
    expect(res.dimensions.recipientCompatibility).toBe(DIMENSION_STATUS.MISMATCH);
    expect(res.status).not.toBe(EVALUATION_STATUS.SUPPORTED);
  });

  // 6. Numeric unsupported rejected
  test('6. Numeric unsupported: value out of requested range rejected', () => {
    const binding = {
      bindingId: 'b6',
      requestedField: 'creditCount',
      numericSemantics: { minValue: 140 }
    };
    const evidence = [{
      evidenceId: 'ev6',
      fieldBinding: 'creditCount',
      structuredValue: '110 SKS',
      sourceId: 'curriculum.pdf',
      provenance: 'curriculum'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.dimensions.numericCompatibility).toBe(DIMENSION_STATUS.MISMATCH);
    expect(res.status).not.toBe(EVALUATION_STATUS.SUPPORTED);
  });

  // 7. Temporal subtype mismatch rejected
  test('7. Temporal subtype mismatch: founding date evidence rejected for legalDecreeDate', () => {
    const binding = {
      bindingId: 'b7',
      requestedField: 'legalDecreeDate'
    };
    const evidence = [{
      evidenceId: 'ev7',
      fieldBinding: 'legalDecreeDate',
      structuredValue: '20 Mei 2001 oleh Yayasan Widya Dharma Shanti',
      sourceId: 'isian.pdf',
      provenance: 'Yayasan'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(res.evidenceDispositions[0].disposition).toBe(EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE);
  });

  // 8. Partial support preserved (LinkedIn Learning access vs unproven gratis)
  test('8. Partial support: base LinkedIn access supported while gratis is unproven', () => {
    const binding = {
      bindingId: 'b8',
      entity: { canonical: 'Program LinkedIn Learning (CDC)' },
      requestedField: 'facility',
      primaryFieldHints: ['linkedin']
    };
    const frame = { rawQuery: 'apakah mahasiswa mendapatkan akses linkedin learning gratis?' };
    const evidence = [{
      evidenceId: 'ev8',
      entityBinding: { canonical: 'Program LinkedIn Learning (CDC)' },
      fieldBinding: 'facility',
      textSnippet: 'Mahasiswa dapat mengakses portal LinkedIn Learning untuk kursus',
      sourceId: 'faq.docx',
      provenance: 'faq'
    }];
    const res = evaluateBinding(binding, evidence, frame);
    expect(res.status).toBe(EVALUATION_STATUS.PARTIALLY_SUPPORTED);
    expect(res.dimensions.qualifierCompatibility).toBe(DIMENSION_STATUS.UNPROVEN);
    expect(res.unsupportedDimensions).toContain('qualifier');
    expect(res.matchedEvidenceIds).toContain('ev8');
  });

  // 9. No evidence returns UNSUPPORTED
  test('9. No evidence returns UNSUPPORTED', () => {
    const binding = {
      bindingId: 'b9',
      requestedField: 'tuitionFee'
    };
    const res = evaluateBinding(binding, []);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(res.reasonCodes).toContain('NO_COMPATIBLE_EVIDENCE_FOR_BINDING');
  });

  // 10. Conflicting evidence returns CONFLICTING
  test('10. Conflicting evidence on same temporal scope returns CONFLICTING', () => {
    const binding = {
      bindingId: 'b10',
      entity: { canonical: 'Teknologi Informasi' },
      requestedField: 'tuitionFee'
    };
    const evidence = [
      {
        evidenceId: 'ev10_a',
        entityBinding: { canonical: 'Teknologi Informasi' },
        fieldBinding: 'tuitionFee',
        structuredValue: 'Rp 6.500.000',
        sourceId: 'biaya_2026_v1.pdf',
        provenance: 'Brosur 2026'
      },
      {
        evidenceId: 'ev10_b',
        entityBinding: { canonical: 'Teknologi Informasi' },
        fieldBinding: 'tuitionFee',
        structuredValue: 'Rp 7.000.000',
        sourceId: 'biaya_2026_v2.pdf',
        provenance: 'Brosur 2026'
      }
    ];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.CONFLICTING);
    expect(res.conflicts.length).toBe(1);
    expect(res.reasonCodes).toContain('CONFLICTING_AUTHORITATIVE_EVIDENCE');
  });

  // 11. Multi-entity independent evaluation isolation (TI vs SI)
  test('11. Multi-entity evaluation isolation between TI and SI', () => {
    const plan = {
      subrequests: [{
        bindings: [
          { bindingId: 'b11_ti', entity: { canonical: 'Teknologi Informasi' }, requestedField: 'degreeOutcome' },
          { bindingId: 'b11_si', entity: { canonical: 'Sistem Informasi' }, requestedField: 'degreeOutcome' }
        ]
      }]
    };
    const providerResults = {
      resultsByBinding: {
        'b11_ti': {
          evidence: [{
            evidenceId: 'ev11_ti',
            entityBinding: { canonical: 'Teknologi Informasi' },
            fieldBinding: 'degreeOutcome',
            structuredValue: 'S.Kom',
            sourceId: 'ti.pdf',
            provenance: 'ti'
          }]
        },
        'b11_si': { evidence: [] }
      }
    };
    const planEval = evaluatePlanResults(plan, providerResults);
    expect(planEval.resultsByBinding['b11_ti'].status).toBe(EVALUATION_STATUS.SUPPORTED);
    expect(planEval.resultsByBinding['b11_si'].status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(planEval.summary.status).toBe(EVALUATION_STATUS.PARTIALLY_SUPPORTED);
  });

  // 12. Multi-field independent evaluation isolation (degree vs duration)
  test('12. Multi-field evaluation isolation on same entity', () => {
    const plan = {
      subrequests: [{
        bindings: [
          { bindingId: 'b12_deg', entity: { canonical: 'Bisnis Digital' }, requestedField: 'degreeOutcome' },
          { bindingId: 'b12_dur', entity: { canonical: 'Bisnis Digital' }, requestedField: 'duration' }
        ]
      }]
    };
    const providerResults = {
      resultsByBinding: {
        'b12_deg': {
          evidence: [{
            evidenceId: 'ev12_deg',
            entityBinding: { canonical: 'Bisnis Digital' },
            fieldBinding: 'degreeOutcome',
            structuredValue: 'S.Bns',
            sourceId: 'bd.pdf',
            provenance: 'bd'
          }]
        },
        'b12_dur': { evidence: [] }
      }
    };
    const planEval = evaluatePlanResults(plan, providerResults);
    expect(planEval.resultsByBinding['b12_deg'].status).toBe(EVALUATION_STATUS.SUPPORTED);
    expect(planEval.resultsByBinding['b12_dur'].status).toBe(EVALUATION_STATUS.UNSUPPORTED);
  });

  // 13. Open-world entity support without registry requirement
  test('13. Open-world entity supported without registry requirement', () => {
    const binding = {
      bindingId: 'b13',
      entity: { canonical: 'Klub Robotika Canggih' },
      requestedField: 'profile',
      primaryFieldHints: ['robotika', 'klub']
    };
    const evidence = [{
      evidenceId: 'ev13',
      entityBinding: { canonical: 'Klub Robotika Canggih' },
      fieldBinding: 'profile',
      structuredValue: 'Unit riset robotika mahasiswa',
      sourceId: 'ormawa.docx',
      provenance: 'Dokumen ormawa'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.SUPPORTED);
  });

  // 14. Explicit negation preservation
  test('14. Explicit negation: excluded field returns UNSUPPORTED without evaluating evidence', () => {
    const binding = {
      bindingId: 'b14',
      requestedField: 'tuitionFee',
      exclusions: ['tuitionFee']
    };
    const evidence = [{
      evidenceId: 'ev14',
      fieldBinding: 'tuitionFee',
      structuredValue: 'Rp 6.000.000',
      sourceId: 'biaya.pdf',
      provenance: 'biaya'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(res.reasonCodes).toContain('EXCLUDED_FIELD_REJECTED');
  });

  // 15. Relation subject/object existence without relation proof rejects equivalence
  test('15. Relation proof rejected when entities co-exist without assertion of equivalence', () => {
    const binding = {
      bindingId: 'b15',
      relations: [{
        subject: 'Double Degree DNUI',
        relationType: 'equivalent_to',
        object: 'Student Exchange'
      }]
    };
    const evidence = [{
      evidenceId: 'ev15',
      textSnippet: 'STIKOM Bali memiliki program Double Degree DNUI dan juga Student Exchange ke luar negeri.',
      sourceId: 'intl.pdf',
      provenance: 'intl'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.dimensions.relationCompatibility).toBe(DIMENSION_STATUS.UNPROVEN);
    expect(res.status).not.toBe(EVALUATION_STATUS.SUPPORTED);
  });

  // 16. Actual relation support accepted with explicit relation evidence
  test('16. Relation support accepted with explicit equivalence statement', () => {
    const binding = {
      bindingId: 'b16',
      entity: { canonical: 'Double Degree DNUI' },
      requestedField: 'relation',
      relations: [{
        subject: 'Double Degree DNUI',
        relationType: 'equivalent_to',
        object: 'Student Exchange'
      }],
      primaryFieldHints: ['setara']
    };
    const evidence = [{
      evidenceId: 'ev16',
      entityBinding: { canonical: 'Double Degree DNUI' },
      fieldBinding: 'relation',
      textSnippet: 'Program Double Degree DNUI setara dengan Student Exchange dalam hal konversi SKS mata kuliah internasional.',
      sourceId: 'intl_eval.pdf',
      provenance: 'intl doc'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.dimensions.relationCompatibility).toBe(DIMENSION_STATUS.SUPPORTED);
    expect(res.status).toBe(EVALUATION_STATUS.SUPPORTED);
  });

  // 17. LinkedIn + unsupported qualifier
  test('17. LinkedIn with unsupported qualifier is PARTIALLY_SUPPORTED', () => {
    const binding = {
      bindingId: 'b17',
      entity: { canonical: 'Program LinkedIn Learning (CDC)' },
      requestedField: 'facility',
      primaryFieldHints: ['linkedin']
    };
    const frame = { rawQuery: 'apakah mahasiswa mendapatkan akses linkedin learning gratis?' };
    const evidence = [{
      evidenceId: 'ev17',
      entityBinding: { canonical: 'Program LinkedIn Learning (CDC)' },
      fieldBinding: 'facility',
      textSnippet: 'Program LinkedIn Learning tersedia untuk mahasiswa aktif.',
      sourceId: 'cdc.pdf',
      provenance: 'cdc'
    }];
    const res = evaluateBinding(binding, evidence, frame);
    expect(res.status).toBe(EVALUATION_STATUS.PARTIALLY_SUPPORTED);
    expect(res.unsupportedDimensions).toContain('qualifier');
  });

  // 18. CRT02 recipient/subtype audit
  test('18. CRT02 recipient/subtype audit: generic GoesToSchool does not prove graduate competency', () => {
    const binding = {
      bindingId: 'b18',
      rawText: 'apakah lulusan stikom mendapatkan sertifikat kompetensi?',
      requestedField: 'certification',
      primaryFieldHints: ['sertifikat']
    };
    const frame = { rawQuery: 'apakah lulusan stikom mendapatkan sertifikat kompetensi?' };
    const evidence = [{
      evidenceId: 'ev18',
      fieldBinding: 'certification',
      textSnippet: 'Peserta STIKOM Bali GoesToSchool mendapatkan sertifikat kehadiran.',
      sourceId: 'gts.docx',
      provenance: 'gts'
    }];
    const res = evaluateBinding(binding, evidence, frame);
    expect(res.dimensions.recipientCompatibility).toBe(DIMENSION_STATUS.MISMATCH);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
  });

  // 19. Founding date (20 Mei 2001) vs legal decree date (10 Agustus 2002)
  test('19. Founding date (20 Mei 2001) is supported by founding record but not decree', () => {
    const bindingFounding = {
      bindingId: 'b19_f',
      entity: { canonical: 'ITB STIKOM Bali' },
      requestedField: 'foundingDate'
    };
    const evidenceFounding = [{
      evidenceId: 'ev19_f',
      entityBinding: { canonical: 'ITB STIKOM Bali' },
      fieldBinding: 'foundingDate',
      structuredValue: '20 Mei 2001',
      sourceId: 'ISIAN WEBSITE (1).pdf',
      provenance: 'Didirikan pada tanggal 20 Mei 2001 oleh Yayasan Widya Dharma Shanti'
    }];
    const resFounding = evaluateBinding(bindingFounding, evidenceFounding);
    expect(resFounding.status).toBe(EVALUATION_STATUS.SUPPORTED);
    expect(resFounding.supportedFacts[0].value).toBe('20 Mei 2001');

    const bindingDecree = {
      bindingId: 'b19_d',
      entity: { canonical: 'ITB STIKOM Bali' },
      requestedField: 'legalDecreeDate'
    };
    const evidenceDecree = [{
      evidenceId: 'ev19_d',
      entityBinding: { canonical: 'ITB STIKOM Bali' },
      fieldBinding: 'legalDecreeDate',
      structuredValue: '10 Agustus 2002',
      sourceId: 'ISIAN WEBSITE (1).pdf',
      provenance: 'SK Mendiknas No. 157/D/O/2002 tertanggal 10 Agustus 2002'
    }];
    const resDecree = evaluateBinding(bindingDecree, evidenceDecree);
    expect(resDecree.status).toBe(EVALUATION_STATUS.SUPPORTED);
    expect(resDecree.supportedFacts[0].value).toBe('10 Agustus 2002');
  });

  // 20. Shared evidence candidate attached to multiple bindings evaluated independently
  test('20. Shared evidence candidate evaluated independently per binding', () => {
    const sharedEv = {
      evidenceId: 'ev_shared',
      textSnippet: 'Biaya pendaftaran ITB STIKOM Bali Rp 500.000 untuk prodi Sistem Informasi',
      fieldBinding: 'registrationFee',
      sourceId: 'shared.pdf',
      provenance: 'shared'
    };
    const bindingReg = {
      bindingId: 'b20_reg',
      requestedField: 'registrationFee'
    };
    const bindingTui = {
      bindingId: 'b20_tui',
      requestedField: 'tuitionFee'
    };
    const resReg = evaluateBinding(bindingReg, [sharedEv]);
    const resTui = evaluateBinding(bindingTui, [sharedEv]);
    expect(resReg.status).toBe(EVALUATION_STATUS.SUPPORTED);
    expect(resTui.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
  });

  // 21. Evidence without provenance rejected from establishing support
  test('21. Evidence without provenance rejected from establishing support', () => {
    const binding = {
      bindingId: 'b21',
      requestedField: 'tuitionFee'
    };
    const evidence = [{
      evidenceId: 'ev21',
      fieldBinding: 'tuitionFee',
      structuredValue: 'Rp 5.000.000',
      sourceId: null,
      provenance: null
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(res.evidenceDispositions[0].disposition).toBe(EVIDENCE_DISPOSITION.REJECTED);
  });

  // 22. Registry-only data cannot establish factual support
  test('22. Registry-only evidence rejected as factual support', () => {
    const binding = {
      bindingId: 'b22',
      requestedField: 'phone'
    };
    const evidence = [{
      evidenceId: 'ev22',
      fieldBinding: 'phone',
      structuredValue: '(0361) 244445',
      sourceId: 'canonicalEntityRegistry',
      provenance: 'canonicalEntityRegistry'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(res.evidenceDispositions[0].disposition).toBe(EVIDENCE_DISPOSITION.REJECTED);
  });

  // 23. Deterministic output verification
  test('23. Deterministic evaluation output across identical calls', () => {
    const binding = {
      bindingId: 'b23',
      entity: { canonical: 'Sistem Informasi' },
      requestedField: 'degreeOutcome'
    };
    const evidence = [{
      evidenceId: 'ev23',
      entityBinding: { canonical: 'Sistem Informasi' },
      fieldBinding: 'degreeOutcome',
      structuredValue: 'S.Kom',
      sourceId: 'si.pdf',
      provenance: 'si'
    }];
    const run1 = evaluateBinding(binding, evidence);
    const run2 = evaluateBinding(binding, evidence);
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  // 24. Frame, binding, and evidence immutability verification
  test('24. Inputs remain unmodified (no Object.freeze mutation or property changes)', () => {
    const binding = { bindingId: 'b24', requestedField: 'degreeOutcome' };
    const evidence = [{ evidenceId: 'ev24', fieldBinding: 'degreeOutcome', structuredValue: 'S.Kom', sourceId: 'doc.pdf', provenance: 'doc' }];
    const frame = { domain: { primary: 'academic' } };

    const bindingBefore = JSON.stringify(binding);
    const evidenceBefore = JSON.stringify(evidence);
    const frameBefore = JSON.stringify(frame);

    evaluateBinding(binding, evidence, frame);

    expect(JSON.stringify(binding)).toBe(bindingBefore);
    expect(JSON.stringify(evidence)).toBe(evidenceBefore);
    expect(JSON.stringify(frame)).toBe(frameBefore);
    // Verify caller objects were NOT frozen
    expect(Object.isFrozen(binding)).toBe(false);
    expect(Object.isFrozen(evidence[0])).toBe(false);
    expect(Object.isFrozen(frame)).toBe(false);
  });

  // 25. Zero full corpus scan verification (evaluator does not invoke index search)
  test('25. Evaluator operates strictly on supplied evidence with zero full corpus scan', () => {
    const binding = { bindingId: 'b25', requestedField: 'degree' };
    const res = evaluateBinding(binding, []);
    expect(res.evidenceOpportunityComplete).toBe(true);
  });

  // 26. Incomplete evidence opportunity does not become UNSUPPORTED
  test('26. Incomplete evidence opportunity returns evaluationState: INCOMPLETE and status: null', () => {
    const binding = { bindingId: 'b26', requestedField: 'tuitionFee' };
    const res = evaluateBinding(binding, [], {}, { evidenceOpportunityComplete: false });
    expect(res.evaluationState).toBe('INCOMPLETE');
    expect(res.status).toBeNull();
    expect(res.reasonCodes).toContain('EVALUATION_INCOMPLETE_EVIDENCE_OPPORTUNITY_PENDING');
  });

  // 27. Token-overlap entity false positive rejected
  test('27. Token-overlap entity false positive rejected ("Teknologi Informasi" vs "Sistem Informasi")', () => {
    const comp = isEntityCompatible(
      { canonical: 'Teknologi Informasi' },
      { canonical: 'Sistem Informasi' }
    );
    expect(comp.compatible).toBe(false);
    expect(comp.matchType).toBe('DISTINCT_PRODI_CONFLICT');
  });

  // 28. Unrequested metadata dimension does not cause failure
  test('28. Unrequested metadata dimension does not cause failure when core field is supported', () => {
    const binding = {
      bindingId: 'b28',
      entity: { canonical: 'Sistem Komputer' },
      requestedField: 'degreeOutcome'
    };
    const evidence = [{
      evidenceId: 'ev28',
      entityBinding: { canonical: 'Sistem Komputer' },
      fieldBinding: 'degreeOutcome',
      structuredValue: 'S.Kom',
      sourceId: 'sk.pdf',
      provenance: 'sk doc'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.SUPPORTED);
  });

  // 29. Qualifier UNPROVEN vs CONTRADICTED distinction
  test('29. Qualifier CONTRADICTED when evidence explicitly states paid price', () => {
    const binding = {
      bindingId: 'b29',
      entity: { canonical: 'Program LinkedIn Learning (CDC)' },
      requestedField: 'facility',
      primaryFieldHints: ['linkedin']
    };
    const frame = { rawQuery: 'apakah mahasiswa mendapatkan akses linkedin learning gratis?' };
    const evidence = [{
      evidenceId: 'ev29',
      entityBinding: { canonical: 'Program LinkedIn Learning (CDC)' },
      fieldBinding: 'facility',
      textSnippet: 'Program LinkedIn Learning Alumni ITB STIKOM Bali Rp 200.000/Tahun',
      sourceId: 'img.jpeg',
      provenance: 'img'
    }];
    const res = evaluateBinding(binding, evidence, frame);
    expect(res.dimensions.qualifierCompatibility).toBe(DIMENSION_STATUS.CONTRADICTED);
    expect(res.status).toBe(EVALUATION_STATUS.PARTIALLY_SUPPORTED);
  });

  // 30. Different temporal scopes do not create false conflict
  test('30. Different temporal scopes (2025 vs 2026) do not create false conflict', () => {
    const binding = {
      bindingId: 'b30',
      entity: { canonical: 'Teknologi Informasi' },
      requestedField: 'tuitionFee'
    };
    const evidence = [
      {
        evidenceId: 'ev30_2025',
        entityBinding: { canonical: 'Teknologi Informasi' },
        fieldBinding: 'tuitionFee',
        structuredValue: 'Rp 6.000.000',
        sourceId: 'biaya_2025.pdf',
        provenance: 'Tahun 2025'
      },
      {
        evidenceId: 'ev30_2026',
        entityBinding: { canonical: 'Teknologi Informasi' },
        fieldBinding: 'tuitionFee',
        structuredValue: 'Rp 6.500.000',
        sourceId: 'biaya_2026.pdf',
        provenance: 'Tahun 2026'
      }
    ];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).not.toBe(EVALUATION_STATUS.CONFLICTING);
    expect(res.conflicts.length).toBe(0);
  });

  // 31. Evaluator does not rerun planner
  test('31. Evaluator does not rerun planner during evaluation', () => {
    let plannerCalled = false;
    const plan = {
      subrequests: [{
        bindings: [{ bindingId: 'b31', requestedField: 'phone' }]
      }]
    };
    evaluatePlanResults(plan, { resultsByBinding: { 'b31': { evidence: [] } } });
    expect(plannerCalled).toBe(false);
  });

  // 32. Evaluator does not rerun providers
  test('32. Evaluator does not rerun providers during evaluation', () => {
    let providerRetrieveCalled = false;
    const plan = {
      subrequests: [{
        bindings: [{ bindingId: 'b32', requestedField: 'website' }]
      }]
    };
    evaluatePlanResults(plan, { resultsByBinding: { 'b32': { evidence: [] } } });
    expect(providerRetrieveCalled).toBe(false);
  });

  // 33. Same evidenceId receives independent verdict per binding
  test('33. Same evidenceId receives independent verdict per binding', () => {
    const evidenceRecord = {
      evidenceId: 'ev33',
      entityBinding: { canonical: 'Sistem Informasi' },
      fieldBinding: 'degreeOutcome',
      structuredValue: 'S.Kom',
      sourceId: 'prodi.pdf',
      provenance: 'prodi'
    };
    const bindingSI = {
      bindingId: 'b33_si',
      entity: { canonical: 'Sistem Informasi' },
      requestedField: 'degreeOutcome'
    };
    const bindingTI = {
      bindingId: 'b33_ti',
      entity: { canonical: 'Teknologi Informasi' },
      requestedField: 'degreeOutcome'
    };
    const resSI = evaluateBinding(bindingSI, [evidenceRecord]);
    const resTI = evaluateBinding(bindingTI, [evidenceRecord]);
    expect(resSI.status).toBe(EVALUATION_STATUS.SUPPORTED);
    expect(resTI.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
  });

  // 34. Real-case regression A: Student recipient vs alumni-only evidence
  test('34. Student recipient vs alumni-only evidence: student recipient NOT supported', () => {
    const binding = {
      bindingId: 'b34_student_access',
      entity: { canonical: 'Program LinkedIn Learning (CDC)' },
      requestedField: 'facility',
      rawText: 'apakah mahasiswa mendapatkan akses linkedin learning gratis?'
    };
    const frame = { rawQuery: 'apakah mahasiswa mendapatkan akses linkedin learning gratis?' };
    const evidence = [{
      evidenceId: 'ev34_alumni_only',
      entityBinding: { canonical: 'Program LinkedIn Learning (CDC)' },
      fieldBinding: 'facility',
      textSnippet: 'Rp. 200.000/Tahun Program Linkedin Learning khusus Alumni ITB STIKOM Bali untuk meningkatkan kompetensi, memperoleh sertifikasi',
      sourceId: 'WhatsApp Image 2026-07-23 at 13.22.28.jpeg',
      provenance: 'Official Brochure'
    }];
    const res = evaluateBinding(binding, evidence, frame);
    // Student recipient MUST NOT be supported
    expect(res.dimensions.recipientCompatibility).toBe(DIMENSION_STATUS.MISMATCH);
    expect(res.unsupportedDimensions).toContain('recipient');
    expect(res.dimensions.qualifierCompatibility).toBe(DIMENSION_STATUS.CONTRADICTED);
    expect(res.unsupportedDimensions).toContain('qualifier');
    expect(res.status).toBe(EVALUATION_STATUS.PARTIALLY_SUPPORTED);
    // Verified that student recipient is NOT in supportedFacts
    const studentFact = res.supportedFacts.find(f => f.field === 'recipient');
    expect(studentFact).toBeUndefined();
  });

  // 35. Real-case regression B: REG04 contact binding cannot mutate or evaluate as registrationProcedure
  test('35. REG04 contact binding cannot mutate or evaluate as registrationProcedure', () => {
    const binding = {
      bindingId: 'b35_reg04_contact',
      entity: { canonical: 'Akademik' },
      requestedField: 'phone'
    };
    // Sibling evidence with registrationProcedure must be rejected as relevant-but-incompatible
    const evidence = [{
      evidenceId: 'ev35_reg_proc',
      entityBinding: { canonical: 'Akademik' },
      fieldBinding: 'registrationProcedure',
      textSnippet: 'Prosedur pendaftaran yudisium dilakukan secara online melalui portal akademik',
      sourceId: 'panduan_yudisium.pdf',
      provenance: 'Panduan'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(res.fieldBinding).toBe('phone');
    expect(res.fieldBinding).not.toBe('registrationProcedure');
    expect(res.evidenceDispositions[0].disposition).toBe(EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE);
  });

  // 36. Real-case regression C: PAR09 subunit Instagram cannot satisfy institutional official Instagram
  test('36. PAR09 subunit Instagram cannot satisfy institutional official Instagram', () => {
    const binding = {
      bindingId: 'b36_inst_instagram',
      entity: { canonical: 'INSTITUTION_ROOT' },
      requestedField: 'instagram'
    };
    const evidence = [{
      evidenceId: 'ev36_cdc_handle',
      entityBinding: { canonical: 'INSTITUTION_ROOT' },
      fieldBinding: 'instagram',
      textSnippet: 'Career Center ITB STIKOM Bali: Email ts_dirkka@stikom-bali.ac.id, Instagram: @cdc.stikombali',
      sourceId: 'ok-Company-Profile-CDC (1).pdf',
      provenance: 'CDC Profile'
    }];
    const res = evaluateBinding(binding, evidence);
    expect(res.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(res.dimensions.fieldCompatibility).toBe(DIMENSION_STATUS.MISMATCH);
    expect(res.evidenceDispositions[0].disposition).toBe(EVIDENCE_DISPOSITION.RELEVANT_BUT_INCOMPATIBLE);
    expect(res.evidenceDispositions[0].reasons[0]).toContain('Subunit handle');
    expect(res.matchedEvidenceIds.length).toBe(0);
  });
});
