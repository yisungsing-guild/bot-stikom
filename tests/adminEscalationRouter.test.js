'use strict';

/**
 * adminEscalationRouter.test.js
 *
 * Mandatory Test Suite for Context-Aware Admin Escalation / Human Handoff Router.
 *
 * Test Cases (Mandatory 12):
 * 1. academic + high confidence -> no escalation.
 * 2. academic + low confidence -> Admin Akademik.
 * 3. finance + insufficient evidence -> Admin Keuangan.
 * 4. admission + partial evidence -> Admin PMB.
 * 5. student affairs + low confidence -> Admin Kemahasiswaan.
 * 6. IT + low confidence -> Admin IT.
 * 7. unknown topic -> Admin Umum (Admin STIKOM Bali).
 * 8. conflicting evidence -> escalation.
 * 9. personal/account request -> escalation.
 * 10. sufficient authoritative evidence -> normal answer tanpa nomor admin.
 * 11. topic classifier uncertain -> general admin.
 * 12. nomor/contact tidak tersedia -> jangan mengarang; gunakan generic support message tanpa nomor.
 */

const assert = require('assert');
const { getContactConfig, getAdminContact, formatContactCallToAction } = require('../src/config/adminContacts');
const {
  detectPersonalAccountRequest,
  resolveEscalationTopic,
  evaluateEscalationTriggers,
  composeEscalatedAnswer,
  routeAdminEscalation
} = require('../src/engine/adminEscalationRouter');

