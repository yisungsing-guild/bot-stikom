'use strict';

/**
 * tests/semanticFrame.test.js
 *
 * Foundation test suite for the Controlled Semantic Core Refactor.
 * Verifies all 16 required invariants:
 * 1.  SEMANTIC_FRAME_CREATION=PASS
 * 2.  SEMANTIC_FRAME_DEEP_FREEZE=PASS
 * 3.  ENTITY_FAMILY_NORMALIZATION=PASS
 * 4.  ORGANIZATION_FAMILY_CONTEXT_COMPATIBILITY=PASS
 * 5.  NON_ORGANIZATION_FAMILY_NOT_COLLAPSED=PASS
 * 6.  CURRENT_EXPLICIT_OVERRIDES_PRIOR=PASS
 * 7.  COMPATIBLE_PRIOR_FILLS_MISSING_SLOT=PASS
 * 8.  INCOMPATIBLE_PRIOR_NOT_INHERITED=PASS
 * 9.  INHERITED_SLOT_PROVENANCE=PASS
 * 10. SPECIFIC_FIELD_BEATS_GENERIC_FAMILY=PASS
 * 11. INSTAGRAM_REMAINS_INSTAGRAM=PASS
 * 12. CERTIFICATION_REMAINS_CERTIFICATION=PASS
 * 13. DURATION_REMAINS_DURATION=PASS
 * 14. FEE_REMAINS_FEE=PASS
 * 15. MULTI_SUBREQUEST_FRAMES_ISOLATED=PASS
 * 16. LEGACY_ADAPTER_CANNOT_MUTATE_FRAME=PASS
 */

const {
  PROVENANCE,
  deepFreeze,
  normalizeEntityFamily,
  isSpecificFieldAuthoritative,
  createSemanticFrame
} = require('../src/engine/semanticFrame');

const {
  isEntityFamilyCompatibleWithDomain,
  resolveEffectiveSemanticFrame
} = require('../src/engine/semanticFrameResolver');

const {
  toLegacyUnderstanding,
  toLegacyContract
} = require('../src/engine/legacySemanticAdapter');

