'use strict';

const { detectQueryLanguage } = require('../src/utils/languageDetector');
const { matchCanonicalEntities } = require('../src/engine/canonicalEntityRegistry');
const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { decomposeQuery } = require('../src/core/multiIntentResolver');
const { evaluateContextDependency, CONTEXT_DECISION } = require('../src/core/contextResolver');
const { buildGroundedDeterministicSummary } = require('../src/core/groundedAnswerGenerator');
const { processTurn } = require('../src/core/orchestrator');
const { INSTITUTIONAL_ACCREDITATION_RECORD } = require('../src/core/academicCatalog');

describe('WhatsApp Consolidated Regression Suite — 19 Oktober 2026', () => {

  describe('Regresi A: Pertanyaan Daftar Program Studi', () => {
    test('"Jurusan apa saja yang ada di stikom Bali?" does not generate fictitious entity "Apa saja yang"', () => {
      const q = 'Jurusan apa saja yang ada di stikom Bali?';
      const frame = resolveSemanticFrame(q);

      expect(frame.unconfirmedProgram).toBeNull();
      expect(frame.entities.some(e => /apa\s*saja/i.test(e.canonical || e.name || ''))).toBe(false);
      expect(frame.intent === 'AVAILABLE_PROGRAMS_LIST' || frame.intent === 'ACADEMIC_CATALOG_INQUIRY').toBe(true);
    });

    test('"Program studi apa saja yang tersedia di STIKOM?" resolves without unconfirmed program error', () => {
      const q = 'Program studi apa saja yang tersedia di STIKOM?';
      const frame = resolveSemanticFrame(q);

      expect(frame.unconfirmedProgram).toBeNull();
    });
  });

  describe('Regresi B: Program Double Degree dan Bahasa Jawaban', () => {
    test('"Apakah ada program double degree international?" is detected as Indonesian', () => {
      const q = 'Apakah ada program double degree international?';
      const lang = detectQueryLanguage(q);

      expect(lang).toBe('id');
    });

    test('"What are the available international double degree programs?" is detected as English', () => {
      const q = 'What are the available international double degree programs?';
      const lang = detectQueryLanguage(q);

      expect(lang).toBe('en');
    });
  });

  describe('Regresi C: Akreditasi Institusi vs Program Studi (No SK collision)', () => {
    test('"Apakah ITB STIKOM Bali sudah terakreditasi? Sebutkan peringkat, nomor SK, dan masa berlakunya" does not match S1 Sistem Komputer', () => {
      const q = 'Apakah ITB STIKOM Bali sudah terakreditasi? Sebutkan peringkat, nomor SK, dan masa berlakunya';
      const matched = matchCanonicalEntities(q);

      const matchedSKProdi = matched.some(m => m.canonical === 'S1 Sistem Komputer');
      expect(matchedSKProdi).toBe(false);

      const frame = resolveSemanticFrame(q);
      expect(frame.entities.some(e => e.canonical === 'S1 Sistem Komputer')).toBe(false);
      expect(frame.intent).toBe('INSTITUTIONAL_ACCREDITATION');
    });

    test('Comparative Case: "Bagaimana akreditasi S1 Sistem informasi?" correctly targets S1 Sistem Informasi', () => {
      const q = 'Bagaimana akreditasi S1 Sistem informasi?';
      const matched = matchCanonicalEntities(q);

      expect(matched.some(m => m.canonical === 'S1 Sistem Informasi')).toBe(true);
      const frame = resolveSemanticFrame(q);
      expect(frame.intent).toBe('PROGRAM_ACCREDITATION');
    });
  });

  describe('Regresi D: Perwalian Terlambat dan Isolasi Konteks PMB (Multi-Turn)', () => {
    test('Multi-intent decomposition does not leak PMB into perwalian query', () => {
      const q = 'Saya terlambat melakukan perwalian. Apa dampaknya dan bagaimana prosedur yang harus saya lakukan?';
      const sessionData = {
        activeDomain: 'PMB',
        activeIntent: 'ADMISSION_INFO',
        activeEntity: 'PMB'
      };

      const contextDecision = evaluateContextDependency(q, sessionData);
      expect(contextDecision.shouldInherit).toBe(false);
      expect(contextDecision.decision).toBe(CONTEXT_DECISION.TOPIC_SHIFT);

      const subFrames = decomposeQuery(q, sessionData);
      expect(subFrames.length).toBeGreaterThan(0);
      for (const sf of subFrames) {
        expect(sf.domain).not.toBe('PMB');
        expect(sf.intent).not.toBe('ADMISSION_PROCEDURE');
      }
    });

    test('End-to-end multi-turn processTurn: Turn 1 PMB -> Turn 2 Perwalian produces clean academic advising answer with zero PMB contamination', async () => {
      const sessionId = 'test_multi_turn_perwalian_' + Date.now();

      // Turn 1: PMB
      const turn1 = await processTurn(sessionId, 'Bagaimana alur pendaftaran PMB di ITB STIKOM Bali?');
      expect(turn1).toBeDefined();
      expect(turn1.finalAnswer).toBeDefined();

      // Turn 2: Late perwalian inquiry immediately following PMB turn
      const turn2 = await processTurn(sessionId, 'Saya terlambat melakukan perwalian. Apa dampaknya dan bagaimana prosedur yang harus saya lakukan?');
      expect(turn2).toBeDefined();
      expect(turn2.finalAnswer).toBeDefined();

      const ans2 = turn2.finalAnswer.toLowerCase();
      // Must address perwalian / academic consultation
      expect(ans2).toMatch(/perwalian|dosen\s+wali|krs|akademik/i);
      // Must NOT contain admission/PMB contamination
      expect(ans2).not.toMatch(/alur\s+pendaftaran\s+pmb|gelombang\s+(?:i|ii|iii|iv|khusus)|biaya\s+formulir|biaya\s+pendidikan\s+per\s+semester/i);
      expect(ans2).not.toMatch(/pmb\.stikom-bali\.ac\.id/i);
    }, 65000);
  });

  describe('Regresi E: Naming UKM BOS dan Pemisahan UKM vs Ormawa', () => {
    test('Sports recommendation uses canonical UKM BOS (not BOSS)', () => {
      const frame = {
        domain: 'ORGANIZATION_UKM',
        aspects: ['sports'],
        rawQuery: 'Kalau saya suka olahraga cocok nya masuk ukm apa?',
        language: 'id',
        entities: []
      };

      const accepted = [
        {
          id: 'ukm-sport-1',
          text: 'UKM Olahraga di ITB STIKOM Bali mencakup UKM BOS (Badminton Organization of STIKOM) untuk bulutangkis, Futsal, Basket, dan GHoST.',
          providedAspects: ['sports', 'student_organization'],
          provenance: { source: 'SK PEMBINA ORMAWA 2026.pdf' }
        }
      ];

      const ans = buildGroundedDeterministicSummary(frame, accepted, { userLang: 'id' });
      expect(ans).toContain('UKM BOS');
      expect(ans).not.toContain('UKM BOSS');
    });

    test('UKM list query separates UKMs from Senat Mahasiswa, Balma, and Himaprodi, and avoids claiming exhaustive completeness', () => {
      const frame = {
        domain: 'ORGANIZATION_UKM',
        aspects: ['student_organization'],
        rawQuery: 'UKM apa saja yang ada di ITB STIKOM Bali?',
        language: 'id',
        entities: []
      };

      const accepted = [
        {
          id: 'ukm-summary-1',
          text: 'Unit Kegiatan Mahasiswa di ITB STIKOM Bali: Athena E-Sports, BOS, GHoST, PRAGINA, MUSIK, VOS, Himatography, KSR PMI.',
          providedAspects: ['student_organization'],
          provenance: { source: 'SK PEMBINA ORMAWA 2026.pdf' }
        }
      ];

      const ans = buildGroundedDeterministicSummary(frame, accepted, { userLang: 'id' });
      // Must state UKM categories
      expect(ans).toMatch(/UKM Athena E-Sports/i);
      expect(ans).toMatch(/UKM BOS/i);
      expect(ans).toMatch(/UKM Voice of STIKOM Bali/i);
      // Must separate UKM from governance bodies (Senat, Balma, Himaprodi)
      expect(ans).toMatch(/terpisah dari organisasi perwakilan\/eksekutif mahasiswa seperti Senat Mahasiswa, Balma, atau Himpunan Mahasiswa Program Studi/i);
      // Must include non-exhaustive disclaimer
      expect(ans).toMatch(/bukan merupakan klaim daftar lengkap/i);
    });
  });

  describe('Regresi G: Program LinkedIn Grounding (V2 Execution Path)', () => {
    test('Active V2 generator handles LinkedIn query without unverified Rp 200.000 fee or private phone number', () => {
      const frame = {
        domain: 'CAREER_CENTER',
        aspects: ['campus_service'],
        rawQuery: 'Apakah ada informasi terkait Program LinkedIn?',
        language: 'id',
        entities: [{ canonical: 'Program LinkedIn Learning (CDC)', type: 'special_program' }]
      };

      const accepted = [
        {
          id: 'cdc-linkedin-1',
          text: 'Career Development Center memfasilitasi program pelatihan karier dan pelatihan digital melalui LinkedIn Learning.',
          providedAspects: ['campus_service'],
          provenance: { source: 'docs/retrieval/knowledge_domains/career_center.md' }
        }
      ];

      const ans = buildGroundedDeterministicSummary(frame, accepted, { userLang: 'id' });
      expect(ans).toContain('LinkedIn Learning');
      expect(ans).toContain('Career Development Center');
      // Must NOT hallucinate unverified fee or private phone number
      expect(ans).not.toContain('200.000');
      expect(ans).not.toContain('081-399-5000');
      // Must refer to official CDC portal
      expect(ans).toContain('cdc.stikom-bali.ac.id');
    });

    test('Legacy helper buildLinkedInProgramEvidenceAnswer is also sanitized', () => {
      const { buildLinkedInProgramEvidenceAnswer } = require('../src/engine/semanticRagEngine');
      const ans = buildLinkedInProgramEvidenceAnswer();
      expect(ans).not.toContain('200.000');
      expect(ans).not.toContain('081-399-5000');
      expect(ans).toContain('LinkedIn Learning');
    });
  });

  describe('Regresi H: Fasilitas Fisik vs Layanan dan Program Akademik', () => {
    test('Campus facilities response cleanly distinguishes physical learning facilities from support services and academic programs', () => {
      const frame = {
        domain: 'FACILITIES',
        aspects: ['facilities'],
        rawQuery: 'Fasilitas apa saja yang ada di kampus ITB STIKOM Bali?',
        language: 'id',
        entities: []
      };

      const accepted = [
        {
          id: 'fac-1',
          text: 'Fasilitas kampus ITB STIKOM Bali mencakup laboratorium komputer modern, ruang kelas AC, perpustakaan, CDC, dan Inkubator Bisnis.',
          providedAspects: ['facilities'],
          provenance: { source: 'docs/retrieval/knowledge_domains/fasilitas.md' }
        }
      ];

      const ans = buildGroundedDeterministicSummary(frame, accepted, { userLang: 'id' });
      // Must separate physical facilities from services
      expect(ans).toMatch(/Fasilitas Fisik & Pembelajaran/i);
      expect(ans).toMatch(/Laboratorium Komputer & Teknologi/i);
      expect(ans).toMatch(/Perpustakaan & E-Library/i);
      expect(ans).toMatch(/Unit Layanan Pendukung Kampus/i);
      expect(ans).toMatch(/Career Development Center/i);
      expect(ans).toMatch(/Inkubator Bisnis/i);
      expect(ans).toMatch(/Language Learning Center/i);
      // Explicit disclaimer that programs/UKM are not physical facilities
      expect(ans).toMatch(/bukan fasilitas fisik kampus/i);
    });
  });

  describe('Regresi I: Program Internasional — Pemisahan Kategori', () => {
    test('General international programs inquiry clearly categorizes Double Degree, Student Exchange, and Career Prep (Hi-Think)', () => {
      const frame = {
        domain: 'INTERNATIONAL',
        aspects: ['international'],
        rawQuery: 'Program internasional apa saja yang ada di ITB STIKOM Bali?',
        language: 'id',
        entities: []
      };

      const accepted = [
        {
          id: 'intl-1',
          text: 'Program internasional mencakup Double Degree HELP University dan DNUI, Student Exchange GCCP, serta program magang Jepang Hi-Think.',
          providedAspects: ['international'],
          provenance: { source: 'docs/retrieval/knowledge_domains/international.md' }
        }
      ];

      const ans = buildGroundedDeterministicSummary(frame, accepted, { userLang: 'id' });
      // Distinct categories
      expect(ans).toMatch(/Program Gelar Ganda \(Double Degree\)/i);
      expect(ans).toMatch(/HELP University/i);
      expect(ans).toMatch(/Dalian Neusoft University of Information/i);
      expect(ans).toMatch(/Program Pertukaran Mahasiswa \(Student Exchange & Global Experience\)/i);
      expect(ans).toMatch(/Exchange Reguler/i);
      expect(ans).toMatch(/Global Cross Cultural Program \(GCCP\)/i);
      expect(ans).toMatch(/Program Persiapan Kerja & Magang Internasional/i);
      expect(ans).toMatch(/Hi-Think/i);
      // Does not fabricate active schedule/quota
      expect(ans).toMatch(/dikoordinasikan langsung oleh Direktorat Pemasaran dan Urusan Internasional/i);
    });
  });

  describe('Regresi J: Follow-up "Apa itu LLC?" Grounding', () => {
    test('Returns grounded explanation that LLC is Language Learning Center without asserting unverified course specifics', () => {
      const frame = {
        domain: 'FACILITIES',
        aspects: ['facilities'],
        rawQuery: 'Apa itu LLC?',
        language: 'id',
        entities: [{ canonical: 'Language Learning Center (LLC)', type: 'facility' }]
      };

      const accepted = [
        {
          id: 'facility-1',
          text: 'Fasilitas di STIKOM Bali ada banyak: Career Center, Inkubator Bisnis, Language Learning Center, Laboratorium.',
          providedAspects: ['facilities'],
          provenance: { source: 'docs/retrieval/knowledge_domains/fasilitas.md' }
        }
      ];

      const ans = buildGroundedDeterministicSummary(frame, accepted, { userLang: 'id' });
      expect(ans).toContain('Language Learning Center');
      expect(ans).toContain('LLC');
      expect(ans).toMatch(/registri unit layanan pendukung kampus/i);
      expect(ans).toMatch(/belum tercantum dalam panduan resmi yang tersedia/i);
    });
  });

  describe('Regresi K: Robustness Entitas Program Studi & Penanganan Program Tidak Tersedia', () => {
    test('Non-program phrases are never falsely classified as study program entities or unconfirmed/unsupported programs', () => {
      const phrases = [
        'Jurusan teknik atau komputer di kampus ini apa saja?',
        'Kalau program yang tadi, ada biaya tambahan dan potongan apa?',
        'Syarat konversi mata kuliah pengalaman kerja ke SKS di STIKOM gimana?',
        'Prodi S2 yang dibuka di pascasarjana apa saja?',
        'Daftar UKM bidang seni dan musik apa saja yang aktif?',
        'Bandingkan biaya per semester dari semua program studi di STIKOM Bali.'
      ];

      for (const q of phrases) {
        const frame = resolveSemanticFrame(q);
        expect(frame.unconfirmedProgram).toBeNull();
        expect(frame.unsupportedProgramName).toBeNull();
        expect(frame.unsupportedEntity).toBe(false);
      }
    });

    test('Vocational queries and spelling variation "voksi" resolve cleanly to D3 Manajemen Informatika without fictitious entity', () => {
      const queries = [
        'apakah ada pendidikan vokasi?',
        'ad g prodi voksi di stikom?'
      ];

      for (const q of queries) {
        const frame = resolveSemanticFrame(q);
        expect(frame.unconfirmedProgram).toBeNull();
        expect(frame.unsupportedProgramName).toBeNull();
        expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
        expect(frame.scopeLevel).toBe('D3');
      }
    });

    test('Positive tests: Truly unavailable programs outside statutory faculties are properly identified as unsupported', () => {
      const unavailQueries = [
        { q: 'Apakah ada jurusan kedokteran di STIKOM Bali?', expectedName: 'Kedokteran' },
        { q: 'Berapa biaya kuliah jurusan teknik nuklir?', expectedName: 'Teknik nuklir' },
        { q: 'Apakah membuka prodi farmasi?', expectedName: 'Farmasi' }
      ];

      for (const item of unavailQueries) {
        const frame = resolveSemanticFrame(item.q);
        expect(frame.isUnsupportedEntity).toBe(true);
        expect(frame.unsupportedProgramName.toLowerCase()).toBe(item.expectedName.toLowerCase());
        expect(frame.desiredAction).toBe('REFUSE_UNSUPPORTED_PROGRAM');
      }
    });
  });

  describe('Regresi L: Kerja Sama Gelar Ganda Nasional dengan UTB (Evidence-Grounded)', () => {
    test('National double degree queries correctly target UTB and national partnership without confusing international partners', () => {
      const q = 'Kerja sama gelar ganda nasional ITB STIKOM Bali dengan universitas mana?';
      const frame = resolveSemanticFrame(q);

      expect(frame.entities.some(e => e.canonical === 'Dual Degree UTB')).toBe(true);
      expect(frame.aspects).toContain('national_program');
      expect(frame.aspects).toContain('double_degree');
    });

    test('End-to-end national double degree turn produces grounded UTB response backed by evidence', async () => {
      const q = 'Kerja sama gelar ganda nasional ITB STIKOM Bali dengan universitas mana?';
      const res = await processTurn('test_sess_regresi_l_utb_' + Date.now(), q);

      expect(res).toBeDefined();
      expect(res.finalAnswer).toBeDefined();
      const ans = res.finalAnswer;
      // Must state partner as Universitas Teknologi Bandung (UTB)
      expect(ans).toMatch(/Universitas\s+Teknologi\s+Bandung|\bUTB\b/i);
      // Must not confuse with Bali or international partners
      expect(ans).not.toMatch(/Universitas\s+Teknologi\s+Bali/i);
    }, 45000);
  });

  describe('Regresi M: Grounding Prosedur RPL Sesuai Bukti Resmi', () => {
    test('End-to-end RPL inquiry grounds in verified SKS tiers and does not assert unevidenced competency/portfolio requirements', async () => {
      const q = 'Syarat konversi mata kuliah pengalaman kerja ke SKS di STIKOM gimana?';
      const res = await processTurn('test_sess_regresi_m_rpl_' + Date.now(), q);

      expect(res).toBeDefined();
      expect(res.finalAnswer).toBeDefined();
      const ans = res.finalAnswer;

      // Must state officially verified credit/fee tiers
      expect(ans).toMatch(/85\s*s\/?d\s*100\s*SKS|44\s*s\/?d\s*84\s*SKS|20\s*s\/?d\s*43\s*SKS|Rp\s*4\.500\.000/i);
      // Must refer to official PMB portal
      expect(ans).toMatch(/pmb\.stikom-bali\.ac\.id/i);
      // Must NOT claim unevidenced mandatory technical portfolio or competency certificates as absolute prerequisites
      expect(ans).not.toMatch(/wajib\s+mengunggah\s+sertifikat\s+kompetensi/i);
      // Must honestly advise confirming technical work conversion with admissions
      expect(ans).toMatch(/admisi|konfirmasi|belum\s+tercantum/i);
    }, 45000);
  });

});