describe('Admin Escalation Router & Centralized Contacts Test Suite', () => {

  const testContactOverrides = {
    academic: { phone: '0812-3456-0001' },
    finance: { phone: '0812-3456-0002' },
    student_affairs: { phone: '0812-3456-0003' },
    admission: { phone: '0812-3456-0004' },
    it: { phone: '0812-3456-0005' },
    general: { phone: '0812-3456-0000' }
  };

  // 1. academic + high confidence -> no escalation
  it('TEST 1: academic + high confidence -> no escalation', () => {
    const result = routeAdminEscalation({
      rawQuery: 'Bagaimana prosedur pengajuan cuti akademik?',
      frame: {
        domain: { primary: 'academic', confidence: 0.95 },
        intent: { primary: 'ask_academic_procedure', confidence: 0.95 }
      },
      evaluation: { overallStatus: 'SUPPORTED', hasConflict: false },
      answerPlan: { overallStatus: 'SUPPORTED', telemetry: { supportedBindings: 2, unsupportedBindings: 0, conflictingBindings: 0 } },
      answer: 'Pengajuan cuti akademik dilakukan melalui sistem informasi akademik dengan persetujuan Dosen Wali.',
      contexts: [{ id: 'chunk-1', text: 'Cuti akademik via SIAKAD' }],
      confidenceTier: 'HIGH',
      confidenceScore: 0.92,
      source: 'semantic-rag-academic-policy',
      contactOverrides: testContactOverrides
    });

    assert.strictEqual(result.escalated, false, 'Should NOT escalate when high confidence');
    assert.strictEqual(result.topic, 'academic');
    assert.strictEqual(result.contact, null);
    assert.ok(result.answer.includes('Pengajuan cuti akademik dilakukan melalui sistem'), 'Preserves authoritative answer');
    assert.ok(!result.answer.includes('0812-'), 'Must NOT attach phone number');
    assert.ok(!result.answer.includes('Admin'), 'Must NOT attach admin label');
  });

  // 2. academic + low confidence -> Admin Akademik
  it('TEST 2: academic + low confidence -> Admin Akademik', () => {
    const result = routeAdminEscalation({
      rawQuery: 'Berapa batas waktu revisi skripsi setelah sidang?',
      frame: {
        domain: { primary: 'academic', confidence: 0.85 },
        intent: { primary: 'ask_academic_deadline', confidence: 0.80 }
      },
      evaluation: { overallStatus: 'UNSUPPORTED' },
      answerPlan: { overallStatus: 'UNSUPPORTED' },
      answer: 'Maaf, data yang Anda minta tidak tersedia pada sumber yang kami miliki.',
      contexts: [],
      confidenceTier: 'LOW',
      confidenceScore: 0.40,
      source: 'rag-no-evidence',
      contactOverrides: testContactOverrides
    });

    assert.strictEqual(result.escalated, true, 'Must escalate on low confidence/unsupported');
    assert.strictEqual(result.topic, 'academic');
    assert.strictEqual(result.contact.label, 'Admin Akademik');
    assert.ok(result.answer.includes('Admin Akademik'), 'Must route to Admin Akademik');
    assert.ok(result.answer.includes('0812-3456-0001'), 'Must include official academic phone');
  });

  // 3. finance + insufficient evidence -> Admin Keuangan
  it('TEST 3: finance + insufficient evidence -> Admin Keuangan', () => {
    const result = routeAdminEscalation({
      rawQuery: 'Berapa cicilan DPP gelombang khusus untuk jalur beasiswa?',
      frame: {
        domain: { primary: 'fee', confidence: 0.90 },
        intent: { primary: 'ask_fee_installment', confidence: 0.88 }
      },
      evaluation: { overallStatus: 'UNSUPPORTED' },
      answerPlan: { overallStatus: 'UNSUPPORTED' },
      answer: 'Saya belum menemukan data yang sesuai pada dokumen ITB STIKOM Bali.',
      contexts: [],
      confidenceTier: 'LOW',
      confidenceScore: 0.35,
      source: 'rag-no-evidence',
      contactOverrides: testContactOverrides
    });

    assert.strictEqual(result.escalated, true);
    assert.strictEqual(result.topic, 'finance');
    assert.strictEqual(result.contact.label, 'Admin Keuangan');
    assert.ok(result.answer.includes('Admin Keuangan'));
    assert.ok(result.answer.includes('0812-3456-0002'));
  });

  // 4. admission + partial evidence -> Admin PMB
  it('TEST 4: admission + partial evidence -> Admin PMB', () => {
    const result = routeAdminEscalation({
      rawQuery: 'Bagaimana alur pendaftaran mahasiswa baru dan batas akhir gelombang 2B?',
      frame: {
        domain: { primary: 'admission', confidence: 0.92 },
        intent: { primary: 'ask_admission_procedure', confidence: 0.90 }
      },
      evaluation: { overallStatus: 'PARTIALLY_SUPPORTED' },
      answerPlan: {
        overallStatus: 'PARTIALLY_SUPPORTED',
        telemetry: { supportedBindings: 1, unsupportedBindings: 1, conflictingBindings: 0 }
      },
      answer: 'Pendaftaran mahasiswa baru dilakukan secara online melalui portal siap.stikom-bali.ac.id dengan mengunggah berkas ijazah dan pas foto.',
      contexts: [{ id: 'pmb-chunk-1', text: 'Pendaftaran online via SIAP' }],
      confidenceTier: 'MEDIUM',
      confidenceScore: 0.72,
      source: 'semantic-rag-partial-evidence-composer',
      unsupportedDetail: 'batas akhir penutupan gelombang 2B',
      contactOverrides: testContactOverrides
    });

    assert.strictEqual(result.escalated, true);
    assert.strictEqual(result.topic, 'admission');
    assert.strictEqual(result.contact.label, 'Admin PMB');
    assert.ok(result.answer.includes('Pendaftaran mahasiswa baru dilakukan secara online'), 'Preserves supported subpart');
    assert.ok(result.answer.includes('Namun saya belum menemukan'), 'Contains boundary phrasing');
    assert.ok(result.answer.includes('Admin PMB'));
    assert.ok(result.answer.includes('0812-3456-0004'));
  });

  // 5. student affairs + low confidence -> Admin Kemahasiswaan
  it('TEST 5: student affairs + low confidence -> Admin Kemahasiswaan', () => {
    const result = routeAdminEscalation({
      rawQuery: 'Apa saja syarat pembentukan UKM baru di STIKOM Bali?',
      frame: {
        domain: { primary: 'student_organization', confidence: 0.85 },
        intent: { primary: 'ask_organization_policy', confidence: 0.80 }
      },
      evaluation: { overallStatus: 'UNSUPPORTED' },
      answerPlan: { overallStatus: 'UNSUPPORTED' },
      answer: 'Maaf, data yang Anda minta tidak tersedia.',
      contexts: [],
      confidenceTier: 'LOW',
      confidenceScore: 0.42,
      source: 'rag-no-evidence',
      contactOverrides: testContactOverrides
    });

    assert.strictEqual(result.escalated, true);
    assert.strictEqual(result.topic, 'student_affairs');
    assert.strictEqual(result.contact.label, 'Admin Kemahasiswaan');
    assert.ok(result.answer.includes('Admin Kemahasiswaan'));
    assert.ok(result.answer.includes('0812-3456-0003'));
  });

  // 6. IT + low confidence -> Admin IT
  it('TEST 6: IT + low confidence -> Admin IT', () => {
    const result = routeAdminEscalation({
      rawQuery: 'Kenapa saya tidak bisa login ke portal siakad dan wifi kampus error?',
      frame: {
        domain: { primary: 'it', confidence: 0.88 },
        intent: { primary: 'ask_system_troubleshooting', confidence: 0.85 }
      },
      evaluation: { overallStatus: 'UNSUPPORTED' },
      answerPlan: { overallStatus: 'UNSUPPORTED' },
      answer: 'Saya belum menemukan petunjuk troubleshooting untuk error tersebut.',
      contexts: [],
      confidenceTier: 'LOW',
      confidenceScore: 0.40,
      source: 'rag-no-evidence',
      contactOverrides: testContactOverrides
    });

    assert.strictEqual(result.escalated, true);
    assert.strictEqual(result.topic, 'it');
    assert.strictEqual(result.contact.label, 'Admin IT');
    assert.ok(result.answer.includes('Admin IT'));
    assert.ok(result.answer.includes('0812-3456-0005'));
  });

  // 7. unknown topic -> Admin Umum (Admin STIKOM Bali)
  it('TEST 7: unknown topic -> Admin Umum (Admin STIKOM Bali)', () => {
    const result = routeAdminEscalation({
      rawQuery: 'xyz abc perizinan gedung luar kota',
      frame: {
        domain: { primary: 'unknown', confidence: 0.40 },
        intent: { primary: 'ask_general', confidence: 0.30 }
      },
      evaluation: { overallStatus: 'UNSUPPORTED' },
      answerPlan: { overallStatus: 'UNSUPPORTED' },
      answer: 'Maaf, saya tidak menemukan informasi.',
      contexts: [],
      confidenceTier: 'VERY_LOW',
      confidenceScore: 0.20,
      source: 'rag-no-evidence',
      contactOverrides: testContactOverrides
    });

    assert.strictEqual(result.escalated, true);
    assert.strictEqual(result.topic, 'general');
    assert.strictEqual(result.contact.label, 'Admin STIKOM Bali');
    assert.ok(result.answer.includes('Admin STIKOM Bali'));
    assert.ok(result.answer.includes('0812-3456-0000'));
  });

  // 8. conflicting evidence -> escalation
  it('TEST 8: conflicting evidence -> escalation', () => {
    const result = routeAdminEscalation({
      rawQuery: 'Berapa masa berlaku SKTT mahasiswa asing?',
      frame: {
        domain: { primary: 'academic', confidence: 0.85 },
        intent: { primary: 'ask_document_validity', confidence: 0.80 }
      },
      evaluation: { overallStatus: 'CONFLICTING', hasConflict: true },
      answerPlan: {
        overallStatus: 'CONFLICTING',
        telemetry: { supportedBindings: 0, unsupportedBindings: 0, conflictingBindings: 1 }
      },
      answer: 'Terdapat perbedaan informasi pada dokumen resmi terkait SKTT:\n- Sumber A: 6 bulan\n- Sumber B: 1 tahun',
      contexts: [{ id: 'chunk-1' }, { id: 'chunk-2' }],
      confidenceTier: 'LOW',
      confidenceScore: 0.50,
      source: 'semantic-rag-conflict-verifier',
      contactOverrides: testContactOverrides
    });

    assert.strictEqual(result.escalated, true);
    assert.strictEqual(result.trigger, 'evidence_conflict');
    assert.ok(result.answer.includes('Terdapat perbedaan informasi pada dokumen resmi'));
    assert.ok(result.answer.includes('Admin Akademik'));
  });

  // 9. personal/account request -> escalation
  it('TEST 9: personal/account request -> escalation', () => {
    const queries = [
      { q: 'Cek total sisa tagihan kuliah saya untuk semester ini', expectedTopic: 'finance', expectedLabel: 'Admin Keuangan' },
      { q: 'Bisa tolong cek nilai transkrip dan IPK saya?', expectedTopic: 'academic', expectedLabel: 'Admin Akademik' },
      { q: 'Saya lupa password akun siakad saya, tolong reset kata sandi saya', expectedTopic: 'it', expectedLabel: 'Admin IT' },
      { q: 'Bagaimana status berkas pendaftaran saya atas nama Budi?', expectedTopic: 'admission', expectedLabel: 'Admin PMB' }
    ];

    for (const item of queries) {
      const result = routeAdminEscalation({
        rawQuery: item.q,
        frame: null,
        answer: 'Ini jawaban mentah',
        contexts: [],
        confidenceScore: 0.80,
        contactOverrides: testContactOverrides
      });

      assert.strictEqual(result.escalated, true, `Query "${item.q}" must escalate`);
      assert.strictEqual(result.trigger, 'personal_account_request');
      assert.strictEqual(result.topic, item.expectedTopic);
      assert.strictEqual(result.contact.label, item.expectedLabel);
      assert.ok(result.answer.includes('data akun atau transaksi personal'), 'Explains personal data boundary');
      assert.ok(result.answer.includes(item.expectedLabel));
    }
  });

  // 10. sufficient authoritative evidence -> normal answer tanpa nomor admin
  it('TEST 10: sufficient authoritative evidence -> normal answer tanpa nomor admin', () => {
    const result = routeAdminEscalation({
      rawQuery: 'Dimana alamat kampus pusat ITB STIKOM Bali?',
      frame: {
        domain: { primary: 'campus_facility', confidence: 0.95 },
        intent: { primary: 'ask_location', confidence: 0.95 }
      },
      evaluation: { overallStatus: 'SUPPORTED', hasConflict: false },
      answerPlan: { overallStatus: 'SUPPORTED', telemetry: { supportedBindings: 1, unsupportedBindings: 0, conflictingBindings: 0 } },
      answer: 'Kampus Pusat ITB STIKOM Bali beralamat di Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.',
      contexts: [{ id: 'loc-1', text: 'Jl. Raya Puputan No. 86 Renon' }],
      confidenceTier: 'HIGH',
      confidenceScore: 0.98,
      source: 'semantic-rag-grounded-composer',
      contactOverrides: testContactOverrides
    });

    assert.strictEqual(result.escalated, false);
    assert.strictEqual(result.contact, null);
    assert.strictEqual(result.answer, 'Kampus Pusat ITB STIKOM Bali beralamat di Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.');
    assert.ok(!result.answer.includes('0812-'), 'Zero phone numbers in normal authoritative response');
    assert.ok(!result.answer.includes('Admin'), 'Zero admin labels in normal authoritative response');
  });

  // 11. topic classifier uncertain -> general admin
  it('TEST 11: topic classifier uncertain (< 0.60) -> general admin (Admin STIKOM Bali)', () => {
    const result = routeAdminEscalation({
      rawQuery: 'Hal umum terkait fasilitas yayasan',
      frame: {
        domain: { primary: 'academic', confidence: 0.45 }, // UNCERTAIN confidence (< 0.60)
        intent: { primary: 'ask_unknown', confidence: 0.40 }
      },
      evaluation: { overallStatus: 'UNSUPPORTED' },
      answerPlan: { overallStatus: 'UNSUPPORTED' },
      answer: 'Maaf, data tidak ditemukan.',
      contexts: [],
      confidenceTier: 'LOW',
      confidenceScore: 0.30,
      source: 'rag-no-evidence',
      contactOverrides: testContactOverrides
    });

    assert.strictEqual(result.escalated, true);
    assert.strictEqual(result.topic, 'general', 'Uncertain domain must fall back to general');
    assert.strictEqual(result.contact.label, 'Admin STIKOM Bali');
    assert.ok(result.answer.includes('Admin STIKOM Bali'));
    assert.ok(result.answer.includes('0812-3456-0000'));
  });

  // 12. nomor/contact tidak tersedia -> jangan mengarang; gunakan generic support message tanpa nomor
  it('TEST 12: nomor/contact tidak tersedia -> jangan mengarang; gunakan generic support message tanpa nomor', () => {
    // Empty phone overrides simulating unconfigured production env
    const emptyContactOverrides = {
      academic: { phone: '' },
      finance: { phone: '' },
      student_affairs: { phone: '' },
      admission: { phone: '' },
      it: { phone: '' },
      general: { phone: '' }
    };

    const result = routeAdminEscalation({
      rawQuery: 'Berapa denda keterlambatan pembayaran SPP?',
      frame: {
        domain: { primary: 'fee', confidence: 0.90 },
        intent: { primary: 'ask_fee_penalty', confidence: 0.85 }
      },
      evaluation: { overallStatus: 'UNSUPPORTED' },
      answerPlan: { overallStatus: 'UNSUPPORTED' },
      answer: 'Saya belum menemukan data yang sesuai.',
      contexts: [],
      confidenceTier: 'LOW',
      confidenceScore: 0.35,
      source: 'rag-no-evidence',
      contactOverrides: emptyContactOverrides
    });

    assert.strictEqual(result.escalated, true);
    assert.strictEqual(result.topic, 'finance');
    assert.strictEqual(result.contact.hasPhone, false);
    assert.strictEqual(result.contact.phone, '');
    assert.ok(result.answer.includes('silakan hubungi Admin Keuangan.'), 'Must output admin label cleanly');
    assert.ok(!/\b(?:\d{3,4}[-\s]?\d{3,4}|\+62|\(\d+\))\b/.test(result.answer), 'Must NOT contain any phone digits');
    assert.ok(!result.answer.includes('<KONTAK_RESMI>'), 'Must NOT contain placeholder string');
  });

});