describe('Controlled Semantic Core Foundation Test Suite', () => {

  // 1. SEMANTIC_FRAME_CREATION
  test('SEMANTIC_FRAME_CREATION: should instantiate valid structured frame with default slots', () => {
    const frame = createSemanticFrame({
      rawQuery: 'berapa biaya kuliah sistem informasi',
      normalizedQuery: 'berapa biaya kuliah sistem informasi',
      intent: { primary: 'ask_fee', confidence: 0.9 },
      domain: { primary: 'fee', confidence: 0.9 },
      entities: [{ canonical: 'S1 Sistem Informasi', type: 'program', family: 'program' }],
      requestedFields: ['tuitionFee', 'fee']
    });

    expect(frame).toBeDefined();
    expect(frame.rawQuery).toBe('berapa biaya kuliah sistem informasi');
    expect(frame.intent.primary).toBe('ask_fee');
    expect(frame.domain.primary).toBe('fee');
    expect(frame.entities.length).toBe(1);
    expect(frame.entities[0].canonical).toBe('S1 Sistem Informasi');
    expect(frame.primaryField).toBe('tuitionFee');
    expect(frame.isFrozen).toBe(true);
  });

  // 2. SEMANTIC_FRAME_DEEP_FREEZE
  test('SEMANTIC_FRAME_DEEP_FREEZE: should block mutations to root and deeply nested properties', () => {
    const frame = createSemanticFrame({
      rawQuery: 'test deep freeze',
      entities: [{ canonical: 'TI', type: 'program' }],
      requestedFields: ['duration'],
      constraints: { academicLevel: 's1' },
      provenance: { intent: PROVENANCE.EXPLICIT_CURRENT }
    });

    // Attempt root mutation
    expect(() => {
      frame.rawQuery = 'mutated';
    }).toThrow();

    // Attempt nested array mutation
    expect(() => {
      frame.requestedFields.push('fee');
    }).toThrow();

    // Attempt nested object mutation
    expect(() => {
      frame.entities[0].canonical = 'Hacked';
    }).toThrow();

    // Attempt constraints mutation
    expect(() => {
      frame.constraints.academicLevel = 's2';
    }).toThrow();

    // Attempt provenance mutation
    expect(() => {
      frame.provenance.intent = PROVENANCE.UNKNOWN;
    }).toThrow();
  });

  // 3. ENTITY_FAMILY_NORMALIZATION
  test('ENTITY_FAMILY_NORMALIZATION: should normalize diverse representation strings into canonical families', () => {
    expect(normalizeEntityFamily('ukm')).toBe('organization');
    expect(normalizeEntityFamily('student_organization')).toBe('organization');
    expect(normalizeEntityFamily('organization')).toBe('organization');
    expect(normalizeEntityFamily('himaprodi')).toBe('organization');
    expect(normalizeEntityFamily('hima')).toBe('organization');
    expect(normalizeEntityFamily('ormawa')).toBe('organization');
    expect(normalizeEntityFamily('bem')).toBe('organization');
    expect(normalizeEntityFamily('dpm')).toBe('organization');
    expect(normalizeEntityFamily('student_association')).toBe('organization');

    expect(normalizeEntityFamily('prodi')).toBe('program');
    expect(normalizeEntityFamily('jurusan')).toBe('program');
    expect(normalizeEntityFamily('s1')).toBe('program');
    expect(normalizeEntityFamily('academic_program')).toBe('program');

    expect(normalizeEntityFamily('campus_location')).toBe('campus');
    expect(normalizeEntityFamily('facility_program')).toBe('facility');
    expect(normalizeEntityFamily('scholarship')).toBe('scholarship');
  });

  // 4. ORGANIZATION_FAMILY_CONTEXT_COMPATIBILITY
  test('ORGANIZATION_FAMILY_CONTEXT_COMPATIBILITY: all organization-family types should be compatible with student_organization domain', () => {
    const orgTypes = ['ukm', 'student_organization', 'hima', 'himaprodi', 'ormawa', 'bem', 'dpm', 'student_association'];
    for (const type of orgTypes) {
      const fam = normalizeEntityFamily(type);
      expect(isEntityFamilyCompatibleWithDomain(fam, 'student_organization')).toBe(true);
    }
  });

  // 5. NON_ORGANIZATION_FAMILY_NOT_COLLAPSED
  test('NON_ORGANIZATION_FAMILY_NOT_COLLAPSED: distinct entity canonicals and families must remain distinct', () => {
    const frame = createSemanticFrame({
      rawQuery: 'test distinct entities',
      entities: [
        { canonical: 'Mapala Kompas', type: 'ukm' },
        { canonical: 'BEM-PM ITB STIKOM Bali', type: 'bem' },
        { canonical: 'S1 Sistem Informasi', type: 'program' }
      ]
    });

    expect(frame.entities[0].canonical).toBe('Mapala Kompas');
    expect(frame.entities[0].family).toBe('organization');
    expect(frame.entities[0].type).toBe('ukm');

    expect(frame.entities[1].canonical).toBe('BEM-PM ITB STIKOM Bali');
    expect(frame.entities[1].family).toBe('organization');
    expect(frame.entities[1].type).toBe('bem');

    expect(frame.entities[2].canonical).toBe('S1 Sistem Informasi');
    expect(frame.entities[2].family).toBe('program');

    expect(frame.entities[0].canonical).not.toBe(frame.entities[1].canonical);
  });

  // 6. CURRENT_EXPLICIT_OVERRIDES_PRIOR
  test('CURRENT_EXPLICIT_OVERRIDES_PRIOR: explicit current entity must never be overwritten by prior context', () => {
    const priorSession = {
      activeDomain: 'program',
      activeEntity: { canonical: 'S1 Sistem Informasi', type: 'program', family: 'program' },
      isVerified: true,
      promotable: true,
      updatedAt: new Date().toISOString()
    };

    // Current turn explicitly names TI
    const frame = resolveEffectiveSemanticFrame('bagaimana kurikulum teknologi informasi?', {
      sessionState: priorSession
    });

    expect(frame.entities.length).toBe(1);
    expect(frame.entities[0].canonical).toBe('Teknologi Informasi');
    expect(frame.entities[0].provenance).toBe(PROVENANCE.EXPLICIT_CURRENT);
  });

  // 7. COMPATIBLE_PRIOR_FILLS_MISSING_SLOT
  test('COMPATIBLE_PRIOR_FILLS_MISSING_SLOT: compatible prior entity fills missing slot for continuation (P6_C45-T2 acceptance test)', () => {
    // Turn 1 grounds Mapala Kompas (type: ukm)
    const priorSession = {
      activeDomain: 'student_organization',
      activeIntent: 'ask_organization_profile',
      activeEntity: { canonical: 'Mapala Kompas', type: 'ukm', family: 'organization', group: 'organizations' },
      isVerified: true,
      promotable: true,
      updatedAt: new Date().toISOString()
    };

    // Turn 2 asks continuation: "nama ukm pecinta alam stikom apa min?"
    // Current query has no explicit organization named entity, only category / intent cues
    const frame = resolveEffectiveSemanticFrame('nama ukm pecinta alam stikom apa min?', {
      sessionState: priorSession
    });

    expect(frame.domain.primary).toBe('student_organization');
    expect(frame.entities.length).toBeGreaterThanOrEqual(1);
    const mapalaEntity = frame.entities.find(e => e.canonical === 'Mapala Kompas');
    expect(mapalaEntity).toBeDefined();
    expect(mapalaEntity.family).toBe('organization');
    expect(mapalaEntity.provenance).toBe(PROVENANCE.PRIOR_CONTEXT_INHERITED);
  });

  // 8. INCOMPATIBLE_PRIOR_NOT_INHERITED
  test('INCOMPATIBLE_PRIOR_NOT_INHERITED: prior entity must NOT be inherited into incompatible domain', () => {
    const priorSession = {
      activeDomain: 'student_organization',
      activeEntity: { canonical: 'Mapala Kompas', type: 'ukm', family: 'organization' },
      isVerified: true,
      promotable: true,
      updatedAt: new Date().toISOString()
    };

    // Current turn switches to fee query without entity: "berapa biaya pendaftarannya?"
    const frame = resolveEffectiveSemanticFrame('berapa biaya pendaftarannya?', {
      sessionState: priorSession
    });

    // Mapala Kompas (organization) is incompatible with fee domain
    const hasMapala = frame.entities.some(e => e.canonical === 'Mapala Kompas');
    expect(hasMapala).toBe(false);
  });

  // 9. INHERITED_SLOT_PROVENANCE
  test('INHERITED_SLOT_PROVENANCE: inherited slots must accurately record PRIOR_CONTEXT_INHERITED', () => {
    const priorSession = {
      activeDomain: 'program',
      activeEntity: { canonical: 'S1 Bisnis Digital', type: 'program', family: 'program', group: 'programs' },
      isVerified: true,
      promotable: true,
      updatedAt: new Date().toISOString()
    };

    const frame = resolveEffectiveSemanticFrame('prospek kerjanya bagaimana?', {
      sessionState: priorSession
    });

    expect(frame.provenance.entities).toBe(PROVENANCE.PRIOR_CONTEXT_INHERITED);
    expect(frame.inheritedSemantics.entities.length).toBe(1);
    expect(frame.inheritedSemantics.entities[0].canonical).toBe('S1 Bisnis Digital');
  });

  // 10. SPECIFIC_FIELD_BEATS_GENERIC_FAMILY
  test('SPECIFIC_FIELD_BEATS_GENERIC_FAMILY: specific field outranks generic field family', () => {
    expect(isSpecificFieldAuthoritative('instagram', 'contact')).toBe(true);
    expect(isSpecificFieldAuthoritative('phone', 'contact')).toBe(true);
    expect(isSpecificFieldAuthoritative('email', 'contact')).toBe(true);
    expect(isSpecificFieldAuthoritative('tuitionFee', 'fee')).toBe(true);
    expect(isSpecificFieldAuthoritative('duration', 'temporal')).toBe(true);
  });

  // 11. INSTAGRAM_REMAINS_INSTAGRAM
  test('INSTAGRAM_REMAINS_INSTAGRAM: query asking for instagram must preserve instagram as primary field (PAR-09)', () => {
    const frame = resolveEffectiveSemanticFrame('akun instagram resmi itb stikom bali apa ya?');

    expect(frame.requestedFields).toContain('instagram');
    expect(frame.primaryField).toBe('instagram');
    expect(frame.fieldFamily).toBe('social_media');
    expect(frame.fieldRoot).toBe('contact');
    // Must NOT collapse to generic contact
    expect(frame.primaryField).not.toBe('contact');
  });

  // 12. CERTIFICATION_REMAINS_CERTIFICATION
  test('CERTIFICATION_REMAINS_CERTIFICATION: certification query must retain certification field and not mutate to PMB (CRT-02)', () => {
    const frame = resolveEffectiveSemanticFrame('apakah lulusan stikom mendapatkan sertifikat kompetensi?');

    expect(frame.requestedFields).toContain('certification');
    expect(frame.primaryField).toBe('certification');
    // Must not resolve domain to registration or pmb_requirements
    expect(frame.domain.primary).not.toBe('registration');
    expect(frame.domain.primary).not.toBe('pmb_requirements');
    expect(frame.intent.primary).not.toBe('ask_registration_requirements');
  });

  // 13. DURATION_REMAINS_DURATION
  test('DURATION_REMAINS_DURATION: "berapa tahun" must resolve to duration semantics, never fee', () => {
    const frame = resolveEffectiveSemanticFrame('berapa tahun durasi kuliah double degree dnui?');

    expect(frame.numericSemantics.isDurationMetric).toBe(true);
    expect(frame.requestedFields).toContain('duration');
    expect(frame.primaryField).toBe('duration');
    expect(frame.domain.primary).not.toBe('fee');
    expect(frame.intent.primary).not.toBe('ask_fee');
  });

  // 14. FEE_REMAINS_FEE
  test('FEE_REMAINS_FEE: financial fee query must resolve to fee requested field', () => {
    const frame = resolveEffectiveSemanticFrame('berapa biaya kuliah prodi TI per semester?');

    expect(frame.numericSemantics.isFeeMetric).toBe(true);
    expect(frame.domain.primary).toBe('fee');
    expect(frame.requestedFields).toContain('fee');
  });

  // 15. MULTI_SUBREQUEST_FRAMES_ISOLATED
  test('MULTI_SUBREQUEST_FRAMES_ISOLATED: independent subrequests must create isolated semantic frames', () => {
    const frame1 = resolveEffectiveSemanticFrame('akreditasi prodi TI apa?');
    const frame2 = resolveEffectiveSemanticFrame('lalu biaya kuliahnya berapa?', {
      localContext: { inheritedLocalAnchors: frame1.entities }
    });

    expect(frame1.primaryField).toBe('accreditation');
    expect(frame1.domain.primary).toBe('accreditation');

    expect(frame2.domain.primary).toBe('fee');
    expect(frame2.requestedFields).toContain('fee');
    expect(frame2.entities[0].canonical).toBe('Teknologi Informasi');
    expect(frame2.entities[0].provenance).toBe(PROVENANCE.MESSAGE_LOCAL_INHERITED);

    // Mutation test between frames
    expect(frame1.requestedFields).not.toEqual(frame2.requestedFields);
  });

  // 16. LEGACY_ADAPTER_CANNOT_MUTATE_FRAME
  test('LEGACY_ADAPTER_CANNOT_MUTATE_FRAME: legacy understanding & contract projections must not allow mutating underlying frame', () => {
    const frame = resolveEffectiveSemanticFrame('berapa biaya kuliah prodi SI?');
    const legacyUnderstanding = toLegacyUnderstanding(frame);
    const legacyContract = toLegacyContract(frame);

    expect(legacyUnderstanding).toBeDefined();
    expect(legacyContract).toBeDefined();

    // Legacy understanding attempt mutation
    expect(() => {
      legacyUnderstanding.domain.primary = 'hacked_domain';
    }).toThrow();

    expect(() => {
      legacyUnderstanding.requestedFields.push('hacked_field');
    }).toThrow();

    // Legacy contract attempt mutation
    expect(() => {
      legacyContract.intent = 'hacked_intent';
    }).toThrow();

    // Underlying frame remains completely unchanged
    expect(frame.domain.primary).toBe('fee');
  });

});
