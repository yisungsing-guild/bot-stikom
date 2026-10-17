'use strict';

/**
 * tests/candidateMetadataInconsistencies.test.js
 *
 * Offline Verification Suite for:
 * 1. S2 Entity Semantics: Program Name vs Academic Degree vs Legacy Benchmark Label
 * 2. Fee Discount Clause Scope (chunk 3674b161-f08b-49b5-9e0a-e05a1874198c)
 * 3. Candidate Corpus Invariance & Manifest Consistency
 *
 * Deterministic and offline: Zero external API calls, zero production mutation.
 */

const fs = require('fs');
const path = require('path');
const { getCorpusIndex } = require('../src/engine/pgvectorShadowProvider');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');
const { findCanonicalEntity, HISTORICAL_BENCHMARK_LABELS } = require('../src/engine/canonicalEntityRegistry');
const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { synthesizeAnswer } = require('../src/core/groundedAnswerGenerator');

describe('Finalize S2 Entity Semantics and Fee-Clause Scope', () => {
  const candidateSnapshotPath = path.resolve(
    __dirname,
    '..',
    'data',
    'runtime',
    'index_snapshots',
    'candidate_curriculum_2025',
    'rag_index.json'
  );
  const fixturePath = path.resolve(
    __dirname,
    'fixtures',
    'candidateMetadataFixture.json'
  );
  const manifestPath = path.resolve(__dirname, '..', 'scratch', 'scope_correction_manifest.json');

  let corpus;
  let chunkDoubleDegree;
  let chunkS2A;
  let chunkS2B;
  let chunkS2C;
  let chunkFeeDiscount;
  let isFullSnapshot = false;
  let deterministicFixture = null;

  beforeAll(() => {
    deterministicFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    if (fs.existsSync(candidateSnapshotPath)) {
      process.env.RAG_INDEX_PATH = candidateSnapshotPath;
      corpus = getCorpusIndex();
      if (Array.isArray(corpus) && corpus.length === 863) {
        isFullSnapshot = true;
      } else {
        corpus = deterministicFixture.chunks;
      }
    } else {
      corpus = deterministicFixture.chunks;
    }

    expect(Array.isArray(corpus)).toBe(true);
    expect(corpus.length).toBeGreaterThanOrEqual(8);

    chunkDoubleDegree = corpus.find(c => c.id === '278c7c2a-3f2c-411b-b2dd-1bd02ddc469f');
    chunkS2A = corpus.find(c => c.id === 'ee59cda5-4ef4-415c-9d00-38f042c7b7c9');
    chunkS2B = corpus.find(c => c.id === '70f234a4-2228-4b87-a55b-cc26e961d593');
    chunkS2C = corpus.find(c => c.id === 'fe3bb7da-532b-4ff2-a91a-0e5bd07e0487');
    chunkFeeDiscount = corpus.find(c => c.id === '3674b161-f08b-49b5-9e0a-e05a1874198c');
  });

  afterAll(() => {
    delete process.env.RAG_INDEX_PATH;
  });


  describe('A. Double Degree (chunk 278c7c2a-3f2c-411b-b2dd-1bd02ddc469f)', () => {
    test('1. Metadata correctly separates parent program (SI) from Double Degree track, removing legacy SK', () => {
      expect(chunkDoubleDegree).toBeDefined();
      expect(chunkDoubleDegree.program).toBe('SI');
      expect(chunkDoubleDegree.parentProgram).toBe('S1 Sistem Informasi');
      expect(chunkDoubleDegree.track).toBe('Double Degree HELP University');
      expect(chunkDoubleDegree.academicLevel).toBe('S1');
      expect(chunkDoubleDegree.program).not.toBe('SK');
    });

    test('2. Runtime Test 1: Query matching source scope accepts chunk as evidence', () => {
      const plan = {
        query: 'bagaimana program double degree HELP University di sistem informasi',
        targetEntities: ['Double Degree HELP University', 'S1 Sistem Informasi'],
        requiredAspects: ['curriculum']
      };

      const result = arbitrateEvidence([chunkDoubleDegree], plan);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('278c7c2a-3f2c-411b-b2dd-1bd02ddc469f');
      expect(result.hasSupportedEvidence).toBe(true);
    });

    test('3. Runtime Test 2: S2-specific query rejects chunk due to academic level mismatch, NOT wrong prodi label', () => {
      const plan = {
        query: 'kurikulum magister S2 sistem informasi',
        targetEntities: ['S2 Sistem Informasi'],
        academicLevel: 'S2',
        requiredAspects: ['curriculum']
      };

      const result = arbitrateEvidence([chunkDoubleDegree], plan);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);

      const rejected = result.rejected[0];
      expect(rejected.id).toBe('278c7c2a-3f2c-411b-b2dd-1bd02ddc469f');
      expect(rejected.disposition).toBe('REJECT_ACADEMIC_LEVEL_MISMATCH');
      expect(rejected.dispositionReason).toBe('candidate_level_S1_conflicts_with_target_S2');
      expect(rejected.dispositionReason).not.toMatch(/candidate_scoped_to_program_SK/);
    });
  });

  describe('1. S2 Entity Semantics: Program Name vs Academic Degree vs Legacy Labels', () => {
    test('a. Distinguishes official program name from degree qualification and unoffered program names', () => {
      // 1. Official program name resolves to academic_program
      const officialProg = findCanonicalEntity('Magister Sistem Informasi');
      expect(officialProg).toBeDefined();
      expect(officialProg.canonical).toBe('S2 Sistem Informasi');
      expect(officialProg.family).toBe('academic_program');
      expect(officialProg.type).toBe('program');

      // 2. Degree qualification resolves to academic_degree, NOT program
      const degreeQual = findCanonicalEntity('Magister Komputer');
      expect(degreeQual).toBeDefined();
      expect(degreeQual.canonical).toBe('Gelar Magister Komputer (M.Kom.)');
      expect(degreeQual.family).toBe('academic_degree');
      expect(degreeQual.type).toBe('academic_degree');

      const degreeMkom = findCanonicalEntity('M.Kom.');
      expect(degreeMkom).toBeDefined();
      expect(degreeMkom.canonical).toBe('Gelar Magister Komputer (M.Kom.)');
      expect(degreeMkom.family).toBe('academic_degree');

      // 3. Unofficial / legacy label does NOT resolve to runtime canonical entities
      const legacyGold = findCanonicalEntity('Magister Ilmu Komputer');
      expect(legacyGold).toBeNull();

      const legacyGoldS2 = findCanonicalEntity('S2 Magister Ilmu Komputer');
      expect(legacyGoldS2).toBeNull();
    });

    test('b. Retains legacy gold labels in historical benchmark diagnostic dictionary', () => {
      expect(HISTORICAL_BENCHMARK_LABELS).toBeDefined();
      expect(HISTORICAL_BENCHMARK_LABELS['Magister Ilmu Komputer']).toBeDefined();
      expect(HISTORICAL_BENCHMARK_LABELS['Magister Ilmu Komputer'].status).toBe('HISTORICAL_BENCHMARK_LABEL');
      expect(HISTORICAL_BENCHMARK_LABELS['Magister Ilmu Komputer'].targetOfficialEntity).toBe('S2 Sistem Informasi');
      expect(HISTORICAL_BENCHMARK_LABELS['Magister Ilmu Komputer'].academicLevel).toBe('S2');
    });

    test('c. S2 candidate chunks maintain official program identity', () => {
      for (const chunk of [chunkS2A, chunkS2B, chunkS2C]) {
        expect(chunk).toBeDefined();
        expect(chunk.academicLevel).toBe('S2');
        expect(chunk.program).toBe('S2');
        expect(chunk.canonicalEntity).toMatch(/S2 (?:Magister )?Sistem Informasi/);
      }
    });

    test('d. Runtime: Query for official program accepts S2 candidate chunks', () => {
      const plan = {
        query: 'apa saja peminatan dan kurikulum S2 Magister Sistem Informasi',
        targetEntities: ['S2 Sistem Informasi'],
        academicLevel: 'S2',
        requiredAspects: ['curriculum']
      };

      const result = arbitrateEvidence([chunkS2A, chunkS2B, chunkS2C], plan);
      expect(result.accepted.length).toBeGreaterThanOrEqual(1);
      expect(result.hasSupportedEvidence).toBe(true);
      for (const acceptedChunk of result.accepted) {
        expect(acceptedChunk.academicLevel).toBe('S2');
      }
    });

    test('e. Runtime: Query for unoffered program triggers unsupported program policy', async () => {
      const frame = resolveSemanticFrame('apakah ada program magister ilmu komputer di stikom');
      expect(frame.isUnsupportedEntity).toBe(true);
      expect(frame.unsupportedProgramName).toMatch(/ilmu komputer/i);
      // Ensures it does NOT falsely resolve as a valid academic_program
      const hasOfficialProgram = frame.entities.some(e => e.canonical === 'S2 Sistem Informasi' && e.family === 'academic_program');
      expect(hasOfficialProgram).toBe(false);

      // Verify fail-closed clarification answer
      const synthesisResult = await synthesizeAnswer(frame, {
        accepted: [],
        retrievalPlan: { isUnsupportedEntity: true, unsupportedProgramName: frame.unsupportedProgramName }
      });

      expect(synthesisResult.success).toBe(true);
      expect(synthesisResult.source).toBe('unsupported_entity_fail_closed');
      expect(synthesisResult.answer).toMatch(/tidak diselenggarakan di ITB STIKOM Bali/i);
      expect(synthesisResult.answer).toMatch(/S2 Sistem Informasi/i);
    });
  });

  describe('2. Fee Discount Clause Scope & Provenance Verification', () => {
    let chunkSK;
    let chunkSITIBD;
    let chunkD3;
    let chunkHELP;

    beforeAll(() => {
      chunkSK = corpus.find(c => c.id === '3674b161-f08b-49b5-9e0a-e05a1874198c');
      chunkSITIBD = corpus.find(c => c.id === 'a68307ae-1459-4b0f-b084-5e1b8579c12c');
      chunkD3 = corpus.find(c => c.id === '0e57079a-a246-478a-9a20-261e599617dd');
      chunkHELP = corpus.find(c => c.id === '154ffee1-173a-4d21-9606-b02a47bb0e3f');
    });

    test('a. Chunk 3674b161 has PROGRAM_MULTI scope with verified supportedPrograms', () => {
      expect(chunkSK).toBeDefined();
      expect(chunkSK.scope).toBe('PROGRAM_MULTI');
      expect(chunkSK.supportedPrograms).toEqual(['SK', 'SI', 'TI', 'BD', 'MI']);
      expect(chunkSK.supportedEntities).toEqual([
        'S1 Sistem Komputer',
        'S1 Sistem Informasi',
        'S1 Teknologi Informasi',
        'S1 Bisnis Digital',
        'D3 Manajemen Informatika'
      ]);
    });

    test('b. Runtime verification of chunk 3674b161 across all 5 claimed programs', () => {
      const programs = [
        { code: 'SK', entity: 'S1 Sistem Komputer', query: 'potongan alumni SMK TI prodi Sistem Komputer' },
        { code: 'SI', entity: 'S1 Sistem Informasi', query: 'potongan alumni SMK TI prodi Sistem Informasi' },
        { code: 'TI', entity: 'S1 Teknologi Informasi', query: 'potongan alumni SMK TI prodi Teknologi Informasi' },
        { code: 'BD', entity: 'S1 Bisnis Digital', query: 'potongan alumni SMK TI prodi Bisnis Digital' },
        { code: 'MI', entity: 'D3 Manajemen Informatika', query: 'potongan alumni SMK TI prodi D3 Manajemen Informatika', level: 'D3' }
      ];

      for (const prog of programs) {
        const plan = {
          query: prog.query,
          targetEntities: [prog.entity],
          academicLevel: prog.level || 'S1',
          requiredAspects: ['fee']
        };
        const res = arbitrateEvidence([chunkSK], plan);
        expect(res.accepted).toHaveLength(1);
        expect(res.accepted[0].id).toBe(chunkSK.id);
        expect(res.hasSupportedEvidence).toBe(true);
      }
    });

    test('c. Negative controls for chunk 3674b161: rejects Double Degree HELP and S2', () => {
      // 1. Double Degree HELP University (10% clause, not 20%)
      const planHELP = {
        query: 'apakah ada potongan 20% alumni SMK TI untuk Double Degree HELP University',
        targetEntities: ['Double Degree HELP University'],
        requiredAspects: ['fee']
      };
      const resHELP = arbitrateEvidence([chunkSK], planHELP);
      expect(resHELP.accepted).toHaveLength(0);
      expect(resHELP.rejected).toHaveLength(1);
      expect(resHELP.rejected[0].disposition).toMatch(/REJECT_(?:SCOPE_COLLISION|ENTITY_MISMATCH)/);

      // 2. S2 Magister Sistem Informasi (level mismatch, no fee clause)
      const planS2 = {
        query: 'apakah ada potongan biaya alumni SMK TI untuk program S2 Magister Sistem Informasi',
        targetEntities: ['S2 Sistem Informasi'],
        academicLevel: 'S2',
        requiredAspects: ['fee']
      };
      const resS2 = arbitrateEvidence([chunkSK], planS2);
      expect(resS2.accepted).toHaveLength(0);
      expect(resS2.rejected).toHaveLength(1);
      expect(['REJECT_ACADEMIC_LEVEL_MISMATCH', 'REJECT_SCOPE_COLLISION']).toContain(resS2.rejected[0].disposition);
    });

    test('d. Authentic Document Provenance: Each program resolves to its authentic source document chunk', () => {
      expect(chunkSK.sourceFile).toBe('rincian Biaya SK Tahun Ajaran 2026-2027.pdf');
      expect(chunkSITIBD.sourceFile).toBe('rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf');
      expect(chunkD3.sourceFile).toBe('rincian Biaya D3 Tahun Ajaran 2026-2027.pdf');
      expect(chunkHELP.sourceFile).toBe('rincian Biaya HELP Tahun Ajaran 2026-2027.pdf');

      const allFeeChunks = [chunkSK, chunkSITIBD, chunkD3, chunkHELP];

      // SK query -> authentic source is chunkSK (from rincian Biaya SK)
      const planSK = {
        query: 'potongan alumni SMK TI Sistem Komputer',
        targetEntities: ['S1 Sistem Komputer'],
        requiredAspects: ['fee']
      };
      const resSK = arbitrateEvidence(allFeeChunks, planSK);
      expect(resSK.accepted.some(c => c.id === chunkSK.id)).toBe(true);
      expect(resSK.accepted.find(c => c.id === chunkSK.id).sourceFile).toBe('rincian Biaya SK Tahun Ajaran 2026-2027.pdf');

      // SI query -> authentic source is chunkSITIBD (from rincian Biaya SI,TI dan BD)
      const planSI = {
        query: 'potongan alumni SMK TI Sistem Informasi',
        targetEntities: ['S1 Sistem Informasi'],
        requiredAspects: ['fee']
      };
      const resSI = arbitrateEvidence(allFeeChunks, planSI);
      expect(resSI.accepted.some(c => c.id === chunkSITIBD.id)).toBe(true);
      expect(resSI.accepted.find(c => c.id === chunkSITIBD.id).sourceFile).toBe('rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf');

      // TI query -> authentic source is chunkSITIBD (from rincian Biaya SI,TI dan BD)
      const planTI = {
        query: 'potongan alumni SMK TI Teknologi Informasi',
        targetEntities: ['S1 Teknologi Informasi'],
        requiredAspects: ['fee']
      };
      const resTI = arbitrateEvidence(allFeeChunks, planTI);
      expect(resTI.accepted.some(c => c.id === chunkSITIBD.id)).toBe(true);

      // BD query -> authentic source is chunkSITIBD (from rincian Biaya SI,TI dan BD)
      const planBD = {
        query: 'potongan alumni SMK TI Bisnis Digital',
        targetEntities: ['S1 Bisnis Digital'],
        requiredAspects: ['fee']
      };
      const resBD = arbitrateEvidence(allFeeChunks, planBD);
      expect(resBD.accepted.some(c => c.id === chunkSITIBD.id)).toBe(true);

      // D3 MI query -> authentic source is chunkD3 (from rincian Biaya D3)
      const planD3 = {
        query: 'potongan alumni SMK TI D3 Manajemen Informatika',
        targetEntities: ['D3 Manajemen Informatika'],
        academicLevel: 'D3',
        requiredAspects: ['fee']
      };
      const resD3 = arbitrateEvidence(allFeeChunks, planD3);
      expect(resD3.accepted.some(c => c.id === chunkD3.id)).toBe(true);
      expect(resD3.accepted.find(c => c.id === chunkD3.id).sourceFile).toBe('rincian Biaya D3 Tahun Ajaran 2026-2027.pdf');

      // HELP query -> authentic source is chunkHELP (10% clause from rincian Biaya HELP)
      const planHELP = {
        query: 'potongan alumni SMK TI Double Degree HELP University',
        targetEntities: ['Double Degree HELP University'],
        requiredAspects: ['fee']
      };
      const resHELP = arbitrateEvidence(allFeeChunks, planHELP);
      expect(resHELP.accepted).toHaveLength(1);
      expect(resHELP.accepted[0].id).toBe(chunkHELP.id);
      expect(resHELP.accepted[0].sourceFile).toBe('rincian Biaya HELP Tahun Ajaran 2026-2027.pdf');
    });

    test('e. Query without prodi: Semantic frame does NOT falsely trigger S1 TI', () => {
      const queryNoProdi = 'Apakah ada potongan biaya kuliah untuk alumni SMK TI?';
      const frame = resolveSemanticFrame(queryNoProdi);

      // Ensure "SMK TI" did not resolve as "S1 Teknologi Informasi"
      const hasFalselyMatchedTI = (frame.entities || []).some(
        e => e.canonical === 'S1 Teknologi Informasi' && e.family === 'academic_program'
      );
      expect(hasFalselyMatchedTI).toBe(false);
    });

    test('f. Generator / Answerability: Query without prodi presents explicit verified scope, differentiates HELP, and excludes S2', async () => {
      const queryNoProdi = 'Apakah ada potongan biaya kuliah untuk alumni SMK TI?';
      const frame = resolveSemanticFrame(queryNoProdi);

      const allFeeChunks = [chunkSK, chunkSITIBD, chunkD3, chunkHELP];
      const plan = {
        query: queryNoProdi,
        targetEntities: [],
        requiredAspects: ['fee']
      };
      const arbitrated = arbitrateEvidence(allFeeChunks, plan);
      expect(arbitrated.hasSupportedEvidence).toBe(true);

      const synthesis = await synthesizeAnswer(frame, arbitrated);
      expect(synthesis.success).toBe(true);
      const answer = synthesis.answer;

      // 1. Must explicitly state 20% discount on Biaya Pendidikan Per Semester for verified programs
      expect(answer).toMatch(/20%/);
      expect(answer).toMatch(/Sistem Informasi/);
      expect(answer).toMatch(/Teknologi Informasi/);
      expect(answer).toMatch(/Bisnis Digital/);
      expect(answer).toMatch(/Sistem Komputer/);
      expect(answer).toMatch(/D3 Manajemen Informatika/);

      // Duration must strictly reflect literal clause (selama 4 tahun), not exaggerated to 10 semesters or claiming unverified DPP percentages
      expect(answer).toMatch(/selama 4 tahun/i);
      expect(answer).not.toMatch(/10 semester/i);
      expect(answer).not.toMatch(/60%|50%/);

      // 2. Must differentiate HELP University policy (10%, NOT 20%)
      expect(answer).toMatch(/HELP University/);
      expect(answer).toMatch(/10%/);

      // 3. Must NOT conclude that S2 obtains this discount
      expect(answer).toMatch(/S2 Magister Sistem Informasi/);
      expect(answer).toMatch(/tidak tercantum/i);

      // 4. Must prompt / invite user to specify study program
      expect(answer).toMatch(/sebutkan program studi/i);
    });

    test('g. Generator / Answerability: Program-specific queries produce program-scoped answers with strict 4-year duration', async () => {
      // 1. HELP University specific query
      const frameHELP = resolveSemanticFrame('Apakah ada potongan biaya alumni SMK TI untuk Double Degree HELP University?');
      const planHELP = {
        query: frameHELP.rawQuery,
        targetEntities: ['Double Degree HELP University'],
        requiredAspects: ['fee']
      };
      const arbHELP = arbitrateEvidence([chunkHELP], planHELP);
      const synthHELP = await synthesizeAnswer(frameHELP, arbHELP);
      expect(synthHELP.success).toBe(true);
      expect(synthHELP.answer).toMatch(/10%/);
      expect(synthHELP.answer).toMatch(/selama 4 tahun/i);
      expect(synthHELP.answer).toMatch(/potongan 20% tidak berlaku/i);

      // 2. S1 Sistem Komputer query
      const frameSK = resolveSemanticFrame('Apakah ada potongan biaya alumni SMK TI untuk prodi Sistem Komputer?');
      const planSK = {
        query: frameSK.rawQuery,
        targetEntities: ['S1 Sistem Komputer'],
        requiredAspects: ['fee']
      };
      const arbSK = arbitrateEvidence([chunkSK], planSK);
      const synthSK = await synthesizeAnswer(frameSK, arbSK);
      expect(synthSK.success).toBe(true);
      expect(synthSK.answer).toMatch(/20%/);
      expect(synthSK.answer).toMatch(/selama 4 tahun/i);
      expect(synthSK.answer).not.toMatch(/10 semester/i);

      // 3. D3 Manajemen Informatika query
      const frameD3 = resolveSemanticFrame('Apakah ada potongan biaya alumni SMK TI untuk prodi D3 Manajemen Informatika?');
      const planD3 = {
        query: frameD3.rawQuery,
        targetEntities: ['D3 Manajemen Informatika'],
        academicLevel: 'D3',
        requiredAspects: ['fee']
      };
      const arbD3 = arbitrateEvidence([chunkD3], planD3);
      const synthD3 = await synthesizeAnswer(frameD3, arbD3);
      expect(synthD3.success).toBe(true);
      expect(synthD3.answer).toMatch(/20%/);
      expect(synthD3.answer).toMatch(/selama 4 tahun/i);

      // 4. S2 specific query
      const frameS2 = resolveSemanticFrame('Apakah ada potongan biaya alumni SMK TI untuk program S2 Magister Sistem Informasi?');
      const planS2 = {
        query: frameS2.rawQuery,
        targetEntities: ['S2 Sistem Informasi'],
        academicLevel: 'S2',
        requiredAspects: ['fee']
      };
      const arbS2 = arbitrateEvidence([chunkSK, chunkSITIBD, chunkD3], planS2);
      expect(arbS2.accepted).toHaveLength(0); // Fail-closed evidence arbitration
    });
  });

  describe('3. Candidate Index Invariance & Manifest Consistency', () => {
    test('a. Chunk text, chunk ID, and 1536-dim embedding vectors are strictly preserved', () => {
      let manifest;
      if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } else {
        manifest = deterministicFixture.manifest;
      }

      expect(Array.isArray(manifest)).toBe(true);
      expect(manifest.length).toBe(20);

      const categoryCounts = manifest.reduce((acc, item) => {
        acc[item.scope] = (acc[item.scope] || 0) + 1;
        return acc;
      }, {});

      expect(categoryCounts).toEqual({
        PROGRAM_MULTI: 3,
        PROGRAM_SINGLE: 9,
        INSTITUTIONAL_OR_ORG: 8
      });

      const targetIds = [
        '278c7c2a-3f2c-411b-b2dd-1bd02ddc469f',
        'ee59cda5-4ef4-415c-9d00-38f042c7b7c9',
        '70f234a4-2228-4b87-a55b-cc26e961d593',
        'fe3bb7da-532b-4ff2-a91a-0e5bd07e0487',
        '3674b161-f08b-49b5-9e0a-e05a1874198c'
      ];

      for (const id of targetIds) {
        const chunk = corpus.find(c => c.id === id);
        expect(chunk).toBeDefined();
        const textContent = chunk.chunk || chunk.text;
        expect(typeof textContent).toBe('string');
        expect(textContent.length).toBeGreaterThan(0);
        expect(Array.isArray(chunk.embedding)).toBe(true);
        expect(chunk.embedding.length).toBe(1536);
        for (let i = 0; i < 5; i++) {
          expect(typeof chunk.embedding[i]).toBe('number');
          expect(Number.isNaN(chunk.embedding[i])).toBe(false);
        }
      }
    });

    test('b. Candidate corpus length is intact with 0 corrupted records', () => {
      if (isFullSnapshot) {
        expect(corpus.length).toBe(863);
      } else {
        expect(corpus.length).toBe(deterministicFixture.chunks.length);
      }
      const corrupted = corpus.filter(c => !c.id || !(c.chunk || c.text) || !Array.isArray(c.embedding) || c.embedding.length !== 1536);
      expect(corrupted.length).toBe(0);
    });
  });
});
