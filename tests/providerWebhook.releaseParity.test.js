const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = 'test';
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
    sendMessage: jest.fn(async (chatId, text, meta) => {
      sent.push({ chatId, text: String(text || ''), meta: meta || {} });
    }),
    sendImage: jest.fn(async () => {})
  };
  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));
  return { app, provider, sent };
}

const TEST_RUN_ID = 'rp-' + Date.now() + '-' + Math.floor(Math.random() * 100000) + '-';

async function ask(ctx, chatId, text) {
  const isolatedChatId = `${TEST_RUN_ID}${chatId}`;
  const before = ctx.sent.length;
  const res = await request(ctx.app)
    .post('/provider/webhook')
    .send({ chatId: isolatedChatId, text, ts: Date.now() })
    .expect(200);
  const newMessages = ctx.sent.slice(before).map((m) => m.text).join('\n');
  return { res, text: newMessages, allText: ctx.sent.map((m) => m.text).join('\n') };
}

function expectNoRawLeak(text) {
  expect(text).not.toMatch(/LOGO|LOG O|PROFILE\s+UNIT|CamScanner|Dipindai|OCR|^\s*[-•]\s*$/im);
}

function expectGroundedOrgCountAnswer(text) {
  expect(text).toMatch(/\b(32|tiga puluh dua)\b/i);
  expect(text).toMatch(/UKM|ORMAWA|Ormawa|organisasi mahasiswa|unit kegiatan mahasiswa/i);
  expect(text).not.toMatch(/Hi-?Think|Student Exchange|Double Degree|DNUI|HELP University|UKT|DPP|Gelombang/i);
  expectNoRawLeak(text);
}
describe('provider webhook release parity', () => {
  jest.setTimeout(240000);

  test('critical single-turn semantic/business routes produce safe outbound answers', async () => {
    const ctx = buildApp();
    const cases = [
      {
        id: 'pmb_current',
        q: 'PMB masih buka?',
        expect: (t) => expect(t).toMatch(/PMB|pendaftaran|gelombang/i)
      },
      {
        id: 'explicit_schedule',
        q: 'gelombang 1 masih buka tanggal 7 juli 2026?',
        expect: (t) => {
          expect(t).toMatch(/7\s+Juli\s+2026/i);
          expect(t).not.toMatch(/Per\s+19\s+Agustus\s+2026/i);
        }
      },
      {
        id: 'fee_ukt',
        q: 'UKT Sistem Informasi berapa?',
        expect: (t) => expect(t).toMatch(/6\.500\.000|6500000/i)
      },
      {
        id: 'program_list',
        q: 'jurusan apa saja?',
        expect: (t) => {
          expect(t).toMatch(/Sistem Informasi/i);
          expect(t).toMatch(/Teknologi Informasi/i);
        }
      },
      {
        id: 'academic_sks',
        q: 'berapa SKS untuk lulus S1?',
        expect: (t) => expect(t).toMatch(/144\s*SKS/i)
      },
      {
        id: 'ukm_count',
        q: 'berapa jumlah ormawa di stikom bali?',
        expect: (t) => {
          expect(t).toMatch(/32|tiga puluh dua/i);
          expect(t).not.toMatch(/Hi-?Think|Student Exchange/i);
        }
      },
      {
        id: 'ukm_profile',
        q: 'profil UKM Tabuh Bramara Gita gimana?',
        expect: (t) => {
          expect(t).toMatch(/Tabuh|Bramara|Gita|seni|latihan|tampil/i);
          expectNoRawLeak(t);
        }
      },
      {
        id: 'unsupported_ukm',
        q: 'apakah ada UKM diving penyelaman laut dalam di STIKOM Bali?',
        expect: (t) => {
          expect(t).toMatch(/belum|tidak.*tersedia|tidak.*menemukan|sumber/i);
          expect(t).not.toMatch(/Athena|BEM|Futsal|Tabuh|Tari/i);
        }
      },
      {
        id: 'comparison_relation',
        q: 'Double Degree DNUI itu Student Exchange bukan?',
        expect: (t) => {
          expect(t).toMatch(/Double Degree|DNUI/i);
          expect(t).toMatch(/Student Exchange|pertukaran/i);
          expect(t).toMatch(/bukan|berbeda|tidak sama|tidak menyamakan/i);
        }
      },
      {
        id: 'raw_leak_guard',
        q: 'profil UKM Tari gimana?',
        expect: (t) => expectNoRawLeak(t)
      }
    ];

    for (const c of cases) {
      const out = await ask(ctx, `release-${c.id}`, c.q);
      expect(out.res.body.ok).toBe(true);
      expect(out.text.trim()).toBeTruthy();
      c.expect(out.text);
    }
  });

  test('organization count contract generalizes through provider webhook wording and context changes', async () => {
    const ctx = buildApp();

    const exact = await ask(ctx, 'release-org-count-exact', 'Jumlah ormawa di ITB STIKOM Bali ada berapa?');
    expect(exact.res.body.ok).toBe(true);
    expectGroundedOrgCountAnswer(exact.text);

    const paraphrase = await ask(ctx, 'release-org-count-paraphrase', 'total organisasi mahasiswa di kampus ada berapa ya?');
    expect(paraphrase.res.body.ok).toBe(true);
    expectGroundedOrgCountAnswer(paraphrase.text);

    const reordered = await ask(ctx, 'release-org-count-reordered', 'di stikom bali ormawa totalnya berapa?');
    expect(reordered.res.body.ok).toBe(true);
    expectGroundedOrgCountAnswer(reordered.text);

    const slang = await ask(ctx, 'release-org-count-slang', 'ukm brp totalnya min?');
    expect(slang.res.body.ok).toBe(true);
    expectGroundedOrgCountAnswer(slang.text);

    const switchCtx = buildApp();
    const firstTopic = await ask(switchCtx, 'release-org-count-context-switch', 'Apa manfaat ikut Student Exchange?');
    expect(firstTopic.res.body.ok).toBe(true);
    expect(firstTopic.text).toMatch(/Student Exchange|pertukaran/i);

    const afterSwitch = await ask(switchCtx, 'release-org-count-context-switch', 'kalau ormawa totalnya berapa?');
    expect(afterSwitch.res.body.ok).toBe(true);
    expectGroundedOrgCountAnswer(afterSwitch.text);

    const unsupportedSpecific = await ask(ctx, 'release-org-count-negative', 'berapa jumlah UKM paralayang di STIKOM Bali?');
    expect(unsupportedSpecific.res.body.ok).toBe(true);
    expect(unsupportedSpecific.text).toMatch(/belum menemukan|belum bisa|konfirmasi/i);
    expect(unsupportedSpecific.text).not.toMatch(/\b(32|tiga puluh dua)\b.*(?:UKM|ORMAWA|Ormawa|organisasi mahasiswa)/i);
    expect(unsupportedSpecific.text).not.toMatch(/Student Exchange|Hi-?Think|Double Degree/i);

    const collision = await ask(ctx, 'release-org-count-collision', 'jumlah program Student Exchange ada berapa?');
    expect(collision.res.body.ok).toBe(true);
    expect(collision.text).not.toMatch(/\b(32|tiga puluh dua)\b.*(?:UKM|ORMAWA|Ormawa|organisasi mahasiswa)/i);
  }, 240000);
  test('multi-turn fee context keeps entity resolution through provider webhook', async () => {
    const ctx = buildApp();
    const first = await ask(ctx, 'release-multiturn-fee', 'berapa biaya SI?');
    expect(first.res.body.ok).toBe(true);
    expect(first.text).toMatch(/Sistem Informasi/i);

    const second = await ask(ctx, 'release-multiturn-fee', 'kalau TI?');
    expect(second.res.body.ok).toBe(true);
    expect(second.text).toMatch(/Teknologi Informasi/i);
    expect(second.text).not.toMatch(/Sistem Informasi.*Rp\.?\s*14\.000\.000/i);
  });

  test('real-user generalization contracts hold through provider webhook and session context', async () => {
    const ctx = buildApp();

    const levelComparison = await ask(ctx, 'release-real-user-level-comparison', 'Perbedaan antara program S1 dan D3 apa ya?');
    expect(levelComparison.res.body.ok).toBe(true);
    expect(levelComparison.text).toMatch(/S1|Sarjana/i);
    expect(levelComparison.text).toMatch(/D3|Diploma/i);
    expect(levelComparison.text).not.toMatch(/belum menemukan data yang sesuai|UKT|DPP/i);
    expectNoRawLeak(levelComparison.text);

    const recommendation = await ask(ctx, 'release-real-user-recommendation', 'Kalau S1 yang cocok untuk bekerja di bidang pemasaran yang mana ya?');
    expect(recommendation.res.body.ok).toBe(true);
    expect(recommendation.text).toMatch(/Bisnis Digital|pemasaran|marketing/i);
    expect(recommendation.text).not.toMatch(/Teknik Informatika.*pemasaran/i);
    expectNoRawLeak(recommendation.text);

    const unsupportedGoal = await ask(ctx, 'release-real-user-unsupported-goal', 'Kalau S1 cocok buat jadi astronot yang mana?');
    expect(unsupportedGoal.res.body.ok).toBe(true);
    expect(unsupportedGoal.text).toMatch(/belum|tidak.*menemukan|tidak.*cukup|sumber/i);
    expect(unsupportedGoal.text).not.toMatch(/paling cocok.*(?:Bisnis Digital|Sistem Informasi|Teknik Informatika)/i);

    const careerContext = buildApp();
    const priorS2 = await ask(careerContext, 'release-real-user-context-switch', 'S2 Sistem Informasi total SKS dan semesternya berapa?');
    expect(priorS2.res.body.ok).toBe(true);
    expect(priorS2.text).toMatch(/S2|Magister|SKS|semester/i);

    const careerSupport = await ask(careerContext, 'release-real-user-context-switch', 'Apakah ITB STIKOM Bali membantu lulusannya mendapatkan pekerjaan?');
    expect(careerSupport.res.body.ok).toBe(true);
    expect(careerSupport.text).toMatch(/Career Center|karier|karir|lowongan|magang|pekerjaan|dunia kerja/i);
    expect(careerSupport.text).not.toMatch(/Magister Komputer|M\.Kom/i);
    expectNoRawLeak(careerSupport.text);

    const doubleDegree = await ask(ctx, 'release-real-user-encoding', 'Double Degree itu gelarnya apa saja?');
    expect(doubleDegree.res.body.ok).toBe(true);
    expect(doubleDegree.text).toMatch(/Double Degree|gelar|degree/i);
    expect(doubleDegree.text).not.toMatch(/â€¢|Ã|Â|�/);
    expectNoRawLeak(doubleDegree.text);
  }, 240000);
});





