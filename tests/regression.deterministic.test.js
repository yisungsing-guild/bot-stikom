const fs = require('fs');
const path = require('path');
const { createOutbound } = require('../src/routes/outbound');
const { createFeeResponder } = require('../src/routes/feeResponder');
const { buildWelcomeMessageWithIntro, shouldSkipWelcome } = require('../src/routes/welcomeFlow');

jest.setTimeout(30000);

describe('Regression tests: deterministic / welcome / fee / numbered menu', () => {
  test('deterministic bypass calls sendRaw with responseMode metadata', async () => {
    const sent = [];
    const sendRaw = jest.fn((chatId, text, meta) => {
      sent.push({ chatId, text, meta });
      return Promise.resolve({ ok: true });
    });

    // Minimal mocks required by createOutbound (composer pipeline will be created but we keep simple mocks)
    const outbound = createOutbound({
      chatId: 'test1',
      getText: () => 'Hello',
      getSessionData: () => ({}),
      getSession: () => ({ state: 'root' }),
      setSessionData: () => {},
      composeResponse: async () => ({ finalText: 'ok', segments: {} }),
      humanizeFinalAnswer: (t) => t,
      logger: console,
      prisma: { session: { upsert: async () => ({}) } , session: { upsert: async () => ({}) } },
      sendRaw,
      detectIntent: () => 'GENERAL',
      intentConfidence: () => 0,
      mapRagContextsForComposer: () => [],
      getNormalizedObj: () => null,
      getComposerTone: () => ({}),
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    await outbound.reply({ messageText: 'Deterministic text', responseMode: 'deterministic', source: 'regression_test' });

    expect(sendRaw).toHaveBeenCalled();
    const call = sent[0];
    expect(call.meta).toBeDefined();
    expect(call.meta.responseMode).toBe('deterministic');
    expect(call.meta.sentViaComposer).toBe(false);
  });

  test('welcome literal detection preserves WELCOME_MENU token', () => {
    const variants = [
      'Some header\nWELCOME_MENU\nFooter',
      'WELCOME_MENU',
      '\nWELCOME_MENU\n',
      'prefix\nWELCOME_MENU'
    ];
    const re = /(^|\n)WELCOME_MENU(\n|$)/;
    for (const v of variants) {
      expect(re.test(String(v || ''))).toBe(true);
    }
  });

  test('fee fast-path builds deterministic partial response with bullets', () => {
    const fee = createFeeResponder({
      extractSpecificProgramHint: () => null,
      extractProgramHint: () => 'S1 TI',
      extractDualDegreeHint: () => null,
      parseGelombang: () => '1',
      looksLikeAdmissionRequirementsQuestion: () => false,
      looksLikeMustPayTotalQuestion: () => false,
      buildDeterministicMustPayTotalAnswerFromBundledIndex: () => null,
      logger: console
    });

    const extracted = {
      program: 'S1 TI',
      gelombang: '1',
      pendaftaran: { value: 500000, found: true },
      dpp: { value: 1000000, found: true },
      ukt: { value: null, found: false },
      potongan: { value: null, found: false }
    };

    const out = fee.buildUnifiedResponse(extracted, null, 'partial');
    expect(typeof out).toBe('string');
    expect(out).toMatch(/Biaya Pendaftaran/i);
    expect(out).toMatch(/- /); // bullets
  });

  test('fee responder deterministic full answer preserves exact structured text without generic lead', () => {
    const fee = createFeeResponder({
      extractSpecificProgramHint: () => null,
      extractProgramHint: () => null,
      extractDualDegreeHint: () => null,
      parseGelombang: () => null,
      looksLikeAdmissionRequirementsQuestion: () => false,
      looksLikeMustPayTotalQuestion: () => false,
      buildDeterministicMustPayTotalAnswerFromBundledIndex: () => 'Prodi Sistem Informasi Gelombang I\nTotal awal masuk setelah potongan: Rp 14.300.000.',
      logger: console
    });

    const out = fee.buildUnifiedResponse({ program: 'S1 TI', gelombang: '1' }, 'RAG fallback answer', 'full');
    expect(out).toBe('Prodi Sistem Informasi Gelombang I\nTotal awal masuk setelah potongan: Rp 14.300.000.');
  });

  test('numbered menu parser (extracted from provider) recognizes multi-line numeric menus', () => {
    // Load provider.js and extract looksLikeNumericWelcomeMenu function text using brace matching
    const providerPath = path.join(__dirname, '..', 'src', 'routes', 'provider.js');
    const src = fs.readFileSync(providerPath, 'utf8');
    const start = src.indexOf('function looksLikeNumericWelcomeMenu(');
    expect(start).toBeGreaterThanOrEqual(0);
    // Find matching closing brace by counting braces
    let depth = 0;
    let endIndex = -1;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { endIndex = i; break; }
      }
    }
    expect(endIndex).toBeGreaterThan(start);
    const funcText = src.slice(start, endIndex + 1);

    // eslint-disable-next-line no-eval
    const extractedFn = eval('(' + funcText + ')');

    const menu = `\n1. Pendaftaran\n2. DPP\n3. UKT\n4. Gelombang\n5. Beasiswa\n6. Kontak\n7. Lokasi\n`;
    const notMenu = 'Saya mau tanya tentang biaya pendaftaran untuk S1 TI';

    expect(extractedFn(menu)).toBe(true);
    expect(extractedFn(notMenu)).toBe(false);
  });
});
