const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { sanitizeWhatsappText } = require('../src/utils/textSanitizer');

const MOJIBAKE_PATTERNS = [
  /Ãƒ[^\s]*/,
  /Ã‚/,
  /â€¢/,
  /â€“/,
  /â€”/,
  /â€˜/,
  /â€™/,
  /â€œ/,
  /â€/,
  /ï¿½/,
  /\uFFFD/
];

function hasMojibake(text) {
  if (!text || typeof text !== 'string') return false;
  return MOJIBAKE_PATTERNS.some(p => p.test(text));
}

async function runPostDeploySmoke() {
  console.log('=== RUNNING POST-DEPLOY SMOKE TEST ===\n');

  const smokeQueries = [
    {
      id: 1,
      input: 'min TI brp daftar?',
      expectedSource: /semantic-rag-(?:fee|registration)/,
      validate: (ans) => /500\.000|pendaftaran/i.test(ans),
      desc: 'Registration fee for TI'
    },
    {
      id: 2,
      input: 'kalau biaya semesterannya?',
      sessionData: { lastProgramHint: 'Teknologi Informasi', lastFeeCategory: 'biaya_kuliah', messages: [{ direction: 'user', message: 'min TI brp daftar?' }] },
      expectedSource: /semantic-rag-fee/,
      validate: (ans) => /6\.500\.000|semester/i.test(ans),
      desc: 'Semester fee follow-up / anaphora'
    },
    {
      id: 3,
      input: 'berapa rincian biaya kuliah teknologi informasi gelombang 1?',
      expectedSource: /semantic-rag-fee-detail/,
      validate: (ans) => /14\.000\.000|Teknologi Informasi|DPP/i.test(ans),
      desc: 'Wave 1 fee breakdown for TI'
    },
    {
      id: 4,
      input: 'bisa dicicil ga min?',
      sessionData: { lastProgramHint: 'Teknologi Informasi', lastFeeCategory: 'biaya_kuliah' },
      expectedSource: /semantic-rag-fee-general/,
      validate: (ans) => /cicil|angsur|tahap|bayar/i.test(ans),
      desc: 'Installment inquiry with session context'
    },
    {
      id: 5,
      input: 'kapan jadwal pendaftaran pmb gelombang 2 dibuka?',
      expectedSource: /semantic-rag-schedule-window/,
      validate: (ans) => /gelombang|jadwal|pendaftaran/i.test(ans),
      desc: 'PMB schedule for wave 2'
    },
    {
      id: 6,
      input: 'apakah ada beasiswa untuk mahasiswa baru di stikom bali?',
      expectedSource: /semantic-rag-scholarship/,
      validate: (ans) => /beasiswa/i.test(ans),
      desc: 'Freshmen scholarship options'
    },
    {
      id: 7,
      input: 'mata kuliah sistem informasi apa saja?',
      expectedSource: /semantic-rag-program-curriculum/,
      validate: (ans) => /Sistem Informasi|kurikulum|mata kuliah/i.test(ans),
      desc: 'Curriculum / courses for SI'
    },
    {
      id: 8,
      input: 'lulusan teknologi informasi kerjanya jadi apa ya?',
      expectedSource: /semantic-rag-program-curriculum/,
      validate: (ans) => /prospek karir|pekerjaan|bidang|karir/i.test(ans),
      desc: 'Career prospects for TI'
    },
    {
      id: 9,
      input: 'syaratnya apa ya?',
      expectedSource: /semantic-rag-clarify/,
      validate: (ans) => /syarat|PMB|dokumen|jelaskan/i.test(ans) || ans.length > 20,
      desc: 'Ambiguous query clarification'
    },
    {
      id: 10,
      input: 'kamu suka dengerin musik apa?',
      expectedSource: /semantic-rag-small-talk/,
      validate: (ans) => /Tiko|asisten|musik|membantu|tanya/i.test(ans),
      desc: 'Small-talk / out-of-domain safe reply'
    }
  ];

  let failures = [];
  let mojibakeFailures = [];

  for (const q of smokeQueries) {
    const res = await querySemanticRag(q.input, { sessionData: q.sessionData || {} });
    const cleanOutbound = sanitizeWhatsappText(res.answer || '');

    const passValid = q.validate(cleanOutbound);
    const passSource = q.expectedSource.test(res.source);
    const hasMoji = hasMojibake(cleanOutbound);

    if (hasMoji) {
      mojibakeFailures.push({ input: q.input, output: cleanOutbound });
    }

    if (!res.success || !passValid || !passSource || hasMoji) {
      failures.push({
        input: q.input,
        expected: q.desc,
        expectedSource: q.expectedSource.toString(),
        actualSource: res.source,
        actualOutput: cleanOutbound,
        passValid,
        passSource,
        hasMoji
      });
      console.log(`[FAIL] Query #${q.id}: "${q.input}"`);
      console.log(`       Source: ${res.source}`);
      console.log(`       Preview: ${cleanOutbound.slice(0, 100)}...`);
    } else {
      console.log(`[PASS] Query #${q.id}: "${q.input}" -> [${res.source}]`);
    }
  }

  console.log('\n=== MULTI-TURN CONTEXT PERSISTENCE TEST ===\n');

  let sessionData = {
    chatId: 'prod-smoke-user',
    messages: []
  };

  const multiTurnScript = [
    {
      turn: 1,
      input: 'min TI brp daftar?',
      check: (res, ans) => /500\.000|pendaftaran/i.test(ans) && /semantic-rag-(?:fee|registration)/.test(res.source),
      updateSession: (res) => {
        sessionData.lastProgramHint = 'Teknologi Informasi';
        sessionData.activeProgram = 'Teknologi Informasi';
        sessionData.lastFeeCategory = 'biaya_pendaftaran';
        sessionData.messages.push({ direction: 'user', message: 'min TI brp daftar?' });
        sessionData.messages.push({ direction: 'assistant', message: res.answer });
      }
    },
    {
      turn: 2,
      input: 'kalau biaya semesterannya?',
      check: (res, ans) => /6\.500\.000|semester/i.test(ans) && /semantic-rag-fee/.test(res.source),
      updateSession: (res) => {
        sessionData.lastFeeCategory = 'biaya_kuliah';
        sessionData.messages.push({ direction: 'user', message: 'kalau biaya semesterannya?' });
        sessionData.messages.push({ direction: 'assistant', message: res.answer });
      }
    },
    {
      turn: 3,
      input: 'bisa dicicil ga min?',
      check: (res, ans) => /cicil|angsur|tahap|bayar/i.test(ans) && /semantic-rag-fee/.test(res.source),
      updateSession: (res) => {
        sessionData.messages.push({ direction: 'user', message: 'bisa dicicil ga min?' });
        sessionData.messages.push({ direction: 'assistant', message: res.answer });
      }
    },
    {
      turn: 4,
      input: 'kalau SI?',
      check: (res, ans) => /Sistem Informasi/i.test(ans) && /cicil|angsur|biaya|tahap/i.test(ans),
      updateSession: (res) => {
        sessionData.lastProgramHint = 'Sistem Informasi';
        sessionData.activeProgram = 'Sistem Informasi';
      }
    }
  ];

  let multiTurnPass = true;
  for (const t of multiTurnScript) {
    const res = await querySemanticRag(t.input, { sessionData });
    const cleanOutbound = sanitizeWhatsappText(res.answer || '');
    const pass = t.check(res, cleanOutbound);
    const hasMoji = hasMojibake(cleanOutbound);

    if (hasMoji) {
      mojibakeFailures.push({ input: t.input, output: cleanOutbound });
    }

    if (!pass || hasMoji) {
      multiTurnPass = false;
      console.log(`[FAIL] Multi-turn #${t.turn}: "${t.input}"`);
      console.log(`       Source: ${res.source}`);
      console.log(`       Answer: ${cleanOutbound.slice(0, 150)}...`);
    } else {
      console.log(`[PASS] Multi-turn #${t.turn}: "${t.input}" -> [${res.source}]`);
      t.updateSession(res);
    }
  }

  console.log('\n=== SMOKE TEST SUMMARY ===');
  console.log(`Individual Queries: ${smokeQueries.length - failures.length}/${smokeQueries.length} PASS`);
  console.log(`Multi-Turn Persistence: ${multiTurnPass ? 'PASS' : 'FAIL'}`);
  console.log(`Outbound Mojibake Detected: ${mojibakeFailures.length}`);

  if (failures.length === 0 && multiTurnPass && mojibakeFailures.length === 0) {
    console.log('\nOVERALL SMOKE: PASS');
    process.exit(0);
  } else {
    console.log('\nOVERALL SMOKE: FAIL');
    console.error('Failures:', JSON.stringify(failures, null, 2));
    process.exit(1);
  }
}

runPostDeploySmoke().catch(err => {
  console.error(err);
  process.exit(1);
});
