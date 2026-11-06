'use strict';

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { evaluateContextDependency } = require('../src/core/contextResolver');
const { decomposeQuery } = require('../src/core/multiIntentResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const {
  synthesizeAnswer,
  prepareConflictAwareEvidence,
  composeMultiAttributeAnswer
} = require('../src/core/groundedAnswerGenerator');
const { verifyFinalAnswer, VERIFICATION_OUTCOME } = require('../src/core/finalAnswerVerifier');
const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');

describe('Stage 5: Integrated Reasoning, Multi-Attribute Synthesis & Conflict-Aware Answer Composition', () => {
  // 1. Multi-Attribute Full Synthesis (4 Atribut)
  test('1. Multi-Attribute Full Synthesis (4 Atribut): synthesizes fee, accreditation, curriculum, and career prospects in requested order', async () => {
    const query = 'Berapa biaya kuliah, bagaimana akreditasinya, mata kuliah apa saja yang dipelajari, dan bagaimana peluang kerja lulusan S1 Sistem Informasi?';
    const subFrames = decomposeQuery(query, {});
    expect(subFrames).toHaveLength(1);

    const frame = subFrames[0];
    expect(frame.targetEntities.map(e => e.canonical || e)).toContain('S1 Sistem Informasi');
    expect(frame.requestedAttributes.slice(0, 4)).toEqual([
      'fee',
      'accreditation',
      'curriculum',
      'career_prospects'
    ]);

    const accepted = [
      {
        id: 's1_si_fee_1',
        sourceFile: 'rincian_biaya.md',
        text: 'Program Studi S1 Sistem Informasi: Biaya Pendaftaran Rp 500.000, Dana Pendidikan Pokok (DPP) Rp 14.000.000, dan Biaya Pendidikan per Semester (SPP) Rp 6.000.000 berdasarkan SK Rektor No. 629/ITBSTIKOM/WDS/X/25.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['fee'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true, sourceDocument: 'SK_Rektor_629' }
      },
      {
        id: 's1_si_acc_1',
        sourceFile: 'akreditasi_program_studi.md',
        text: 'Program Studi S1 Sistem Informasi ITB STIKOM Bali telah terakreditasi Baik Sekali oleh LAM INFOKOM (SK No. 129/SK/LAM-INFOKOM/Ak/S/VIII/2023).',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['accreditation'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true, sourceDocument: 'SK_Akreditasi_LAM_INFOKOM' }
      },
      {
        id: 's1_si_curr_1',
        sourceFile: 'kurikulum_s1_si.md',
        text: 'Kurikulum S1 Sistem Informasi mempelajari Enterprise Information Systems, Database Management, Analisis dan Desain Sistem, serta E-Business dengan total beban studi 144 SKS.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['curriculum'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true, sourceDocument: 'Pedoman_Kurikulum_S1_SI' }
      },
      {
        id: 's1_si_career_1',
        sourceFile: 'profil_s1_si.md',
        text: 'Peluang kerja dan prospek karier lulusan S1 Sistem Informasi meliputi System Analyst, Business Analyst, Database Administrator, IT Consultant, dan Enterprise Resource Planning (ERP) Specialist.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['career_prospects'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true, sourceDocument: 'Katalog_Prodi_S1_SI' }
      }
    ];

    const arbitrated = {
      accepted,
      rejected: [],
      sourceConflicts: [],
      retrievalPlan: buildRetrievalPlan(frame)
    };
    const answerability = evaluateAnswerability(frame, arbitrated);
    expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);

    arbitrated.missingAspects = answerability.missingAspects;
    arbitrated.coveredAspects = answerability.coveredAspects;
    arbitrated.attributeEvaluation = answerability.attributeEvaluation;
    arbitrated.answerabilityStatus = answerability.status;

    const synth = await synthesizeAnswer(frame, arbitrated);
    expect(synth.success).toBe(true);
    expect(synth.outcome).toBe('VERIFIED_FACTUAL');
    expect(synth.supportedAttributes).toEqual(['fee', 'accreditation', 'curriculum', 'career_prospects']);

    const ans = synth.answer;
    expect(ans).toMatch(/14\.000\.000|6\.000\.000/);
    expect(ans).toMatch(/Baik Sekali/i);
    expect(ans).toMatch(/Enterprise Information Systems|Database Management|144 SKS/i);
    expect(ans).toMatch(/System Analyst|Business Analyst/i);

    // Check section order matches user request (Fee -> Accreditation -> Curriculum -> Career Prospects)
    const idxFee = ans.search(/Biaya|DPP|14\.000\.000/i);
    const idxAcc = ans.search(/Status Akreditasi|Baik Sekali/i);
    const idxCurr = ans.search(/Kurikulum & Mata Kuliah|Enterprise Information Systems/i);
    const idxCareer = ans.search(/Peluang Kerja & Prospek Karier|System Analyst/i);
    expect(idxFee).toBeGreaterThanOrEqual(0);
    expect(idxAcc).toBeGreaterThan(idxFee);
    expect(idxCurr).toBeGreaterThan(idxAcc);
    expect(idxCareer).toBeGreaterThan(idxCurr);

    const verif = verifyFinalAnswer(ans, frame, arbitrated);
    expect(verif.pass).toBe(true);
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
  });

  // 2. Multi-Attribute Partial Synthesis (3 dari 4 Atribut)
  test('2. Multi-Attribute Partial Synthesis (3 dari 4 Atribut): answers 3 supported attributes, discloses 1 missing attribute, and preserves PARTIAL status', async () => {
    const query = 'Berapa biaya kuliah, bagaimana akreditasinya, mata kuliah apa saja yang dipelajari, dan bagaimana peluang kerja lulusan S1 Sistem Informasi?';
    const frame = resolveSemanticFrame(query, {});

    // Provide evidence only for fee, accreditation, and curriculum (career_prospects is missing)
    const accepted = [
      {
        id: 's1_si_fee_1',
        sourceFile: 'rincian_biaya.md',
        text: 'Program Studi S1 Sistem Informasi: DPP Rp 14.000.000 dan SPP Rp 6.000.000 per semester berdasarkan SK Rektor No. 629/ITBSTIKOM/WDS/X/25.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['fee'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true }
      },
      {
        id: 's1_si_acc_1',
        sourceFile: 'akreditasi_program_studi.md',
        text: 'Program Studi S1 Sistem Informasi terakreditasi Baik Sekali oleh LAM INFOKOM.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['accreditation'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true }
      },
      {
        id: 's1_si_curr_1',
        sourceFile: 'kurikulum_s1_si.md',
        text: 'Kurikulum S1 Sistem Informasi mempelajari Enterprise Information Systems, Database Management, dan E-Business (144 SKS).',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['curriculum'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true }
      }
    ];

    const arbitrated = {
      accepted,
      rejected: [],
      sourceConflicts: [],
      retrievalPlan: buildRetrievalPlan(frame)
    };

    const answerability = evaluateAnswerability(frame, arbitrated);
    expect(answerability.status).toBe(ANSWERABILITY_STATUS.PARTIAL);
    expect(answerability.missingAspects).toContain('career_prospects');

    arbitrated.missingAspects = answerability.missingAspects;
    arbitrated.coveredAspects = answerability.coveredAspects;
    arbitrated.attributeEvaluation = answerability.attributeEvaluation;
    arbitrated.answerabilityStatus = answerability.status;

    const synth = await synthesizeAnswer(frame, arbitrated);
    expect(synth.success).toBe(true);
    expect(synth.outcome).toBe('PARTIAL');
    expect(synth.partialCoverage).toBe(true);
    expect(synth.supportedAttributes).toEqual(['fee', 'accreditation', 'curriculum']);
    expect(synth.missingAspects).toContain('career_prospects');
    expect(synth.answer).toMatch(/14\.000\.000|6\.000\.000/);
    expect(synth.answer).toMatch(/Baik Sekali/i);
    expect(synth.answer).toMatch(/Enterprise Information Systems/i);
    expect(synth.answer).toMatch(/Catatan: Informasi mengenai.*prospek karir.*belum terkonfirmasi/i);

    const verif = verifyFinalAnswer(synth.answer, frame, arbitrated);
    expect(verif.pass).toBe(true);
    expect(verif.outcome).toBe('PARTIAL');
    expect(verif.status).toBe('PARTIAL');
  });

  // 3. Primary vs Secondary Conflict Resolution
  test('3. Primary vs Secondary Conflict Resolution: selects primary source fact and excludes contradicting secondary source', async () => {
    const query = 'Berapa biaya kuliah dan akreditasi S1 Sistem Informasi?';
    const frame = resolveSemanticFrame(query, {});

    const evidenceWithConflict = [
      {
        id: 'primary_fee_chunk',
        sourceFile: 'sk_rektor_629.md',
        text: 'SK Rektor No. 629/ITBSTIKOM/WDS/X/25: Biaya kuliah S1 Sistem Informasi memiliki DPP Rp 14.000.000 dan SPP Rp 6.000.000 per semester.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['fee'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true, sourceDocument: 'SK_Rektor_629' }
      },
      {
        id: 'secondary_contradicting_fee_chunk',
        sourceFile: 'brosur_lama_sekunder.md',
        text: 'Ringkasan brosur: Biaya kuliah S1 Sistem Informasi memiliki DPP Rp 9.500.000 dan SPP Rp 3.200.000 per semester.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['fee'],
        evidenceRole: 'CONTRADICTING',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'SECONDARY_CONTRADICTED',
        provenance: { authorityTier: 3, isPrimarySource: false, sourceDocument: 'Brosur_Sekunder' }
      },
      {
        id: 'primary_acc_chunk',
        sourceFile: 'akreditasi.md',
        text: 'Program Studi S1 Sistem Informasi terakreditasi Baik Sekali oleh LAM INFOKOM.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['accreditation'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true, sourceDocument: 'SK_LAM_INFOKOM' }
      }
    ];

    const arbitrated = {
      accepted: evidenceWithConflict,
      rejected: [],
      sourceConflicts: [
        {
          entity: 'S1 Sistem Informasi',
          attribute: 'fee',
          primaryChunkId: 'primary_fee_chunk',
          contradictingChunkId: 'secondary_contradicting_fee_chunk',
          resolution: 'PRIMARY_AUTHORITY_WINS'
        }
      ],
      retrievalPlan: buildRetrievalPlan(frame)
    };

    const conflictState = prepareConflictAwareEvidence(evidenceWithConflict, frame, arbitrated);
    expect(conflictState.excludedContradictingCount).toBe(1);
    expect(conflictState.activeEvidence.map(c => c.id)).not.toContain('secondary_contradicting_fee_chunk');

    const synth = await synthesizeAnswer(frame, arbitrated);
    expect(synth.success).toBe(true);
    expect(synth.answer).toMatch(/14\.000\.000|6\.000\.000/);
    expect(synth.answer).not.toMatch(/9\.500\.000|3\.200\.000/);

    // Also verify that finalAnswerVerifier rejects an answer that uses the contradicting secondary nominal
    const badCandidate = 'Biaya kuliah S1 Sistem Informasi adalah DPP Rp 9.500.000 dan SPP Rp 3.200.000 per semester, serta terakreditasi Baik Sekali.';
    const badVerif = verifyFinalAnswer(badCandidate, frame, arbitrated);
    expect(badVerif.pass).toBe(false);
    expect(badVerif.reason).toMatch(/claim_from_contradicting_secondary_source/);
  });

  // 4. Historical vs Active Fact Isolation
  test('4. Historical vs Active Fact Isolation: isolates HISTORICAL_ARCHIVE from active synthesis and discloses archive status when only historical exists', async () => {
    const query = 'Bagaimana akreditasi dan kurikulum S1 Sistem Informasi saat ini?';
    const frame = resolveSemanticFrame(query, {});

    const mixedTemporalEvidence = [
      {
        id: 'active_acc',
        sourceFile: 'akreditasi_2026.md',
        text: 'Program Studi S1 Sistem Informasi terakreditasi Baik Sekali oleh LAM INFOKOM.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['accreditation'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true }
      },
      {
        id: 'historical_curr_2019',
        sourceFile: 'arsip_2019.md',
        text: 'Arsip Tahun Akademik 2019/2020: Kurikulum lama S1 Sistem Informasi memiliki biaya praktikum tambahan Rp 1.750.000.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['curriculum'],
        evidenceRole: 'HISTORICAL_CONTEXT',
        temporalRelevance: 'HISTORICAL_ARCHIVE',
        academicYear: '2019/2020',
        provenance: { authorityTier: 2, isPrimarySource: false, temporalStatus: 'HISTORICAL_ARCHIVE' }
      },
      {
        id: 'active_curr_2026',
        sourceFile: 'kurikulum_2026.md',
        text: 'Kurikulum aktif S1 Sistem Informasi mempelajari Enterprise Information Systems, Database Management, dan Analisis Desain Sistem (144 SKS).',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['curriculum'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'VERIFIED_PRIMARY',
        provenance: { authorityTier: 1, isPrimarySource: true }
      }
    ];

    const arbitratedMixed = {
      accepted: mixedTemporalEvidence,
      rejected: [],
      sourceConflicts: [],
      retrievalPlan: buildRetrievalPlan(frame)
    };

    const synthMixed = await synthesizeAnswer(frame, arbitratedMixed);
    expect(synthMixed.success).toBe(true);
    expect(synthMixed.answer).toMatch(/Baik Sekali/i);
    expect(synthMixed.answer).toMatch(/Enterprise Information Systems/i);
    expect(synthMixed.answer).not.toMatch(/1\.750\.000|2019\/2020/);

    // Case B: Only HISTORICAL_ARCHIVE evidence is available
    const onlyHistoricalArbitrated = {
      accepted: [mixedTemporalEvidence[1]],
      rejected: [],
      sourceConflicts: [],
      retrievalPlan: buildRetrievalPlan(frame)
    };
    const synthHistoricalOnly = await synthesizeAnswer(frame, onlyHistoricalArbitrated);
    expect(synthHistoricalOnly.success).toBe(true);
    expect(synthHistoricalOnly.source).toBe('historical_archive_disclosure');
    expect(synthHistoricalOnly.answer).toMatch(/arsip historis/i);
    expect(synthHistoricalOnly.answer).toMatch(/bukan merupakan ketentuan aktif/i);

    // Verify that presenting the historical archive fact as active without disclosure is rejected by verifyFinalAnswer
    const unflaggedHistoricalAnswer = 'Saat ini ketentuan aktif S1 Sistem Informasi memiliki biaya praktikum tambahan Rp 1.750.000.';
    const verifBadHist = verifyFinalAnswer(unflaggedHistoricalAnswer, frame, onlyHistoricalArbitrated);
    expect(verifBadHist.pass).toBe(false);
    expect(verifBadHist.reason).toMatch(/historical_fact_presented_as_active|unsupported_temporal_claim_lacks_valid_temporal_evidence/);
  });

  // 5. Unresolved Primary Conflict Disclosure (NEEDS_SOURCE_VALIDATION)
  test('5. Unresolved Primary Conflict Disclosure (NEEDS_SOURCE_VALIDATION): transparently discloses conflicting primary values without guessing', async () => {
    const query = 'Berapa total SKS kurikulum D3 Manajemen Informatika?';
    const frame = resolveSemanticFrame(query, {});

    const conflictingPrimaryChunks = [
      {
        id: 'd3_mi_primary_110',
        sourceFile: 'indeks_kurikulum_d3_mi.md',
        text: 'Dokumen Indeks Kurikulum D3 Manajemen Informatika mencantumkan total beban studi 110 SKS.',
        supportedEntities: ['D3 Manajemen Informatika'],
        supportedAttributes: ['sks', 'curriculum'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'NEEDS_SOURCE_VALIDATION',
        provenance: { authorityTier: 1, isPrimarySource: true, sourceDocument: 'Indeks_Kurikulum_D3_MI' }
      },
      {
        id: 'd3_mi_primary_115',
        sourceFile: 'pedoman_akademik_d3_mi.md',
        text: 'Dokumen Pedoman Kurikulum D3 Manajemen Informatika mencantumkan total beban studi 115 SKS.',
        supportedEntities: ['D3 Manajemen Informatika'],
        supportedAttributes: ['sks', 'curriculum'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        verificationStatus: 'NEEDS_SOURCE_VALIDATION',
        provenance: { authorityTier: 1, isPrimarySource: true, sourceDocument: 'Pedoman_Akademik_D3_MI' }
      }
    ];

    const arbitrated = {
      accepted: conflictingPrimaryChunks,
      rejected: [],
      sourceConflicts: [
        {
          entity: 'D3 Manajemen Informatika',
          attribute: 'sks',
          conflictingValues: ['110 SKS', '115 SKS'],
          authorityTierA: 1,
          authorityTierB: 1,
          verificationStatus: 'NEEDS_SOURCE_VALIDATION',
          resolution: 'UNRESOLVED_NEEDS_SOURCE_VALIDATION',
          requiresValidation: true
        }
      ],
      retrievalPlan: buildRetrievalPlan(frame)
    };

    const synth = await synthesizeAnswer(frame, arbitrated);
    expect(synth.success).toBe(true);
    expect(synth.verificationStatus).toBe('NEEDS_SOURCE_VALIDATION');
    expect(synth.answer).toMatch(/110 SKS/);
    expect(synth.answer).toMatch(/115 SKS/);
    expect(synth.answer).toMatch(/NEEDS_SOURCE_VALIDATION/);
    expect(synth.answer).toMatch(/verifikasi dokumen resmi/i);
  });

  // 6. Multi-Entity + Multi-Attribute Synthesis
  test('6. Multi-Entity + Multi-Attribute Synthesis: answers multiple attributes across two distinct study programs without mixing facts', async () => {
    const query = 'Berapa biaya kuliah S1 Sistem Informasi dan bagaimana akreditasi serta peluang kerja S1 Bisnis Digital?';
    const subFrames = decomposeQuery(query, {});
    expect(subFrames.length).toBeGreaterThanOrEqual(2);

    const result = await runPhase1DeterministicPipeline('test-stage5-multi-entity-attr', query, {});
    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.finalAnswer).toMatch(/Sistem Informasi/i);
    expect(result.finalAnswer).toMatch(/Bisnis Digital/i);
    expect(result.finalAnswer).toMatch(/14\.000\.000|6\.000\.000/);
    expect(result.finalAnswer).toMatch(/Baik/i);
    expect(result.finalAnswer).toMatch(/Digital Marketing|Business Analyst|Project Manager|Strategist/i);
  });

  // 7. Follow-Up Multi-Attribute Expansion
  test('7. Follow-Up Multi-Attribute Expansion: carries over activeEntity from Turn 1 and synthesizes multiple attributes in Turn 2', async () => {
    const sessionData = {
      activeDomain: 'ACADEMIC_PROGRAM',
      activeIntent: 'PROGRAM_OVERVIEW',
      activeEntity: 'S1 Sistem Informasi',
      lastAcademicProgramEntity: 'S1 Sistem Informasi',
      requestedAttributes: ['overview']
    };

    const followUpQuery = 'Kalau biaya kuliahnya, akreditasinya, dan masuk fakultas apa?';
    const ctxDep = evaluateContextDependency(followUpQuery, sessionData);
    expect(ctxDep.shouldInherit).toBe(true);
    const resolvedFrame = resolveSemanticFrame(followUpQuery, sessionData);

    expect(resolvedFrame.targetEntities.map(e => e.canonical || e)).toContain('S1 Sistem Informasi');
    expect(resolvedFrame.requestedAttributes).toEqual(expect.arrayContaining(['fee', 'accreditation', 'faculty']));

    const accepted = [
      {
        id: 'f_fee',
        sourceFile: 'rincian_biaya.md',
        text: 'Program Studi S1 Sistem Informasi: DPP Rp 14.000.000 dan SPP Rp 6.000.000 per semester.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['fee'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        provenance: { authorityTier: 1, isPrimarySource: true }
      },
      {
        id: 'f_acc',
        sourceFile: 'akreditasi.md',
        text: 'Program Studi S1 Sistem Informasi terakreditasi Baik Sekali oleh LAM INFOKOM.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['accreditation'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        provenance: { authorityTier: 1, isPrimarySource: true }
      },
      {
        id: 'f_fac',
        sourceFile: 'fakultas.md',
        text: 'Program Studi S1 Sistem Informasi berada di bawah Fakultas Informatika dan Komputer (FIK) ITB STIKOM Bali.',
        supportedEntities: ['S1 Sistem Informasi'],
        supportedAttributes: ['faculty'],
        evidenceRole: 'PRIMARY',
        temporalRelevance: 'CURRENT_ACADEMIC_YEAR',
        provenance: { authorityTier: 1, isPrimarySource: true }
      }
    ];

    const arbitrated = {
      accepted,
      rejected: [],
      sourceConflicts: [],
      sessionData,
      retrievalPlan: buildRetrievalPlan(resolvedFrame)
    };
    const answerability = evaluateAnswerability(resolvedFrame, arbitrated);
    arbitrated.missingAspects = answerability.missingAspects;
    arbitrated.coveredAspects = answerability.coveredAspects;
    arbitrated.attributeEvaluation = answerability.attributeEvaluation;
    arbitrated.answerabilityStatus = answerability.status;

    const synth = await synthesizeAnswer(resolvedFrame, arbitrated);
    expect(synth.success).toBe(true);
    expect(synth.supportedAttributes).toEqual(['fee', 'accreditation', 'faculty']);
    expect(synth.answer).toMatch(/14\.000\.000|6\.000\.000/);
    expect(synth.answer).toMatch(/Baik Sekali/i);
    expect(synth.answer).toMatch(/Fakultas Informatika dan Komputer \(FIK\)/i);
  });

  // 8. Verifier Rejection of Swapped Attribute Values
  test('8. Verifier Rejection of Swapped Attribute Values: rejects candidate answer when DPP and SPP nominals are swapped', () => {
    const query = 'Berapa DPP dan SPP S1 Sistem Informasi?';
    const frame = resolveSemanticFrame(query, {});
    const arbitrated = {
      accepted: [
        {
          id: 'fee_s1_si',
          sourceFile: 'rincian_biaya.md',
          text: 'S1 Sistem Informasi: Dana Pendidikan Pokok (DPP) sebesar Rp 14.000.000 dan Biaya Pendidikan per Semester (SPP) sebesar Rp 6.000.000.',
          supportedEntities: ['S1 Sistem Informasi'],
          supportedAttributes: ['fee'],
          provenance: { authorityTier: 1, isPrimarySource: true }
        }
      ],
      rejected: [],
      answerability: 'ANSWERABLE',
      answerabilityStatus: 'ANSWERABLE'
    };

    const swappedCandidate = 'Untuk Program Studi S1 Sistem Informasi, rincian biayanya adalah Dana Pendidikan Pokok (DPP) sebesar Rp 6.000.000 dan Biaya Pendidikan per Semester (SPP) sebesar Rp 14.000.000.';
    const verif = verifyFinalAnswer(swappedCandidate, frame, arbitrated);

    expect(verif.pass).toBe(false);
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(verif.reason).toMatch(/aspect_mismatch_dpp_spp_swapped|unsupported_factual_claim_fee_nominal_divergence/);
  });

  // 9. Verifier Rejection of Sibling Leakage
  test('9. Verifier Rejection of Sibling Leakage: rejects candidate answer when sibling program or wrong degree level facts leak into target program answer', () => {
    const query = 'Apa saja yang dipelajari dan berapa SKS di S1 Sistem Informasi?';
    const frame = resolveSemanticFrame(query, {});
    const plan = buildRetrievalPlan(frame);
    const arbitrated = {
      accepted: [
        {
          id: 'curr_s1_si',
          sourceFile: 'kurikulum_s1_si.md',
          text: 'Program Studi S1 Sistem Informasi menempuh 144 SKS dengan fokus Enterprise Information Systems dan Database Management.',
          supportedEntities: ['S1 Sistem Informasi'],
          supportedAttributes: ['curriculum', 'sks']
        }
      ],
      rejected: [],
      retrievalPlan: plan,
      answerability: 'ANSWERABLE',
      answerabilityStatus: 'ANSWERABLE'
    };

    const leakedSiblingAnswer = 'Program Studi S1 Sistem Informasi dan S1 Sistem Komputer memiliki beban studi 110 SKS dengan fokus Embedded Systems.';
    const verif = verifyFinalAnswer(leakedSiblingAnswer, frame, arbitrated);

    expect(verif.pass).toBe(false);
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(verif.reason).toMatch(/entity_contradiction_conflicting_sibling_in_answer|contradictory_s1_sks_claim/);
  });

  // 10. Verifier Rejection of Unsubstantiated Partial Claim
  test('10. Verifier Rejection of Unsubstantiated Partial Claim: rejects candidate answer that fabricates claims for an unsupported missing attribute', () => {
    const query = 'Berapa biaya kuliah dan bagaimana peluang kerja lulusan S1 Sistem Informasi?';
    const frame = resolveSemanticFrame(query, {});
    const arbitrated = {
      accepted: [
        {
          id: 'fee_only',
          sourceFile: 'rincian_biaya.md',
          text: 'S1 Sistem Informasi: DPP Rp 14.000.000 dan SPP Rp 6.000.000 per semester.',
          supportedEntities: ['S1 Sistem Informasi'],
          supportedAttributes: ['fee'],
          provenance: { authorityTier: 1, isPrimarySource: true }
        }
      ],
      rejected: [],
      coveredAspects: ['fee'],
      missingAspects: ['career_prospects'],
      attributeEvaluation: {
        fee: { status: 'SUPPORTED' },
        career_prospects: { status: 'UNSUPPORTED' }
      },
      answerability: 'PARTIAL',
      answerabilityStatus: 'PARTIAL'
    };

    const fabricatedPartialAnswer = 'Untuk S1 Sistem Informasi:\n- Dana Pendidikan Pokok (DPP) adalah Rp 14.000.000\n- Biaya Pendidikan per Semester (SPP) adalah Rp 6.000.000\n\nPeluang kerja lulusan dapat bekerja sebagai System Analyst, Software Engineer, dan IT Consultant.';
    const verif = verifyFinalAnswer(fabricatedPartialAnswer, frame, arbitrated);

    expect(verif.pass).toBe(false);
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(verif.reason).toMatch(/unsubstantiated_attribute_claim/);
  });
});
