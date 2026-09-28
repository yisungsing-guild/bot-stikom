const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
const { sanitizeOutboundWhatsappText, normalizeWhatsappReply } = require('../src/utils/whatsappFormatter');
const { normalizeUserQuery } = require('../src/utils/queryNormalizer');

describe('UAT 30 Defect Remediation & Domain Coverage Test Suite', () => {
  beforeAll(() => {
    process.env.VECTOR_RETRIEVAL_ENABLED = 'false';
  });

  describe('P0-1: Campus Context Carryover Prevention', () => {
    test('Campus comparison query after Double Degree query does NOT inherit Double Degree frame', async () => {
      // Turn 1: Double degree query establishes a DD frame
      const turn1Result = await querySemanticRag('ada program double degree apa saja?');
      expect(turn1Result.success).toBe(true);

      const sessionData = {
        effectiveSemanticFrame: turn1Result.effectiveSemanticFrame || {
          frameSource: 'semantic-rag-dual-degree',
          entities: [{ canonical: 'Double Degree HELP University', family: 'program' }]
        },
        sessionChatId: 'test-session-p0-1',
        history: [{ role: 'user', content: 'ada program double degree apa saja?' }]
      };

      // Turn 2: Query about campus facilities with typo "kamups"
      const turn2Query = 'Mana lebih lengkap kamups renon, jimbaran, atau abiansemal?';
      const turn2Result = await querySemanticRag(turn2Query, { sessionData });

      expect(turn2Result.success).toBe(true);
      const answer = turn2Result.answer.toLowerCase();
      // Must NOT contain double degree response
      expect(answer).not.toContain('help university');
      expect(answer).not.toContain('dalian neusoft');
      expect(turn2Result.frameSource).not.toBe('semantic-rag-dual-degree');
      // Must address campuses
      expect(answer).toMatch(/(?:renon|denpasar|jimbaran|abiansemal)/i);
    });
  });

  describe('P0-2: TA Requirements Semantic Resolution', () => {
    test('Query "Untuk menulis TA apa saja persyaratannya?" routes to Academic Policy instead of PMB', async () => {
      const q = 'Untuk menulis TA apa saja persyaratannya?';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer.toLowerCase();
      // Must NOT direct to PMB registration portal
      expect(answer).not.toContain('siap.stikom-bali.ac.id');
      expect(answer).not.toContain('pendaftaran mahasiswa baru');
      // Must contain official thesis requirements
      expect(answer).toMatch(/(?:110\s*sks|ipk\s*2\.50|krs|tugas\s+akhir|aktif)/i);
    });

    test('Query understanding classifies "persyaratannya TA" under academic domain', () => {
      const q = 'Untuk menulis TA apa saja persyaratannya?';
      const parsed = buildCanonicalQueryUnderstanding(q);
      expect(parsed.domain.primary).toBe('academic');
      expect(parsed.intent.primary).toMatch(/ask_academic_(?:policy|info)/);
    });
  });

  describe('P1-3: Campus List Rendering', () => {
    test('Query "ITB STIKOM Bali punya berapa kampus?" lists all 3 campuses without truncation', async () => {
      const q = 'ITB STIKOM Bali punya berapa kampus?';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer;
      expect(answer).toMatch(/3\s+lokasi\s+kampus/i);
      expect(answer).toMatch(/Kampus Denpasar\/Renon \(Utama\)/i);
      expect(answer).toMatch(/Kampus Jimbaran/i);
      expect(answer).toMatch(/Kampus Abiansemal/i);
    });

    test('Typo "kamups" is normalized to "kampus"', () => {
      const normalized = normalizeUserQuery('kamups renon');
      expect(normalized.normalizedText).toContain('kampus renon');
    });
  });

  describe('P1-4: Broad UKM Retrieval', () => {
    test('Query "UKM apa saja di STIKOM Bali?" returns broad/categorized list, not a single entity', async () => {
      const q = 'UKM apa saja di STIKOM Bali?';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer;
      // Should not collapse into Athena Esports
      expect(answer).not.toMatch(/^Ada, di ITB STIKOM Bali terdapat Athena Esports/i);
      // Should list multiple UKMs or total count
      expect(answer).toMatch(/(?:daftar Unit Kegiatan Mahasiswa|Ada \d+ UKM|UKM\/Ormawa)/i);
      expect(answer).toMatch(/(?:Futsal|Basket|Musik|Tari|Ksl)/i);
    });

    test('Query "Untuk unit kegiatan mahasiswa, ada apa saja di STIKOM Bali?" does not trigger false descriptive interest', async () => {
      const q = 'Untuk unit kegiatan mahasiswa, ada apa saja di STIKOM Bali?';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer;
      expect(answer).not.toMatch(/^Ada, di ITB STIKOM Bali terdapat Athena Esports/i);
      expect(answer).toMatch(/(?:daftar Unit Kegiatan Mahasiswa|Ada \d+ UKM|UKM\/Ormawa)/i);
    });
  });

  describe('P1-5: BCCP Retrieval', () => {
    test('Query "Bali Cross Culture Program" returns grounded response mentioning GCCP and International Directorate', async () => {
      const q = 'Bali Cross Culture Program';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer;
      expect(answer).toMatch(/(?:gccp|global\s+cross\s+cultural\s+program)/i);
      expect(answer).toMatch(/(?:bccp|bali\s+cross\s+cultural\s+program)/i);
      expect(answer).toMatch(/(?:internasional|direktorat)/i);
    });

    test('Query "Bali Cross Cultural Program (BCCP)" does not fallback to general small-talk', async () => {
      const q = 'Bali Cross Cultural Program (BCCP)';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      expect(result.source).toMatch(/semantic-rag-international-topic-composer|semantic-rag-campus-(?:support|facility)/);
    });
  });

  describe('P1-6: Yudisium General Retrieval and Disambiguated Schedule Slots', () => {
    test('Query "Bisa saya dapat informasi tentang yudisium ya" returns yudisium info instead of no-data policy block', async () => {
      const q = 'Bisa saya dapat informasi tentang yudisium ya';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer.toLowerCase();
      // Must not be the policy no-data fallback
      expect(answer).not.toContain('saya belum menemukan ketentuan resmi untuk hal tersebut');
      expect(answer).toMatch(/(?:yudisium|jadwal|baak|pendaftaran)/i);
    });

    test('Query "kapan yudisium?" resolves to event execution (14 Oktober 2026, 14.00 WITA, Aula)', async () => {
      const q = 'kapan yudisium?';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer;
      expect(answer).toMatch(/14\s+Oktober\s+2026/i);
      expect(answer).toMatch(/14\.00\s+WITA/i);
      expect(answer).toMatch(/Aula\s+STIKOMBALI/i);
    });

    test('Query "batas pendaftaran yudisium?" resolves to registration deadline (2 Oktober 2026, 20.00 WITA, Loket)', async () => {
      const q = 'batas pendaftaran yudisium?';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer;
      expect(answer).toMatch(/2\s+Oktober\s+2026/i);
      expect(answer).toMatch(/20\.00\s+WITA/i);
      expect(answer).toMatch(/Loket\s+Akademik/i);
    });

    test('Query "kapan terakhir pendaftaran sidang tugas akhir?" resolves to sidang deadline (19 September 2026, 20.00 WITA)', async () => {
      const q = 'kapan terakhir pendaftaran sidang tugas akhir?';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer;
      expect(answer).toMatch(/19\s+September\s+2026/i);
      expect(answer).toMatch(/20\.00\s+WITA/i);
      expect(answer).toMatch(/Loket\s+Akademik/i);
    }, 15000);
  });

  describe('P1-7: Slot/Date Retrieval for UAS/UTS', () => {
    test('Query "kapan uas semester genap?" does not return lecture start dates as UAS date', async () => {
      const q = 'kapan uas semester genap?';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer.toLowerCase();
      // Must not claim UAS is on March 2nd (lecture start date)
      expect(answer).not.toMatch(/uas.*02\s*-\s*08\s*maret\s*2026/i);
      expect(answer).toMatch(/(?:sion|baak|diumumkan|jadwal)/i);
    });

    test('Query "kapan uts semester genap?" provides safe academic guidance', async () => {
      const q = 'kapan uts semester genap?';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer.toLowerCase();
      expect(answer).toMatch(/(?:uts|sion|baak|diumumkan|jadwal)/i);
    });
  });

  describe('P1-8: UKM Taxonomy Exclusion', () => {
    test('Query "UKM bidang seni ada apa saja?" excludes Futsal, Basket, Syntax, and Ghost', async () => {
      const q = 'UKM bidang seni ada apa saja?';
      const result = await querySemanticRag(q);

      expect(result.success).toBe(true);
      const answer = result.answer;
      // Must include Arts UKMs
      expect(answer).toMatch(/(?:Musik|Tari|Tabuh|Teater|VOS|D\.?O\.?S)/i);
      // Must NOT include non-arts UKMs
      expect(answer).not.toMatch(/\bFutsal\b/i);
      expect(answer).not.toMatch(/\bBasket\b/i);
      expect(answer).not.toMatch(/\bSyntax\b/i);
      expect(answer).not.toMatch(/\bGhost\b/i);
    });
  });

  describe('P1-9: Outbound WhatsApp Sanitizer', () => {
    test('Strips debug telemetry persistence markers', () => {
      const input = '[DEBUG_TELEMETRY_PERSISTENCE_ROUTING] Jawaban resmi kampus ITB STIKOM Bali.';
      const output = sanitizeOutboundWhatsappText(input);
      expect(output).not.toContain('DEBUG_TELEMETRY');
      expect(output).toBe('Jawaban resmi kampus ITB STIKOM Bali.');
    });

    test('Strips leaked JSON metadata fields', () => {
      const input = 'Halo kak! { chatId: "62812345678@c.us", mappedIncomingIntent: "general", incomingConfidence: 0.95 }\nAda yang bisa dibantu?';
      const output = sanitizeOutboundWhatsappText(input);
      expect(output).not.toContain('chatId');
      expect(output).not.toContain('mappedIncomingIntent');
      expect(output).not.toContain('incomingConfidence');
      expect(output).toContain('Halo kak!');
      expect(output).toContain('Ada yang bisa dibantu?');
    });

    test('Strips string concatenation artifacts', () => {
      const input = "ITB STIKOM Bali memiliki 3 kampus:" + "\n' + '- Renon" + "\n' + '- Jimbaran";
      const output = sanitizeOutboundWhatsappText(input);
      expect(output).not.toContain("'\n' + '");
      expect(output).not.toContain("'+ '");
      expect(output).toContain('Renon');
      expect(output).toContain('Jimbaran');
    });

    test('Strips stray trailing/leading curly braces', () => {
      const input = '{ Jawaban resmi kampus ITB STIKOM Bali. }';
      const output = sanitizeOutboundWhatsappText(input);
      expect(output).toBe('Jawaban resmi kampus ITB STIKOM Bali.');
    });

    test('normalizeWhatsappReply integrates sanitizer', () => {
      const raw = '  [DEBUG_TELEMETRY_PERSISTENCE] Halo kak,\n\n{ chatId: "123" }\n- Renon\n- Jimbaran  ';
      const normalized = normalizeWhatsappReply(raw);
      expect(normalized).not.toContain('DEBUG_TELEMETRY');
      expect(normalized).not.toContain('chatId');
      expect(normalized).toContain('Halo kak');
      expect(normalized).toContain('- Renon');
    });
  });

  describe('P2-10: Domain Coverage (Prodi, Degrees, Fees, CDC, Inbis)', () => {
    test('Coverage: SK (Sistem Komputer) prodi inquiry', async () => {
      const result = await querySemanticRag('Apa itu Program Studi Sistem Komputer?');
      expect(result.success).toBe(true);
      expect(result.answer.toLowerCase()).toMatch(/(?:sistem\s+komputer|hardware|perangkat\s+keras|iot|s\.kom)/i);
    });

    test('Coverage: MI (Manajemen Informatika D3) prodi inquiry', async () => {
      const result = await querySemanticRag('Apa itu Program Studi Manajemen Informatika D3?');
      expect(result.success).toBe(true);
      expect(result.answer.toLowerCase()).toMatch(/(?:manajemen\s+informatika|d3|diploma|ahli\s+madya|a\.md)/i);
    });

    test('Coverage: Double Degree HELP University & DNUI inquiry', async () => {
      const result = await querySemanticRag('Jelaskan program double degree di STIKOM Bali');
      expect(result.success).toBe(true);
      const answer = result.answer.toLowerCase();
      expect(answer).toMatch(/(?:help\s+university|dnui|dalian)/i);
      expect(answer).toMatch(/(?:dua\s+gelar|gelar\s+ganda|bachelor|skema\s+akademik|pasangan\s+prodi)/i);
    });

    test('Coverage: Career Center / CDC inquiry', async () => {
      const result = await querySemanticRag('Apa fungsi Career Center di STIKOM Bali?');
      expect(result.success).toBe(true);
      expect(result.answer.toLowerCase()).toMatch(/(?:karier|karir|lowongan|magang|cdc|alumni)/i);
    });

    test('Coverage: Inkubator Bisnis (INBIS) inquiry', async () => {
      const result = await querySemanticRag('Apa itu Inkubator Bisnis di STIKOM Bali?');
      expect(result.success).toBe(true);
      expect(result.answer.toLowerCase()).toMatch(/(?:inkubator\s+bisnis|inbis|startup|wirausaha|tenant)/i);
    });

    test('Coverage: Wisuda inquiry', async () => {
      const result = await querySemanticRag('kapan wisuda stikom bali?');
      expect(result.success).toBe(true);
      expect(result.answer.toLowerCase()).toMatch(/(?:wisuda|jadwal|pelaksanaan|baak)/i);
    });
  });

  describe('P2-11: Academic Schedule Authority Isolation (Yudisium)', () => {
    test('Query "kapan yudisium?" requires presence of date, time, place and zero contamination', async () => {
      const result = await querySemanticRag('kapan yudisium?');
      expect(result.success).toBe(true);
      const answer = result.answer;

      // Positive Presence Assertions
      expect(answer).toContain('14 Oktober 2026');
      expect(answer).toContain('14.00 WITA');
      expect(answer).toContain('Aula STIKOMBALI');

      // Negative Absence Assertions (Contamination Isolation)
      expect(answer).not.toContain('20 Mei 2001');
      expect(answer).not.toContain('Yayasan Widya Dharma Shanti');
      expect(answer).not.toContain('Teuku Umar');
      expect(answer).not.toContain('PRAGINA');
      expect(answer).not.toContain('Jadwal/gelombang');
    }, 15000);

    test('Query "kapan batas pendaftaran yudisium?" requires presence of date, time, place and zero contamination', async () => {
      const result = await querySemanticRag('kapan batas pendaftaran yudisium?');
      expect(result.success).toBe(true);
      const answer = result.answer;

      // Positive Presence Assertions
      expect(answer).toContain('2 Oktober 2026');
      expect(answer).toContain('20.00 WITA');
      expect(answer).toContain('Loket Akademik');

      // Negative Absence Assertions (Contamination Isolation)
      expect(answer).not.toContain('20 Mei 2001');
      expect(answer).not.toContain('Yayasan Widya Dharma Shanti');
      expect(answer).not.toContain('Teuku Umar');
      expect(answer).not.toContain('PRAGINA');
      expect(answer).not.toContain('Jadwal/gelombang');
    }, 15000);

    test('Query "jadwal yudisium" requires presence of both slots and dates with zero contamination', async () => {
      const result = await querySemanticRag('jadwal yudisium');
      expect(result.success).toBe(true);
      const answer = result.answer;

      // Positive Presence Assertions
      expect(answer).toContain('14 Oktober 2026');
      expect(answer).toContain('14.00 WITA');
      expect(answer).toContain('Aula STIKOMBALI');
      expect(answer).toContain('2 Oktober 2026');
      expect(answer).toContain('20.00 WITA');
      expect(answer).toContain('Loket Akademik');

      // Negative Absence Assertions (Contamination Isolation)
      expect(answer).not.toContain('20 Mei 2001');
      expect(answer).not.toContain('Yayasan Widya Dharma Shanti');
      expect(answer).not.toContain('Teuku Umar');
      expect(answer).not.toContain('PRAGINA');
      expect(answer).not.toContain('Jadwal/gelombang');
    }, 15000);
  });
});
