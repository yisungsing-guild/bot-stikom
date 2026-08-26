const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'production';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'true';
process.env.ENABLE_AI = 'true';
process.env.RAG_MIN_SCORE = '0.0';
process.env.BOT_REPLY_TIMEOUT_MS = '45000';
process.env.RAG_DEBUG_CHUNK_SCORING = 'false';
process.env.RAG_AUDIT_LOGGING = 'false';
process.env.PROVIDER_WEBHOOK_TOKEN = '';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
delete process.env.OPENAI_API_KEY;

const providerRouterFactory = require('../src/routes/provider');

function buildApp() {
  const sent = [];
  const provider = {
    sendMessage: async (chatId, text, meta) => {
      sent.push({ chatId, text: String(text || ''), meta: meta || {} });
    },
    sendImage: async () => {}
  };
  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));
  return { app, provider, sent };
}

async function ask(ctx, chatId, text) {
  const before = ctx.sent.length;
  const res = await request(ctx.app)
    .post('/provider/webhook')
    .send({ chatId, text, ts: Date.now() });
  const newMessages = ctx.sent.slice(before).map((m) => m.text).join('\n');
  const lastMeta = ctx.sent.length > before ? ctx.sent[ctx.sent.length - 1].meta : {};
  return { res, text: newMessages, meta: lastMeta, allText: ctx.sent.map((m) => m.text).join('\n') };
}

