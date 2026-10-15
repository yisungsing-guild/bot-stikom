const fs = require('fs');
const path = require('path');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');

describe('Final Bounded Remediation Regression: Q062 Dormitory Corpus Gap and Q007, Q008, Q026 Wrong-Entity Protection', () => {
  const corpusPath = path.resolve(__dirname, '../scratch/corpus_snapshot_candidate_curriculum_2025.json');
  let corpus;

  beforeAll(() => {
    corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  });

  describe('Task A: Q062 Dormitory Room Rental Corpus Gap Protection', () => {
    test('General tuition fee chunks must NOT be accepted for dormitory room rental inquiries', () => {
      const tuitionFeeChunk = corpus.find(c => c.id.startsWith('67534925'));
      expect(tuitionFeeChunk).toBeDefined();

      const plan = {
        domain: 'FACILITIES',
        intent: 'FACILITY_INQUIRY',
        requiredAspects: ['facilities', 'lab', 'campus_infrastructure', 'fee', 'sewa_gedung'],
        queryVariants: ['Berapa biaya sewa kamar asrama putri di dekat kampus Jimbaran?'],
        rawQuery: 'Berapa biaya sewa kamar asrama putri di dekat kampus Jimbaran?'
      };

      const result = arbitrateEvidence([tuitionFeeChunk], plan);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('evidence_does_not_contain_dormitory_rental_rates');
    });

    test('Positive Control: Actual dormitory or room rental rate chunk is accepted for dormitory rental inquiry', () => {
      const mockDormitoryChunk = {
        id: 'mock-dormitory-fee-chunk',
        chunk: 'Tarif sewa kamar asrama mahasiswa putri kampus Jimbaran adalah Rp 500.000 per bulan.',
        filename: 'panduan_fasilitas_asrama.pdf',
        category: 'FACILITIES',
        academicLevel: 'Umum'
      };

      const plan = {
        domain: 'FACILITIES',
        intent: 'FACILITY_INQUIRY',
        requiredAspects: ['facilities', 'lab', 'campus_infrastructure', 'fee', 'sewa_gedung'],
        queryVariants: ['Berapa biaya sewa kamar asrama putri di dekat kampus Jimbaran?'],
        rawQuery: 'Berapa biaya sewa kamar asrama putri di dekat kampus Jimbaran?'
      };

      const result = arbitrateEvidence([mockDormitoryChunk], plan);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe('mock-dormitory-fee-chunk');
    });
  });

  describe('Task B: Wrong-Entity Protection (Q007, Q008, Q026)', () => {
    test('Q007 & Q008: S1 Sistem Informasi description chunk 45a2e176 must NOT be accepted for S1 Sistem Komputer inquiries', () => {
      const c45 = corpus.find(c => c.id.startsWith('45a2e176'));
      expect(c45).toBeDefined();

      const planSKAccreditation = {
        domain: 'ACCREDITATION',
        intent: 'ACCREDITATION_INQUIRY',
        targetEntities: ['S1 Sistem Komputer'],
        requiredAspects: ['accreditation'],
        queryVariants: ['Bagaimana status dan peringkat akreditasi S1 Sistem Komputer?'],
        rawQuery: 'Bagaimana status dan peringkat akreditasi S1 Sistem Komputer?'
      };

      const resultAccreditation = arbitrateEvidence([c45], planSKAccreditation);
      expect(resultAccreditation.accepted).toHaveLength(0);
      expect(resultAccreditation.rejected).toHaveLength(1);
      expect(resultAccreditation.rejected[0].reason).toContain('candidate_scoped_to_program_SI_not_SK');

      const planSKCareer = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        targetEntities: ['S1 Sistem Komputer'],
        requiredAspects: ['overview'],
        queryVariants: ['Apa peluang karier utama bagi lulusan sarjana S1 Sistem Komputer?'],
        rawQuery: 'Apa peluang karier utama bagi lulusan sarjana S1 Sistem Komputer?'
      };

      const resultCareer = arbitrateEvidence([c45], planSKCareer);
      expect(resultCareer.accepted).toHaveLength(0);
      expect(resultCareer.rejected).toHaveLength(1);
      expect(resultCareer.rejected[0].reason).toContain('candidate_scoped_to_program_SI_not_SK');
    });

    test('Positive Control: S1 Sistem Komputer accreditation chunk must be accepted for S1 Sistem Komputer inquiries', () => {
      const cSKAccred = corpus.find(c => c.id.startsWith('aafc4317'));
      expect(cSKAccred).toBeDefined();

      const planSKAccreditation = {
        domain: 'ACCREDITATION',
        intent: 'ACCREDITATION_INQUIRY',
        targetEntities: ['S1 Sistem Komputer'],
        requiredAspects: ['accreditation'],
        queryVariants: ['Bagaimana status dan peringkat akreditasi S1 Sistem Komputer?'],
        rawQuery: 'Bagaimana status dan peringkat akreditasi S1 Sistem Komputer?'
      };

      const result = arbitrateEvidence([cSKAccred], planSKAccreditation);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe(cSKAccred.id);
    });

    test('Q026: Double Degree S1 chunk ef903a22 must NOT be accepted for S2 graduate program listing', () => {
      const cef = corpus.find(c => c.id.startsWith('ef903a22'));
      expect(cef).toBeDefined();

      const planS2List = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        academicLevel: 'S2',
        targetEntities: [],
        requiredAspects: ['general'],
        queryVariants: ['Apa nama program pascasarjana yang diselenggarakan di ITB STIKOM Bali?'],
        rawQuery: 'Apa nama program pascasarjana yang diselenggarakan di ITB STIKOM Bali?'
      };

      const result = arbitrateEvidence([cef], planS2List);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('candidate_level_S1_conflicts_with_target_S2');
    });

    test('Positive Control: S2 Master of Information Systems chunk must be accepted for S2 inquiries', () => {
      const cS2 = corpus.find(c => c.id.startsWith('577873e2'));
      expect(cS2).toBeDefined();

      const planS2List = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        academicLevel: 'S2',
        targetEntities: [],
        requiredAspects: ['general'],
        queryVariants: ['Apa nama program pascasarjana yang diselenggarakan di ITB STIKOM Bali?'],
        rawQuery: 'Apa nama program pascasarjana yang diselenggarakan di ITB STIKOM Bali?'
      };

      const result = arbitrateEvidence([cS2], planS2List);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe(cS2.id);
    });
  });

  describe('Task C: Q023 D3 Manajemen Informatika Career Prospects Retrieval & Rejection of Fee Docs', () => {
    const { retrieveCandidates } = require('../src/core/retrievalService');

    test('Q023: Career chunk 57aeef6a must be retrieved in Top-12 for D3 MI career inquiry', async () => {
      const plan = {
        rawQuery: 'Bagaimana peluang karier bagi lulusan D3 Manajemen Informatika?',
        query: 'Bagaimana peluang karier bagi lulusan D3 Manajemen Informatika?',
        queryVariants: ['Bagaimana peluang karier bagi lulusan D3 Manajemen Informatika?'],
        domain: 'ACADEMIC_CURRICULUM',
        intent: 'CAREER_PROSPECTS_INQUIRY',
        targetEntities: ['D3 Manajemen Informatika'],
        targetLevels: ['D3'],
        requiredAspects: ['prospek_karir', 'career_prospects'],
        topK: 12
      };

      const candidates = await retrieveCandidates(plan);
      const topIds = candidates.map(c => c.id);
      expect(topIds.some(id => id.includes('57aeef6a'))).toBe(true);
    });

    test('Q023: Career chunk 57aeef6a is accepted as valid career evidence for D3 MI', async () => {
      const plan = {
        domain: 'ACADEMIC_CURRICULUM',
        intent: 'CAREER_PROSPECTS_INQUIRY',
        targetEntities: ['D3 Manajemen Informatika'],
        targetLevels: ['D3'],
        requiredAspects: ['prospek_karir', 'career_prospects'],
        rawQuery: 'Bagaimana peluang karier bagi lulusan D3 Manajemen Informatika?',
        query: 'Bagaimana peluang karier bagi lulusan D3 Manajemen Informatika?',
        queryVariants: ['Bagaimana peluang karier bagi lulusan D3 Manajemen Informatika?'],
        topK: 12
      };

      const candidates = await retrieveCandidates(plan);
      const careerCand = candidates.find(c => c.id.includes('57aeef6a'));
      expect(careerCand).toBeDefined();

      const result = arbitrateEvidence([careerCand], plan);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe(careerCand.id);
      expect(result.rejected).toHaveLength(0);
    });

    test('Q023: Tuition fee documents must be REJECTED for career inquiries', () => {
      const feeChunk = corpus.find(c => c.id.startsWith('88fa83c7'));
      expect(feeChunk).toBeDefined();

      const plan = {
        domain: 'ACADEMIC_CURRICULUM',
        intent: 'CAREER_PROSPECTS_INQUIRY',
        targetEntities: ['D3 Manajemen Informatika'],
        targetLevels: ['D3'],
        requiredAspects: ['prospek_karir', 'career_prospects'],
        rawQuery: 'Bagaimana peluang karier bagi lulusan D3 Manajemen Informatika?'
      };

      const result = arbitrateEvidence([feeChunk], plan);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('evidence_is_fee_document_not_career_prospect');
    });
  });

  describe('Task D: Q056 Academic Calendar Suppression & Thesis Guidelines Acceptance', () => {
    const { retrieveCandidates } = require('../src/core/retrievalService');

    test('Q056: Pedoman TA chunks must be retrieved in Top-12 for S1 thesis inquiries', async () => {
      const plan = {
        rawQuery: 'Apa saja persyaratan akademik untuk mengajukan Tugas Akhir pada jenjang S1?',
        query: 'Apa saja persyaratan akademik untuk mengajukan Tugas Akhir pada jenjang S1?',
        queryVariants: ['Apa saja persyaratan akademik untuk mengajukan Tugas Akhir pada jenjang S1?'],
        domain: 'ACADEMIC_CURRICULUM',
        intent: 'ACADEMIC_POLICY_INQUIRY',
        targetEntities: ['ITB STIKOM Bali'],
        targetLevels: ['S1'],
        requiredAspects: ['pedoman_ta', 'curriculum'],
        topK: 12
      };

      const candidates = await retrieveCandidates(plan);
      const topIds = candidates.map(c => c.id);
      expect(topIds.some(id => id.includes('6e82911f') || id.includes('f2503a86'))).toBe(true);
    });

    test('Q056: Academic calendar timetable chunks must be REJECTED for thesis requirement inquiries', () => {
      const calChunk = corpus.find(c => c.id.startsWith('07d8ecb0'));
      expect(calChunk).toBeDefined();

      const plan = {
        domain: 'ACADEMIC_CURRICULUM',
        intent: 'ACADEMIC_POLICY_INQUIRY',
        targetEntities: ['ITB STIKOM Bali'],
        targetLevels: ['S1'],
        requiredAspects: ['pedoman_ta', 'curriculum'],
        rawQuery: 'Apa saja persyaratan akademik untuk mengajukan Tugas Akhir pada jenjang S1?'
      };

      const result = arbitrateEvidence([calChunk], plan);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('evidence_is_academic_calendar_not_thesis_guideline');
    });

    test('Q056: Pedoman TA chunk is ACCEPTED for thesis requirement inquiries', () => {
      const taChunk = corpus.find(c => c.id.startsWith('6e82911f'));
      expect(taChunk).toBeDefined();

      const plan = {
        domain: 'ACADEMIC_CURRICULUM',
        intent: 'ACADEMIC_POLICY_INQUIRY',
        targetEntities: ['ITB STIKOM Bali'],
        targetLevels: ['S1'],
        requiredAspects: ['pedoman_ta', 'curriculum'],
        rawQuery: 'Apa saja persyaratan akademik untuk mengajukan Tugas Akhir pada jenjang S1?'
      };

      const result = arbitrateEvidence([taChunk], plan);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].id).toBe(taChunk.id);
    });
  });

  describe('Task E: Q023 End-to-End Answerability & Cross-Entity Isolation', () => {
    const { processTurn } = require('../src/core/orchestrator');

    test('Q023 produces a substantive answer about D3 Manajemen Informatika career prospects', async () => {
      const q23 = 'Peluang karier dan pekerjaan apa saja yang tersedia untuk lulusan D3 Manajemen Informatika?';
      const res = await processTurn('test_q23_e2e', q23);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/D3\s+Manajemen\s+Informatika/i);
      expect(res.finalAnswer).toMatch(/Staff|IT\s+Administration|Document\s+Controller|Information\s+Management|Database/i);
      expect(res.subQueryResults?.[0]?.verification?.pass).toBe(true);
    }, 20000);

    test('Profession examples in Q023 answer are supported by the accepted source chunk', async () => {
      const q23 = 'Peluang karier dan pekerjaan apa saja yang tersedia untuk lulusan D3 Manajemen Informatika?';
      const res = await processTurn('test_q23_grounding', q23);
      const accepted = res.subQueryResults?.[0]?.arbitrated?.accepted || [];
      expect(accepted.length).toBeGreaterThan(0);
      const goldAccepted = accepted.find(a => a.id.startsWith('57aeef6a'));
      expect(goldAccepted).toBeDefined();
      const answer = res.finalAnswer.toLowerCase();
      const hasSupportedProfession = /staff|information management|it administration|document controller|digital archive/i.test(answer);
      expect(hasSupportedProfession).toBe(true);
    }, 20000);

    test('Descriptions of S1 Sistem Informasi or sibling programs are NOT mixed into Q023 answer', async () => {
      const q23 = 'Peluang karier dan pekerjaan apa saja yang tersedia untuk lulusan D3 Manajemen Informatika?';
      const res = await processTurn('test_q23_no_cross_entity', q23);
      const answer = res.finalAnswer;
      expect(answer).not.toMatch(/S1\s+Sistem\s+Informasi/i);
      expect(answer).not.toMatch(/S1\s+Sistem\s+Komputer/i);
      expect(answer).not.toMatch(/S1\s+Teknologi\s+Informasi/i);
      expect(answer).not.toMatch(/S1\s+Bisnis\s+Digital/i);
      expect(res.subQueryResults?.[0]?.verification?.pass).toBe(true);
    }, 20000);

    const cases = [
      { id: 'Q005', q: 'Apa nama himpunan mahasiswa untuk program studi Sistem Informasi?', match: /HIMAPRODI\s+SI/i },
      { id: 'Q010', q: 'Apa kegiatan organisasi Himpunan Mahasiswa Sistem Komputer (HIMA SK)?', match: /HIMA\s+SK|Sistem\s+Komputer/i },
      { id: 'Q015', q: 'Apa profil himpunan mahasiswa program studi Teknologi Informasi?', match: /HIMAPRODI\s+TI|Teknologi\s+Informasi/i },
      { id: 'Q030', q: 'Berapa nomor telepon kampus pascasarjana ITB STIKOM Bali?', match: /244445/ },
      { id: 'Q056', q: 'Apa saja persyaratan akademik untuk mengajukan Tugas Akhir pada jenjang S1?', match: /141\s+SKS|Tugas\s+Akhir/i }
    ];

    cases.forEach(c => {
      test(`Regression invariance ${c.id}: ${c.q.slice(0, 40)}...`, async () => {
        const res = await processTurn('inv_' + c.id, c.q);
        expect(res.finalAnswer).toMatch(c.match);
        expect(res.subQueryResults?.[0]?.verification?.pass).toBe(true);
      }, 30000);
    });
  });

  describe('Task F: Q037 Logger Fallback & Q038 Study Permit Retrieval', () => {
    const { resolveSemanticFrameAsync } = require('../src/core/semanticFrameResolver');
    const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
    const { retrieveCandidates } = require('../src/core/retrievalService');
    const modelSemanticParser = require('../src/core/modelSemanticParser');

    test('Q037: resolveSemanticFrameAsync falls back gracefully without ReferenceError when model parser fails', async () => {
      const origParse = modelSemanticParser.parseSemanticInterpretation;
      try {
        modelSemanticParser.parseSemanticInterpretation = jest.fn().mockRejectedValue(new Error('Simulated model connection failure'));
        const frame = await resolveSemanticFrameAsync('Negara mana saja yang menjadi mitra pertukaran pelajar Student Exchange ITB STIKOM Bali?');
        expect(frame).toBeDefined();
        expect(frame.domain).toBe('INTERNATIONAL');
        expect(frame.intent).toBe('INTERNATIONAL_PROGRAM_INFO');
        expect(frame.traceMeta?.resolverEngine).toBe('deterministic_fallback_on_error');
        expect(frame.traceMeta?.error).toBe('Simulated model connection failure');
      } finally {
        modelSemanticParser.parseSemanticInterpretation = origParse;
      }
    });

    test('Q037: Student exchange gold chunks are retrieved in Top-12', async () => {
      const query = 'Negara mana saja yang menjadi mitra pertukaran pelajar Student Exchange ITB STIKOM Bali?';
      const frame = await resolveSemanticFrameAsync(query);
      const plan = buildRetrievalPlan(frame);
      const cands = await retrieveCandidates(plan, query, { topK: 12 });
      const top12Ids = cands.map(c => c.id || c.chunkId);
      const gold37 = ['8de9f1f9-aa24-4dc1-bd63-0db18dbdf8f0', 'a3117910-289f-469a-aaa4-26be22a9a600'];
      const hasGold = gold37.some(g => top12Ids.includes(g));
      expect(hasGold).toBe(true);
    });

    test('Q038: Study permit gold chunks are retrieved in Top-12 without crowding out', async () => {
      const query = 'Bagaimana prosedur dan FAQ pengurusan izin belajar bagi mahasiswa asing di STIKOM Bali?';
      const frame = await resolveSemanticFrameAsync(query);
      const plan = buildRetrievalPlan(frame);
      const cands = await retrieveCandidates(plan, query, { topK: 12 });
      const top12Ids = cands.map(c => c.id || c.chunkId);
      expect(top12Ids).toContain('406d404b-25ea-421f-bffc-ae40d561d169');
      expect(top12Ids).toContain('ce7c909b-2ef2-408a-b503-4fa31c1479e7');
      const rank406 = top12Ids.indexOf('406d404b-25ea-421f-bffc-ae40d561d169');
      expect(rank406).toBeLessThan(5);
    });
  });

  describe('Task G: Bounded Remediation Cases 7, 8, 9, 11 (Smoke Test Defects)', () => {
    const { processTurn } = require('../src/core/orchestrator');

    test('Case 7: Student exchange query answers institutional policy without forcing prodi clarification', async () => {
      const query = 'Gimana alur dan syarat ikut program pertukaran pelajar internasional buat mahasiswa STIKOM?';
      const res = await processTurn('test_case7_exchange', query);
      expect(res.status).not.toBe('clarification_needed');
      expect(res.finalAnswer).not.toMatch(/Pilih salah satu program studi|1\.\s+S1\s+Sistem\s+Informasi/i);
      expect(res.finalAnswer).toMatch(/Student\s+Exchange|Pertukaran\s+Mahasiswa|Pertukaran\s+Pelajar/i);
      expect(res.finalAnswer).toMatch(/Direktorat\s+Urusan\s+Internasional/i);
      expect(res.finalAnswer).toMatch(/Mahasiswa\s+aktif/i);
      // Ensure no unverified assumptions
      expect(res.finalAnswer).not.toMatch(/toefl\s+(?:minimal\s+)?(?:500|550)/i);
      expect(res.finalAnswer).not.toMatch(/izin\s+orang\s+tua\s+bermaterai/i);
    }, 30000);

    test('Case 8: Minimum thesis guidance count safely abstains without hallucinating numbers', async () => {
      const query = 'Berapa kali minimal mahasiswa harus bimbingan tugas akhir dengan dosen pembimbing sebelum bisa ujian?';
      const res = await processTurn('test_case8_bimbingan', query);
      expect(res.finalAnswer).toMatch(/belum\s+tercantum|belum\s+dapat\s+dipastikan|tidak\s+disebutkan/i);
      expect(res.finalAnswer).toMatch(/Dosen\s+Pembimbing/i);
      // Must not hallucinate arbitrary meeting numbers
      expect(res.finalAnswer).not.toMatch(/minimal\s+(?:8|10|12|14|16)\s+kali/i);
      // Must not mix up 50% payment with meeting count
      expect(res.finalAnswer).not.toMatch(/50%\s+(?:kali|pertemuan)/i);
    }, 30000);

    test('Case 9: IT lab facilities query answers with laboratory facilities, not degree catalog', async () => {
      const query = 'Fasilitas laboratorium apa saja yang disediakan kampus untuk menunjang praktikum mahasiswa IT?';
      const res = await processTurn('test_case9_lab', query);
      expect(res.semanticFrame.domain).toBe('FACILITIES');
      expect(res.finalAnswer).not.toMatch(/ITB STIKOM Bali menyelenggarakan program studi di berbagai jenjang/i);
      expect(res.finalAnswer).not.toMatch(/•\s+\*\*Program Sarjana \(S1\)\*\*:/i);
      expect(res.finalAnswer).toMatch(/Laboratorium|Lab/i);
    }, 30000);

    test('Case 11: Multi-turn S2 tuition followed by degree & duration inherits context without OOD', async () => {
      const sessionId = 'test_case11_multi_turn_' + Date.now();
      const turn1Query = 'Saya tertarik lanjut kuliah S2 Magister Sistem Informasi di STIKOM Bali, berapa biaya kuliahnya?';
      const turn1Res = await processTurn(sessionId, turn1Query);
      expect(turn1Res.finalAnswer).toMatch(/S2|Magister\s+Sistem\s+Informasi|Rp|biaya/i);

      const turn2Query = 'Gelar apa yang didapat setelah lulus dan berapa lama masa studinya?';
      const turn2Res = await processTurn(sessionId, turn2Query);
      expect(turn2Res.semanticFrame.domain).not.toBe('OUT_OF_DOMAIN');
      expect(turn2Res.status).not.toBe('out_of_domain');
      expect(turn2Res.finalAnswer).not.toMatch(/Pertanyaan Anda berada di luar cakupan layanan informasi kampus kami/i);
      expect(turn2Res.finalAnswer).toMatch(/M\.Kom|Magister\s+Komputer/i);
      expect(turn2Res.finalAnswer).toMatch(/4\s+semester/i);
    }, 35000);

    test('Case 11 Session Isolation: Independent turn without prior context does not leak S2', async () => {
      const isolatedSessionId = 'test_case11_isolated_' + Date.now();
      const query = 'Gelar apa yang didapat setelah lulus dan berapa lama masa studinya?';
      const res = await processTurn(isolatedSessionId, query);
      // In an isolated session with no prior active entity, should NOT claim S2 M.Kom
      expect(res.finalAnswer).not.toMatch(/Magister\s+Komputer\s+\(M\.Kom\.\)/);
    }, 25000);
  });
});
