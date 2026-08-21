const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');

const noDataRe = /belum menemukan|tidak menemukan|tidak tersedia|tidak mau mengarang|konfirmasi/i;

describe('system-wide semantic contracts', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  test('canonical program definition outranks generic RAG for recognized program aliases', async () => {
    const canonical = buildCanonicalQueryUnderstanding('informatika itu jurusan apa?');
    expect(canonical.intent.primary).toBe('ask_program_definition');
    expect(canonical.domain.primary).toBe('program');
    expect(canonical.entities.programs[0].canonical).toBe('Teknologi Informasi');

    const result = await querySemanticRag('informatika itu jurusan apa?');
    expect(result.source).toBe('semantic-rag-program-definition');
    expect(result.answer).toMatch(/Teknologi Informasi/i);
    expect(result.answer).not.toMatch(/INBIS|inkubator|Student Exchange/i);

    const existence = await querySemanticRag('jurusan informatika ada?');
    expect(existence.source).toBe('semantic-rag-program-definition');
    expect(existence.answer).toMatch(/Teknologi Informasi/i);
    expect(existence.answer).not.toMatch(/Tenant tersebar|INBIS|inkubator/i);
  });

  test('informal reordered program comparison is trusted when deterministic answer is structured', async () => {
    const result = await querySemanticRag('TI sama SI bedain dong');
    expect(result.source).toBe('semantic-rag-program-comparison');
    expect(result.answer).toMatch(/Sistem Informasi/i);
    expect(result.answer).toMatch(/Teknologi Informasi/i);
    expect(result.source).not.toMatch(/meaning-verifier-blocked|meaning-mismatch/i);
  });

  test('supported UTB DKV STIKOM relation pairing works without explicit double degree wording', async () => {
    const result = await querySemanticRag('kalau ambil dkv di utb sisi stikomnya apa?');
    expect(result.source).toBe('semantic-rag-dual-degree');
    expect(result.answer).toMatch(/Bisnis Digital/i);
    expect(result.answer).toMatch(/DKV|Desain Komunikasi Visual/i);
  });

  test('unsupported partner relation remains safe fallback', async () => {
    const result = await querySemanticRag('kalau desain di Stanford sisi stikom apa?');
    expect(result.answer).toMatch(noDataRe);
    expect(result.answer).not.toMatch(/Bisnis Digital.*Stanford|Stanford.*Bisnis Digital/i);
  }, 60000);

  test('institution profile requests outrank PMB, UKM, student exchange, and generic RAG', async () => {
    const result = await querySemanticRag('apa tujuan institusi stikom bali?');
    expect(result.source).toBe('semantic-rag-institution-profile');
    expect(result.answer).toMatch(noDataRe);
    expect(result.answer).not.toMatch(/Student Exchange|UKM|PMB adalah|pendaftaran/i);
  });

  test('explicit date dominates month overview unless month summary is explicit', async () => {
    const pointInTime = await querySemanticRag('per tanggal 7 juli 2026 gelombang apa?');
    expect(pointInTime.source).toBe('semantic-rag-schedule-window');
    expect(pointInTime.answer).toMatch(/Per 7 Juli 2026/i);
    expect(pointInTime.answer).toMatch(/Gelombang IV A/i);
    expect(pointInTime.answer).not.toMatch(/Untuk Juli 2026/i);

    const monthSummary = await querySemanticRag('bulan juli 2026 ada gelombang apa saja?');
    expect(monthSummary.source).toBe('semantic-rag-schedule-window');
    expect(monthSummary.answer).toMatch(/Untuk Juli 2026/i);
    expect(monthSummary.answer).toMatch(/Gelombang III C/i);
  });

  test('domain terms inside negative controls do not hijack specialized contracts', async () => {
    const ukmVision = await querySemanticRag('visi UKM JCOS apa?');
    expect(ukmVision.source).toMatch(/semantic-rag-ukm-specific/);
    expect(ukmVision.answer).toMatch(/visi|misi|JCOS/i);
    expect(ukmVision.source).not.toBe('semantic-rag-institution-profile');
    expect(ukmVision.source).not.toBe('semantic-rag-institution-vision-mission');
    expect(ukmVision.source).not.toBe('semantic-rag-ukm-list');

    const unknownUkmVision = await querySemanticRag('visi UKM robot terbang apa?');
    expect(unknownUkmVision.source).toBe('semantic-rag-ukm-unknown-insufficient-data');
    expect(unknownUkmVision.answer).toMatch(noDataRe);
    expect(unknownUkmVision.answer).not.toMatch(/32 UKM|Athena Esports/i);

    const exchangeBarter = await querySemanticRag('apa manfaat exchange barang bekas?');
    expect(exchangeBarter.source).not.toBe('semantic-rag-international-topic-composer');
    expect(exchangeBarter.answer).not.toMatch(/Student Exchange/i);
  }, 70000);
  test('organization list requestType outranks unknown UKM name extraction', async () => {
    const canonical = buildCanonicalQueryUnderstanding('UKM kampus ada apa saja?');
    expect(canonical.intent.primary).toBe('ask_organization_list');
    expect(canonical.domain.primary).toBe('student_organization');
    expect(canonical.questionType).toBe('list');

    const result = await querySemanticRag('UKM kampus ada apa saja?');
    expect(result.source).toBe('semantic-rag-ukm-list');
    expect(result.answer).toMatch(/32 UKM|Ormawa|Athena Esports/i);
    expect(result.answer).not.toMatch(/Kampus ADA/i);
  });
});