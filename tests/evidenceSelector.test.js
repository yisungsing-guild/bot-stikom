const {
  selectEvidenceFromContexts,
  evaluateEvidenceAnswerability,
  buildSelectedEvidenceContext
} = require('../src/engine/evidenceSelector');
const { buildContextText } = require('../src/engine/semanticRagEngine');

const legalTemplate = `
Program internasional / kerja sama internasional: left 8255 Logo Mitra right -83820
PERJANJIAN KERJA SAMA ANTARA INSTITUT TEKNOLOGI DAN BISNIS STIKOM BALI DAN (NAMA MITRA)
Nomor: ................................
Pasal 1 MAKSUD DAN TUJUAN
Maksud dari Perjanjian ini adalah untuk menetapkan landasan kemitraan strategis antara PARA PIHAK.
Pasal 9 FORCE MAJEURE
Masing-masing pihak dibebaskan dari tanggung jawab atas keterlambatan atau kegagalan dalam memenuhi kewajiban yang disebabkan kejadian di luar kekuasaan masing-masing pihak.
Pasal 13 ADDENDUM
Perubahan terhadap Perjanjian Kerja Sama ini akan ditetapkan dalam addendum yang disepakati PARA PIHAK.
PIHAK KESATU INSTITUT TEKNOLOGI DAN BISNIS STIKOM BALI
PIHAK KEDUA (NAMA MITRA)
`;

describe('evidenceSelector', () => {
  test('rejects PKS legal template for international program list and marks not answerable', () => {
    const selected = selectEvidenceFromContexts({
      question: 'Apa saja program internasional yang dimiliki kampus?',
      contexts: [{ chunk: legalTemplate, filename: 'template-pks.docx', trainingId: 'pks-1' }],
      intent: 'international_program'
    });
    const answerability = evaluateEvidenceAnswerability({
      question: 'Apa saja program internasional yang dimiliki kampus?',
      selectedEvidence: selected,
      intent: 'international_program'
    });
    const context = buildSelectedEvidenceContext(selected);

    expect(selected).toHaveLength(0);
    expect(answerability.answerable).toBe(false);
    expect(context).not.toMatch(/Pasal|Force Majeure|Addendum|PIHAK KESATU|PIHAK KEDUA/i);
  });

  test('allows explicit legal question and selects only requested Pasal 9', () => {
    const selected = selectEvidenceFromContexts({
      question: 'Apa isi Pasal 9 tentang force majeure?',
      contexts: [{ chunk: legalTemplate, filename: 'template-pks.docx', trainingId: 'pks-1' }],
      intent: 'legal'
    });
    const answerability = evaluateEvidenceAnswerability({
      question: 'Apa isi Pasal 9 tentang force majeure?',
      selectedEvidence: selected,
      intent: 'legal'
    });
    const context = buildSelectedEvidenceContext(selected);

    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(answerability.answerable).toBe(true);
    expect(context).toMatch(/Pasal 9/i);
    expect(context).not.toMatch(/Pasal 1|Pasal 13|Addendum|PIHAK KESATU|PIHAK KEDUA/i);
  });

  test('fee question requires requested program and amount', () => {
    const selected = selectEvidenceFromContexts({
      question: 'Berapa biaya kuliah Sistem Informasi?',
      contexts: [
        { chunk: 'Program Sistem Informasi tersedia untuk jenjang S1. Biaya kuliah akan diinformasikan kemudian.', filename: 'si.md' },
        { chunk: 'Program Teknologi Informasi biaya kuliah Rp 6.000.000 per semester.', filename: 'ti.md' }
      ],
      intent: 'fee'
    });
    const answerability = evaluateEvidenceAnswerability({
      question: 'Berapa biaya kuliah Sistem Informasi?',
      selectedEvidence: selected,
      intent: 'fee'
    });
    const context = buildSelectedEvidenceContext(selected);

    expect(context).toMatch(/Sistem Informasi/i);
    expect(context).not.toMatch(/Teknologi Informasi biaya kuliah Rp 6\.000\.000/i);
    expect(answerability.answerable).toBe(false);
    expect(answerability.missingEvidence).toContain('fee_amount');
  });

  test('ambiguous short query is not answerable', () => {
    const selected = selectEvidenceFromContexts({
      question: 'mempunyai?',
      contexts: [{ chunk: 'Kampus mempunyai beberapa fasilitas akademik dan layanan mahasiswa.' }],
      intent: ''
    });
    const answerability = evaluateEvidenceAnswerability({
      question: 'mempunyai?',
      selectedEvidence: selected,
      intent: ''
    });

    expect(answerability.answerable).toBe(false);
    expect(answerability.missingEvidence).toContain('question_object');
  });

  test('deduplicates repeated evidence before prompt', () => {
    const text = 'GCCP adalah program internasional yang mendukung kesiapan mahasiswa untuk pengalaman global.';
    const selected = selectEvidenceFromContexts({
      question: 'Apa saja program internasional yang dimiliki kampus?',
      contexts: [
        { chunk: text, filename: 'a.md' },
        { chunk: text, filename: 'a-copy.md' },
        { chunk: 'BCCP adalah program internasional yang mendukung pengembangan wawasan bisnis mahasiswa.', filename: 'b.md' }
      ],
      intent: 'international_program'
    });
    const context = buildSelectedEvidenceContext(selected);

    expect(selected).toHaveLength(2);
    expect((context.match(/GCCP/g) || []).length).toBe(1);
    expect(context).toMatch(/BCCP/);
  });

  test('semantic context builder ignores non-selected raw chunks', () => {
    const context = buildContextText([
      { chunk: legalTemplate, filename: 'raw-template.docx' },
      {
        text: 'GCCP adalah program internasional yang mendukung kesiapan mahasiswa untuk pengalaman global.',
        source: 'program-internasional.md',
        sourceId: 'gccp',
        relevanceScore: 1,
        entityScore: 1,
        intentScore: 1,
        reason: 'test',
        isSelectedEvidence: true
      }
    ]);

    expect(context).toMatch(/GCCP/);
    expect(context).not.toMatch(/Pasal 9|PIHAK KESATU|Force Majeure/i);
  });
});
