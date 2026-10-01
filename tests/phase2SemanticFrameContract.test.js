'use strict';

const { createSemanticFrame, PROVENANCE } = require('../src/engine/semanticFrame');
const { resolveEffectiveSemanticFrame } = require('../src/engine/semanticFrameResolver');
const { buildRetrievalPlanFromSemanticFrame, buildResolvedRetrievalPlan, evaluatePlannedCandidate } = require('../src/engine/resolvedRetrievalPlan');
const { buildSemanticContract } = require('../src/engine/semanticContract');
const { selectAcademicDocumentSectionDetailed } = require('../src/engine/semanticRagEngine');

describe('Phase 2 — Semantic Understanding & Retrieval Plan Contract Invariant Suite', () => {

  // 1. Basic SemanticFrame structure & immutability
  test('1. Basic SemanticFrame has all canonical fields and is deeply frozen', () => {
    const frame = resolveEffectiveSemanticFrame('Berapa biaya kuliah S1 Sistem Informasi?');
    expect(frame.version).toBe(2);
    expect(frame.isFrozen).toBe(true);
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.domain)).toBe(true);
    expect(Object.isFrozen(frame.intent)).toBe(true);
    expect(Object.isFrozen(frame.entities)).toBe(true);
    expect(Object.isFrozen(frame.temporalConstraint)).toBe(true);
    expect(Object.isFrozen(frame.location)).toBe(true);
    expect(Object.isFrozen(frame.contextRelation)).toBe(true);
    expect(Object.isFrozen(frame.ambiguity)).toBe(true);

    expect(frame.domain.primary).toBe('fee');
    expect(frame.intent.primary).toBe('ask_fee');
    expect(frame.entities.length).toBeGreaterThan(0);
    expect(frame.entities[0].canonical).toBe('Sistem Informasi');
    expect(frame.primaryField).toBeDefined();

    // Verify immutability
    expect(() => {
      frame.domain.primary = 'hacked';
    }).toThrow();
  });

  // 2. Paraphrase invariance
  test('2. Paraphrase invariance: different surface forms map to equivalent semantic frames', () => {
    const f1 = resolveEffectiveSemanticFrame('biaya S2 SI berapa?');
    const f2 = resolveEffectiveSemanticFrame('berapa biaya kuliah S2 Sistem Informasi?');

    expect(f1.domain.primary).toBe(f2.domain.primary);
    expect(f1.intent.primary).toBe(f2.intent.primary);
    expect(f1.entities[0].canonical).toBe('S2 Sistem Informasi');
    expect(f2.entities[0].canonical).toBe('S2 Sistem Informasi');
    expect(f1.requestedFields).toEqual(expect.arrayContaining(['amount']));
    expect(f2.requestedFields).toEqual(expect.arrayContaining(['amount']));
  });

  // 3. Context follow-up
  test('3. Context follow-up: inherits compatible entity without explicit query phrase rules', () => {
    const f1 = resolveEffectiveSemanticFrame('Berapa biaya S2 SI?');
    expect(f1.entities[0].canonical).toBe('S2 Sistem Informasi');

    const sessionState = {
      activeEntity: f1.entities[0],
      activeDomain: 'fee',
      activeIntent: 'ask_fee',
      program: 'S2 Sistem Informasi'
    };

    const f2 = resolveEffectiveSemanticFrame('kalau online bagaimana?', { sessionState });
    expect(f2.entities.length).toBe(1);
    expect(f2.entities[0].canonical).toBe('S2 Sistem Informasi');
    expect(f2.entities[0].provenance).toBe(PROVENANCE.PRIOR_CONTEXT_INHERITED);
    expect(f2.domain.primary).toBe('academic');
    expect(f2.requestedFields).toContain('deliveryMode');
    expect(f2.contextRelation.isFollowup).toBe(true);
    expect(f2.contextRelation.inheritedEntities).toContain('S2 Sistem Informasi');

    const sessionState2 = {
      activeEntity: f2.entities[0],
      activeDomain: 'academic',
      activeIntent: 'ask_delivery_mode',
      program: 'S2 Sistem Informasi'
    };

    const f3 = resolveEffectiveSemanticFrame('biayanya berapa?', { sessionState: sessionState2 });
    expect(f3.entities.length).toBe(1);
    expect(f3.entities[0].canonical).toBe('S2 Sistem Informasi');
    expect(f3.domain.primary).toBe('fee');
    expect(f3.requestedFields).toContain('amount');
    expect(f3.contextRelation.isFollowup).toBe(true);
  });

  // 4. Pronoun & ellipsis
  test('4. Pronoun and ellipsis detection in contextRelation', () => {
    const f = resolveEffectiveSemanticFrame('aplikasinya apa?', {
      sessionState: { program: 'S2 Sistem Informasi' }
    });
    expect(f.contextRelation.isFollowup).toBe(true);
    expect(f.contextRelation.referentToken).toBe('aplikasinya');
    expect(f.entities[0].canonical).toBe('S2 Sistem Informasi');
  });

  // 5. Multi-intent representation
  test('5. Multi-intent: preserves primary, secondary intents, and multiple requested fields', () => {
    const f = resolveEffectiveSemanticFrame('Berapa biaya kuliah S2 SI dan apakah kuliahnya online?');
    expect(f.domain.primary).toBe('fee');
    expect(f.intent.primary).toBe('ask_fee');
    expect(f.intent.secondary).toContain('ask_delivery_mode');
    expect(f.requestedFields).toEqual(expect.arrayContaining(['deliveryMode']));
    expect(f.requestedFields).toEqual(expect.arrayContaining(['amount']));
    expect(f.entities[0].canonical).toBe('S2 Sistem Informasi');
  });

  // 6. Entity resolution canonical mapping
  test('6. Entity resolution: various aliases resolve to same canonical entity', () => {
    const fA = resolveEffectiveSemanticFrame('Kuliah S2 SI');
    const fB = resolveEffectiveSemanticFrame('Kuliah Magister Sistem Informasi');
    expect(fA.entities[0].canonical).toBe('S2 Sistem Informasi');
    expect(fB.entities[0].canonical).toBe('S2 Sistem Informasi');
  });

  // 7. Location disambiguation
  test('7. Location disambiguation: marks ambiguity when location overlaps with program', () => {
    const f = resolveEffectiveSemanticFrame('kuliahnya online/offline di Bandung?');
    expect(f.location.studyLocation).toBe('Bandung');
    expect(f.location.isAmbiguous).toBe(true);
    expect(f.ambiguity.isAmbiguous).toBe(true);
    expect(f.ambiguity.type).toBe('location_program_overlap');
  });

  // 8. Temporal current
  test('8. Temporal current: detects current schedule request with correct year', () => {
    const f = resolveEffectiveSemanticFrame('jadwal yudisium sekarang');
    expect(f.temporalConstraint.temporalMode).toBe('current');
    expect(f.temporalConstraint.academicYear).toBe(2026);
    expect(f.temporalConstraint.isHistorical).toBe(false);
  });

  // 9. Temporal historical
  test('9. Temporal historical: detects historical intent and flags allowHistorical', () => {
    const f = resolveEffectiveSemanticFrame('jadwal yudisium tahun lalu');
    expect(f.temporalConstraint.temporalMode).toBe('past');
    expect(f.temporalConstraint.isHistorical).toBe(true);
  });

  // 10. Temporal future
  test('10. Temporal future: detects future schedule intent', () => {
    const f = resolveEffectiveSemanticFrame('jadwal yudisium tahun depan');
    expect(f.temporalConstraint.temporalMode).toBe('future');
    expect(f.temporalConstraint.isHistorical).toBe(false);
  });

  // 11. Typo normalization
  test('11. Typo normalization: handles slight typos in keywords', () => {
    const f = resolveEffectiveSemanticFrame('biya S2 SI berapa?');
    expect(f.domain.primary).toBe('fee');
    expect(f.entities[0].canonical).toBe('S2 Sistem Informasi');
  });

  // 12. Ambiguity detection without context
  test('12. Ambiguity detection: query without context does not hallucinate entities', () => {
    const f = resolveEffectiveSemanticFrame('kalau online bagaimana?');
    expect(f.entities.length).toBe(0);
    expect(f.contextRelation.inheritedEntities.length).toBe(0);
  });

  // 13. Context inheritance precedence: CURRENT EXPLICIT > PRIOR CONTEXT
  test('13. Precedence invariant: explicit entity on current turn overrides prior context', () => {
    const sessionState = {
      activeEntity: { canonical: 'S2 Sistem Informasi', type: 'program' },
      program: 'S2 Sistem Informasi'
    };
    const f = resolveEffectiveSemanticFrame('Kalau untuk D3 MI biayanya berapa?', { sessionState });
    expect(f.entities.length).toBeGreaterThanOrEqual(1);
    expect(f.entities.map(e => e.canonical)).toContain('Manajemen Informatika');
    expect(f.entities.every(e => e.provenance === PROVENANCE.EXPLICIT_CURRENT)).toBe(true);
    expect(f.entities.map(e => e.canonical)).not.toContain('S2 Sistem Informasi');
  });

  // 14. Unseen query invariance (semantic extraction without exact keyword hardcode)
  test('14. Unseen query invariance: new phrasing maps accurately to semantic structure', () => {
    const f = resolveEffectiveSemanticFrame('Kalau saya mengambil kelas secara daring, platform apa yang digunakan?');
    expect(f.intent.primary).toBe('ask_learning_platform');
    expect(f.requestedFields).toContain('deliveryMode');
  });

  // 15. RetrievalPlan generated from SemanticFrame
  test('15. buildRetrievalPlanFromSemanticFrame constructs complete, valid plan', () => {
    const frame = resolveEffectiveSemanticFrame('Kapan batas pendaftaran yudisium?');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    expect(plan.domain).toBe('academic');
    expect(plan.sourceScope).toContain('academic_announcement');
    expect(plan.requestedFields).toContain('registrationDeadline');
    expect(plan.temporalScope.allowHistorical).toBe(false);
    expect(plan.authorityRequirements.mustBeAuthoritative).toBe(true);
    expect(plan.governanceRequirements.excludeExpired).toBe(true);
    expect(plan.planQuery.length).toBeGreaterThan(0);
  });

  // 16. Governance policy propagation
  test('16. Governance policy: current queries mandate non-expired, non-draft documents', () => {
    const frame = resolveEffectiveSemanticFrame('jadwal wisuda 2026');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);
    expect(plan.governanceRequirements.excludeExpired).toBe(true);
    expect(plan.governanceRequirements.excludeDraft).toBe(true);
    expect(plan.governanceRequirements.excludeArchived).toBe(true);
    expect(plan.historicalPolicy).toBe('require_current');
  });

  // 17. Historical policy propagation
  test('17. Historical policy: past queries allow historical document retrieval', () => {
    const frame = resolveEffectiveSemanticFrame('arsip jadwal wisuda tahun lalu');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);
    expect(plan.temporalScope.allowHistorical).toBe(true);
    expect(plan.governanceRequirements.excludeExpired).toBe(false);
    expect(plan.historicalPolicy).toBe('allow_historical');
  });

  // 18. Fallback policy
  test('18. Fallback policy: sets clarify_ambiguity for ambiguous and safe_data_gap for normal', () => {
    const fNormal = resolveEffectiveSemanticFrame('Kapan yudisium?');
    const planNormal = buildRetrievalPlanFromSemanticFrame(fNormal);
    expect(planNormal.fallbackPolicy).toBe('safe_data_gap');

    const fAmbiguous = resolveEffectiveSemanticFrame('kuliahnya online/offline di Bandung?');
    const planAmbiguous = buildRetrievalPlanFromSemanticFrame(fAmbiguous);
    expect(planAmbiguous.fallbackPolicy).toBe('clarify_ambiguity');
  });

  // 19. Yudisium Regression Invariant (Phase 1 Protection)
  test('19. Yudisium Invariant: rejects PRAGINA / 20 Mei 2001 and keeps bounded top-k search', () => {
    const docHistorical = {
      filename: 'profil_sejarah.pdf',
      documentId: 'doc_hist',
      authority: 'academic_handbook',
      text: 'STIKOM Bali didirikan pada 20 Mei 2001 oleh Yayasan Widya Dharma Shanti. UKM Tari PRAGINA didirikan untuk seni tari.'
    };
    const evidence = [{ source: docHistorical.filename, text: docHistorical.text, metadata: docHistorical }];
    const sec = selectAcademicDocumentSectionDetailed('Kapan yudisium?', evidence, 'schedule');
    expect(sec).toBeNull();
  });

  // 20. Modality Regression Invariant (Phase 1 Protection)
  test('20. Modality Invariant: modality queries do not throw ReferenceError', () => {
    expect(() => {
      resolveEffectiveSemanticFrame('online/daring menggunakan aplikasi apa?');
      resolveEffectiveSemanticFrame('kuliahnya online/offline di Bandung?');
    }).not.toThrow();
  });

  // 21. Historical Governance: current query rejects expired doc
  test('21. Historical Governance: current query rejects expired doc', () => {
    const frame = resolveEffectiveSemanticFrame('jadwal yudisium sekarang');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);
    expect(plan.temporalScope.allowHistorical).toBe(false);
    expect(plan.governanceRequirements.excludeExpired).toBe(true);

    const expiredDoc = {
      filename: 'yudisium_2024.pdf',
      status: 'expired',
      authorityTier: 1,
      authority: 'tier_1',
      chunk: 'Jadwal pelaksanaan yudisium tahun 2024 diadakan pada 10 Oktober 2024.'
    };
    const res = evaluatePlannedCandidate(expiredDoc, plan);
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('governance_violation');
  });

  // 22. Historical Governance: historical query allows relevant historical expired doc matching target period
  test('22. Historical Governance: historical query allows relevant historical expired doc matching target period', () => {
    const frame = resolveEffectiveSemanticFrame('jadwal yudisium tahun 2024');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);
    expect(plan.temporalScope.allowHistorical).toBe(true);
    expect(plan.governanceRequirements.excludeExpired).toBe(false);

    const relevantDoc = {
      filename: 'yudisium_2024.pdf',
      status: 'expired',
      authorityTier: 1,
      authority: 'tier_1',
      chunk: 'Jadwal pelaksanaan yudisium tahun 2024 diadakan pada 10 Oktober 2024.'
    };
    const res = evaluatePlannedCandidate(relevantDoc, plan);
    expect(res.rejected).toBe(false);
    expect(res.compatible).toBe(true);
  });

  // 23. Historical Governance: historical query rejects unrelated expired doc
  test('23. Historical Governance: historical query rejects unrelated expired doc', () => {
    const frame = resolveEffectiveSemanticFrame('jadwal yudisium tahun 2024');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const unrelatedDoc = {
      filename: 'yudisium_2019.pdf',
      status: 'expired',
      authorityTier: 1,
      authority: 'tier_1',
      chunk: 'Jadwal pelaksanaan yudisium tahun 2019 diadakan pada 15 Mei 2019.'
    };
    const res = evaluatePlannedCandidate(unrelatedDoc, plan);
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('governance_violation');
  });

  // 24. Historical Governance: historical query rejects draft doc
  test('24. Historical Governance: historical query rejects draft doc', () => {
    const frame = resolveEffectiveSemanticFrame('jadwal yudisium tahun 2024');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const draftDoc = {
      filename: 'yudisium_draft.pdf',
      status: 'draft',
      authorityTier: 1,
      authority: 'tier_1',
      chunk: 'Draft rancangan jadwal yudisium tahun 2024.'
    };
    const res = evaluatePlannedCandidate(draftDoc, plan);
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('governance_violation');
  });

  // 25. Historical Governance: historical query rejects future doc
  test('25. Historical Governance: historical query rejects future doc', () => {
    const frame = resolveEffectiveSemanticFrame('jadwal yudisium tahun 2024');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const futureDoc = {
      filename: 'yudisium_future.pdf',
      status: 'active',
      validFrom: '2099-01-01',
      authorityTier: 1,
      authority: 'tier_1',
      chunk: 'Jadwal yudisium masa depan tahun 2099.'
    };
    const res = evaluatePlannedCandidate(futureDoc, plan);
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('governance_violation');
  });

  // 26. Historical Governance: historical query rejects validity_unknown doc
  test('26. Historical Governance: historical query rejects validity_unknown doc', () => {
    const frame = resolveEffectiveSemanticFrame('jadwal yudisium tahun 2024');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const unknownDoc = {
      filename: 'yudisium_unverified.pdf',
      status: 'validity_unknown',
      authorityTier: 1,
      authority: 'tier_1',
      chunk: 'Informasi yudisium 2024 dari forum tidak resmi.'
    };
    const res = evaluatePlannedCandidate(unknownDoc, plan);
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe('governance_violation');
  });

  // 27. RetrievalPlan Mutation Invariance: paraphrase maintains identical semantic constraints
  test('27. RetrievalPlan Mutation Invariance: paraphrase maintains identical semantic constraints', () => {
    const f1 = resolveEffectiveSemanticFrame('Berapa biaya kuliah S2 SI?');
    const f2 = resolveEffectiveSemanticFrame('Kira-kira tarif pendidikan magister Sistem Informasi nominalnya berapa?');

    const p1 = buildRetrievalPlanFromSemanticFrame(f1);
    const p2 = buildRetrievalPlanFromSemanticFrame(f2);

    expect(p1.sourceScope).toEqual(p2.sourceScope);
    expect(p1.domain).toBe(p2.domain);
    expect(p1.entities).toEqual(p2.entities);
    expect(p1.requestedFields).toEqual(p2.requestedFields);
    expect(p1.temporalScope.mode).toBe(p2.temporalScope.mode);
    expect(p1.temporalScope.allowHistorical).toBe(p2.temporalScope.allowHistorical);
    expect(p1.locationScope).toBe(p2.locationScope);
    expect(p1.authorityRequirements).toEqual(p2.authorityRequirements);
    expect(p1.governanceRequirements).toEqual(p2.governanceRequirements);
    expect(p1.historicalPolicy).toBe(p2.historicalPolicy);
    expect(p1.fallbackPolicy).toBe(p2.fallbackPolicy);
  });

  // 28. Multi-Intent Unseen Paraphrase: preserves all semantic dimensions into retrieval plan
  test('28. Multi-Intent Unseen Paraphrase: preserves all semantic dimensions into retrieval plan', () => {
    const query = 'Apakah program S2 Sistem Informasi perkuliahannya tatap muka atau daring, dan berapa tarif kuliahnya?';
    const frame = resolveEffectiveSemanticFrame(query);

    expect(frame.intent.primary).toBe('ask_fee');
    expect(frame.intent.secondary).toContain('ask_delivery_mode');
    expect(frame.requestedFields.some(f => ['tuitionFee', 'fee', 'amount'].includes(f))).toBe(true);
    expect(frame.requestedFields.some(f => ['deliveryMode', 'studyModality'].includes(f))).toBe(true);
    expect(frame.entities.map(e => e.canonical)).toContain('S2 Sistem Informasi');

    const plan = buildRetrievalPlanFromSemanticFrame(frame);
    expect(plan.requestedFields.some(f => ['tuitionFee', 'fee', 'amount'].includes(f))).toBe(true);
    expect(plan.requestedFields.some(f => ['deliveryMode', 'studyModality'].includes(f))).toBe(true);
    expect(plan.intent).toBe('ask_fee');
    expect(plan.entities).toContain('S2 Sistem Informasi');
  });
});