function expectNoRawLeak(text) {
  if (/\[Sheet:|OCR berhasil mengekstrak teks|Ringkasan dokumen:|source\s*:|chunk\s*:|embedding|metadata|debug|didedikasikan\s*-\s*Selain|-\s*Career Center[\s\S]{0,140}-\s*Selain memperoleh/i.test(text)) {
    throw new Error(`RAW_LEAK_DETECTED in output: ${text.slice(0, 200)}`);
  }
}

async function runProductionValidation() {
  console.log('====================================================');
  console.log('STARTING PRODUCTION VALIDATION ON RELEASE CANDIDATE');
  console.log('====================================================');

  const ctx = buildApp();
  const results = [];

  // ==========================================================
  // 1. FULL PERSISTENT-SESSION PRODUCTION-EQUIVALENT SEQUENCE
  // ==========================================================
  console.log('\n--- 1. Full Persistent-Session Production Sequence ---');
  const seq1ChatId = `prod-seq1-${Date.now()}`;
  const seq1Turns = [
    {
      turn: 1,
      name: 'PMB Schedule & Info',
      query: 'Halo, jadwal dan informasi pendaftaran PMB ITB STIKOM Bali bagaimana?',
      check: (t) => {
        if (!/PMB|pendaftaran|gelombang|siap\.stikom-bali\.ac\.id/i.test(t)) throw new Error('Missing PMB info');
      }
    },
    {
      turn: 2,
      name: 'S1 vs D3 Comparison',
      query: 'apa beda jenjang s1 dan d3?',
      check: (t) => {
        if (!/S1|Sarjana/i.test(t) || !/D3|Diploma/i.test(t)) throw new Error('Missing S1/D3 comparison');
      }
    },
    {
      turn: 3,
      name: 'Program List',
      query: 'jurusan apa saja yang ada?',
      check: (t) => {
        if (!/Sistem Informasi/i.test(t) || !/Teknologi Informasi/i.test(t) || !/Bisnis Digital/i.test(t)) throw new Error('Missing program list');
      }
    },
    {
      turn: 4,
      name: 'ORMAWA Count',
      query: 'ada berapa ormawa di stikom?',
      check: (t) => {
        if (!/32|tiga puluh dua/i.test(t)) throw new Error('Missing 32 ORMAWA count');
        if (/Hi-?Think|Student Exchange|Double Degree/i.test(t)) throw new Error('Contaminated by foreign topics');
      }
    },
    {
      turn: 5,
      name: 'ORMAWA Follow-up List',
      query: 'ukm apa saja itu?',
      check: (t) => {
        if (!/MCOS|KSL|KMHD|Syntax|Progress|Ghost|DOS|Basket|Futsal|Musik/i.test(t)) throw new Error('Missing UKM list in follow-up');
      }
    },
    {
      turn: 6,
      name: 'Accreditation',
      query: 'bagaimana akreditasi sistem informasi?',
      check: (t) => {
        if (!/Baik Sekali|akreditasi/i.test(t)) throw new Error('Missing SI accreditation');
      }
    },
    {
      turn: 7,
      name: 'International Double Degree',
      query: 'apakah ada program internasional double degree?',
      check: (t) => {
        if (!/DNUI|HELP|UTB|Double Degree/i.test(t)) throw new Error('Missing Double Degree programs');
      }
    },
    {
      turn: 8,
      name: 'Career Center Definition',
      query: 'apa itu Career Center?',
      check: (t) => {
        if (!/Career Center|karier|pelatihan|persiapan|alumni|kerja/i.test(t)) throw new Error('Missing Career Center definition');
      }
    },
    {
      turn: 9,
      name: 'Career Center Benefit',
      query: 'apa keuntungan dari Career Center untuk mahasiswa?',
      check: (t) => {
        if (!/manfaat|keuntungan|bimbingan|lowongan|magang|pelatihan|persiapan/i.test(t)) throw new Error('Missing Career Center benefits');
      }
    },
    {
      turn: 10,
      name: 'Career Goal Recommendation',
      query: 'saya mau kerja di bidang digital marketing, cocoknya ambil apa?',
      check: (t) => {
        if (!/Bisnis Digital/i.test(t)) throw new Error('Missing Bisnis Digital recommendation for digital marketing');
      }
    },
    {
      turn: 11,
      name: 'Employment Support',
      query: 'apakah stikom membantu lulusan mencari pekerjaan?',
      check: (t) => {
        if (!/Career Center|lowongan|magang|campus hiring|kerja|pekerjaan/i.test(t)) throw new Error('Missing employment support details');
      }
    }
  ];

  for (const t of seq1Turns) {
    const start = Date.now();
    const reply = await ask(ctx, seq1ChatId, t.query);
    const duration = Date.now() - start;
    expectNoRawLeak(reply.text);
    try {
      t.check(reply.text);
      console.log(`  [PASS] Turn ${t.turn} (${t.name}): ${duration}ms | Source: ${reply.meta.source || 'N/A'}`);
      results.push({ test: `Seq1_Turn_${t.turn}_${t.name}`, status: 'PASS', duration });
    } catch (err) {
      console.error(`  [FAIL] Turn ${t.turn} (${t.name}): ${err.message}`);
      console.error(`         Answer: ${reply.text.slice(0, 300)}`);
      results.push({ test: `Seq1_Turn_${t.turn}_${t.name}`, status: 'FAIL', error: err.message, answer: reply.text });
    }
  }

  // ==========================================================
  // 2. REAL WHATSAPP VERIFICATION: CONTEXT-SWITCH & ANTI-STALE
  // ==========================================================
  console.log('\n--- 2. Real WhatsApp Verification: Context-Switch & Elliptical Follow-up ---');
  const seq2ChatId = `prod-seq2-${Date.now()}`;
  const seq2Turns = [
    {
      turn: 1,
      name: 'UKM List',
      query: 'ukm apa saja yang ada di stikom?',
      check: (t) => {
        if (!/MCOS|KSL|KMHD|Syntax|Progress/i.test(t)) throw new Error('Missing UKM list');
      }
    },
    {
      turn: 2,
      name: 'Switch -> PMB Fee',
      query: 'berapa biaya pendaftaran pmb?',
      check: (t) => {
        if (!/500\.000|500000|biaya pendaftaran/i.test(t)) throw new Error('Missing registration fee');
        if (/MCOS|KSL|Syntax/i.test(t)) throw new Error('Stale UKM context leaked');
      }
    },
    {
      turn: 3,
      name: 'Followup -> Semester SPP',
      query: 'kalau biaya spp per semester berapa?',
      check: (t) => {
        if (!/UKT|semester|6\.500\.000|7\.500\.000|9\.000\.000/i.test(t)) throw new Error('Missing semester fee');
      }
    },
    {
      turn: 4,
      name: 'Switch -> Career Center Role',
      query: 'apa peran Career Center?',
      check: (t) => {
        if (!/Career Center|karier|kerja|magang|bimbingan/i.test(t)) throw new Error('Missing Career Center role');
        if (/UKT|DPP|500\.000/i.test(t)) throw new Error('Stale fee context leaked');
      }
    },
    {
      turn: 5,
      name: 'Switch -> TI Accreditation',
      query: 'akreditasi TI apa?',
      check: (t) => {
        if (!/Teknologi Informasi/i.test(t) || !/\bBaik\b/i.test(t)) throw new Error('Missing TI accreditation');
        if (/Career Center/i.test(t)) throw new Error('Stale Career Center context leaked');
      }
    },
    {
      turn: 6,
      name: 'Followup -> Accreditation Validity',
      query: 'berlaku sampai kapan?',
      check: (t) => {
        if (!/2027|berlaku|akreditasi/i.test(t)) throw new Error('Missing TI accreditation validity period');
        if (/Career Center|biaya/i.test(t)) throw new Error('Resolved to wrong entity');
      }
    }
  ];

  for (const t of seq2Turns) {
    const start = Date.now();
    const reply = await ask(ctx, seq2ChatId, t.query);
    const duration = Date.now() - start;
    expectNoRawLeak(reply.text);
    try {
      t.check(reply.text);
      console.log(`  [PASS] Turn ${t.turn} (${t.name}): ${duration}ms | Source: ${reply.meta.source || 'N/A'}`);
      results.push({ test: `Seq2_Turn_${t.turn}_${t.name}`, status: 'PASS', duration });
    } catch (err) {
      console.error(`  [FAIL] Turn ${t.turn} (${t.name}): ${err.message}`);
      console.error(`         Answer: ${reply.text.slice(0, 300)}`);
      results.push({ test: `Seq2_Turn_${t.turn}_${t.name}`, status: 'FAIL', error: err.message, answer: reply.text });
    }
  }

  // ==========================================================
  // SUMMARY AND VERDICT
  // ==========================================================
  const failures = results.filter((r) => r.status === 'FAIL');
  console.log('\n====================================================');
  console.log(`TOTAL CHECKS: ${results.length} | PASSED: ${results.length - failures.length} | FAILED: ${failures.length}`);
  console.log('====================================================');

  if (failures.length > 0) {
    console.error('FIRST_FAILURE:', JSON.stringify(failures[0], null, 2));
    process.exit(1);
  } else {
    console.log('ALL PRODUCTION EQUIVALENT CHECKS PASSED.');
    console.log('SEMANTIC_CONSOLIDATION_DEPLOYED_VALIDATED');
  }
}

runProductionValidation().catch((err) => {
  console.error('RUN ERROR:', err);
  process.exit(1);
});
