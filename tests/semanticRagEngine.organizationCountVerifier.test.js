const {
  querySemanticRag,
  verifyOutboundSemanticRelevance
} = require('../src/engine/semanticRagEngine');

process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
delete process.env.OPENAI_API_KEY;

describe('organization count verifier contract', () => {
  async function ask(query) {
    return querySemanticRag(query, { topK: 8 });
  }

  function expectGroundedOrgCount(result) {
    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-ukm-count');
    expect(result.answer).toMatch(/\b\d+\b/);
    expect(result.answer).toMatch(/UKM|ORMAWA|Ormawa|organisasi mahasiswa/i);
    expect(result.answer).not.toMatch(/Hi-?Think|Student Exchange|Double Degree|DNUI|HELP University|UKT|DPP|Gelombang/i);
  }

  test('accepts grounded ORMAWA count through semantic and outbound verifier', async () => {
    const result = await ask('Jumlah ormawa di ITB STIKOM Bali ada berapa?');
    expectGroundedOrgCount(result);

    const outbound = await verifyOutboundSemanticRelevance(
      'Jumlah ormawa di ITB STIKOM Bali ada berapa?',
      result.answer,
      result.source
    );
    expect(outbound.ok).toBe(true);
    expect(outbound.reason).toBe('trusted_semantic_rag_local_verified');
  }, 30000);

  test('generalizes count wording for UKM and organization family', async () => {
    const variants = [
      'total organisasi mahasiswa berapa?',
      'jumlah UKM di STIKOM ada berapa?',
      'ada berapa unit kegiatan mahasiswa di kampus?'
    ];
    for (const query of variants) expectGroundedOrgCount(await ask(query));
  }, 30000);

  test('preserves subset count scope for HIMAPRODI and HIMA wording', async () => {
    const himaprodi = await ask('total himpunan mahasiswa prodi yang tercatat ada berapa?');
    expect(himaprodi.source).toBe('semantic-rag-ukm-count');
    expect(himaprodi.answer).toMatch(/\b4\b|empat/i);
    expect(himaprodi.answer).toMatch(/HIMAPRODI/i);
    expect(himaprodi.answer).not.toMatch(/Student Exchange|Hi-?Think|Double Degree/i);

    const broaderHima = await ask('jumlah hima di kampus ada berapa?');
    expect(broaderHima.source).toBe('semantic-rag-ukm-count');
    expect(broaderHima.answer).toMatch(/HIMAPRODI|Himas|Himpunan mahasiswa/i);
    expect(broaderHima.answer).not.toMatch(/Student Exchange|Double Degree/i);
  }, 30000);

  test('rejects unrelated-domain or fabricated count answers in outbound verifier', async () => {
    const wrongDomain = await verifyOutboundSemanticRelevance(
      'Jumlah ormawa di ITB STIKOM Bali ada berapa?',
      'Ada 3 lokasi kampus: Denpasar, Jimbaran, dan Abiansemal.',
      'semantic-rag-campus-location'
    );
    expect(wrongDomain.ok).toBe(false);

    const fabricated = await verifyOutboundSemanticRelevance(
      'Jumlah ormawa di ITB STIKOM Bali ada berapa?',
      'Ada 99 UKM/ORMAWA yang tercatat, termasuk Student Exchange dan Double Degree.',
      'semantic-rag-ukm-count'
    );
    expect(fabricated.ok).toBe(false);
  });

  test('does not hijack non-organization count requests', async () => {
    const facilityCount = await ask('ada berapa lokasi kampus?');
    expect(facilityCount.source).not.toBe('semantic-rag-ukm-count');
    expect(facilityCount.answer).not.toMatch(/32\s+(?:UKM|ORMAWA|Ormawa)/i);
  }, 30000);
});