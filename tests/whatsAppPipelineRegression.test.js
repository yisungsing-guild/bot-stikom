/**
 * tests/whatsAppPipelineRegression.test.js
 *
 * End-to-End User-Facing WhatsApp Pipeline Regression Suite.
 * Validates the full execution path via querySemanticRag (matching WhatsApp webhook runtime)
 * for the 5 key scenarios observed during production manual functional testing.
 */

const { querySemanticRag } = require('../src/engine/semanticRagEngine');

describe('End-to-End WhatsApp User-Facing Pipeline Regression Suite', () => {
  jest.setTimeout(30000);

  // Scenario 1: Bisnis Digital SKS
  test('Scenario 1: "Berapa jumlah SKS Bisnis Digital?" returns authoritative answer from KB without generic fallback', async () => {
    const res = await querySemanticRag('Berapa jumlah SKS Bisnis Digital?');
    expect(res.success).toBe(true);
    expect(res.source).toBe('semantic-rag-academic-credit-no-data');
    expect(res.outputType).toBe('ANSWER');

    // Must NOT be blocked by contract verifier
    expect(res.debug?.blockedSource).toBeUndefined();
    expect(res.source).not.toBe('semantic-rag-contract-verifier-blocked');
    expect(res.source).not.toBe('semantic-rag-meaning-verifier-blocked');

    // Must contain authoritative academic SKS explanation
    expect(res.answer).toMatch(/SKS/i);
    expect(res.answer).toMatch(/Bisnis Digital/i);
    expect(res.answer).toMatch(/kurikulum|beban SKS|akademik/i);

    // Must not be overwritten with generic meaning mismatch fallback
    expect(res.answer).not.toMatch(/Saya belum menemukan data yang sesuai untuk menjawab pertanyaan itu/i);
  });

  // Scenario 2: UKM Olahraga
  test('Scenario 2: "Apakah ada UKM olahraga?" returns grounded answer listing sports UKMs without false insufficient evidence', async () => {
    const res = await querySemanticRag('Apakah ada UKM olahraga?');
    expect(res.success).toBe(true);
    expect(res.source).toBe('semantic-rag-ukm-category');
    expect(res.outputType).toBe('ANSWER');

    // Must contain grounded sports UKMs
    expect(res.answer).toMatch(/olahraga/i);
    expect(res.answer).toMatch(/Futsal|Basket/i);

    // Must not escalate to insufficient evidence
    expect(res.debug?.adminEscalation?.escalated).toBe(false);
    expect(res.debug?.adminEscalation?.trigger).toBeNull();
    expect(res.answer).not.toMatch(/Saya belum menemukan informasi yang cukup lengkap untuk memastikan hal tersebut/i);
  });

  // Scenario 3: SKSS Scholarship
  test('Scenario 3: "Apa syarat beasiswa SKSS?" safe escalation without hallucinating facts', async () => {
    const res = await querySemanticRag('Apa syarat beasiswa SKSS?');
    expect(res.success).toBe(true);

    // Source absent: safe escalation is required
    expect(res.debug?.adminEscalation?.escalated).toBe(true);
    expect(res.debug?.adminEscalation?.topic).toBe('general');
    expect(res.debug?.adminEscalation?.contact?.label).toBe('Admin STIKOM Bali');

    // Must NOT invent SKSS requirements
    expect(res.answer).not.toMatch(/IPK minimal 3\.\d/i);
    expect(res.answer).not.toMatch(/surat keterangan tidak mampu/i);
    expect(res.answer).toMatch(/Admin STIKOM Bali/i);
  });

  // Scenario 4: SION Escalation
  test('Scenario 4: "Saya mengalami kendala SION, harus menghubungi siapa?" routes to Admin IT without generic clarification', async () => {
    const res = await querySemanticRag('Saya mengalami kendala SION, harus menghubungi siapa?');
    expect(res.success).toBe(true);
    expect(res.outputType).toBe('ANSWER');

    // Must NOT enter generic clarification prompt
    expect(res.source).not.toBe('semantic-rag-clarify');
    expect(res.outputType).not.toBe('CLARIFICATION');
    expect(res.answer).not.toMatch(/Bisa jelaskan topik yang ingin ditanyakan, Kak\?/i);

    // Must escalate cleanly to Admin IT
    expect(res.debug?.adminEscalation?.escalated).toBe(true);
    expect(res.debug?.adminEscalation?.topic).toBe('it');
    expect(res.debug?.adminEscalation?.contact?.label).toBe('Admin IT');
    expect(res.answer).toMatch(/Admin IT/i);
  });

  // Scenario 5: Ambiguous Query
  test('Scenario 5: "Apa saja program yang ada?" preserves clarification prompt without regression', async () => {
    const res = await querySemanticRag('Apa saja program yang ada?');
    expect(res.success).toBe(true);
    expect(res.outputType).toBe('CLARIFICATION');
    expect(res.source).toBe('semantic-rag-clarify');
    expect(res.answer).toMatch(/Bisa jelaskan topik yang ingin ditanyakan/i);

    // Must not be falsely escalated to any specific admin
    expect(res.debug?.adminEscalation?.escalated).toBeFalsy();
  });

  // Safety & Boundary: Contact Number Integrity
  test('Safety: contact numbers are not fabricated when empty', async () => {
    const res = await querySemanticRag('Saya mengalami kendala SION, harus menghubungi siapa?');
    const contact = res.debug?.adminEscalation?.contact;
    if (!contact?.hasPhone) {
      expect(contact?.phone).toBe('');
      expect(res.answer).not.toMatch(/\+?62\d{8,}/);
      expect(res.answer).not.toMatch(/08\d{8,}/);
    }
  });

  // Safety: Truly unknown personal topic falls back to general admin
  test('Safety: unknown account query falls back to general admin if no category matches', async () => {
    const res = await querySemanticRag('Data pribadi saya bermasalah dengan kartu x');
    expect(res.debug?.adminEscalation?.escalated).toBe(true);
    expect(['academic', 'general']).toContain(res.debug?.adminEscalation?.topic);
  });
});
