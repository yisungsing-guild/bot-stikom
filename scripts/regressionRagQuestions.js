/* eslint-disable no-console */

process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.OPENAI_SEMANTIC_RAG_TIMEOUT_MS = process.env.OPENAI_SEMANTIC_RAG_TIMEOUT_MS || '1500';

const { querySemanticRag } = require('../src/engine/semanticRagEngine');

const CASES = [
  { q: 'Apa keunggulan program prodi pasca?', mustInclude: ['Keunggulan', 'S2 Sistem Informasi'], productionLike: true },
  { q: 'keunggulan program pascasarjana apa?', mustInclude: ['Keunggulan', 'S2 Sistem Informasi'] },
  { q: 'Apa fokus penelitian prodi pasca?', mustInclude: ['Cyber Security', 'Data Science'], productionLike: true },
  { q: 'berapa lama masa studi S2?', mustInclude: ['4 semester', '56 SKS'] },
  { q: 'gelar pascasarjana apa?', mustInclude: ['Magister Komputer', 'M.Kom'] },
  { q: 'Apa visi program studi pascasarjana?', mustInclude: ['2030'] },
  { q: 'Lulusan pasca bisa bekerja sebagai apa?', mustInclude: ['System Analyst'] },
  { q: 'akrediasi pasca sarjana atau s2 apa?', mustInclude: ['Baik Sekali'], productionLike: true },
  { q: 'apa saja prodi yg ada di stikom?', mustInclude: ['Sistem Informasi', 'Bisnis Digital', 'Manajemen Informatika'], productionLike: true },
  { q: 'jurusan di stikom ada apa aja?', mustInclude: ['Sistem Informasi', 'Teknologi Informasi'] },
  { q: 'apa yang dipelajari di sistem informasi?', mustInclude: ['Sistem Informasi'] },
  { q: 'apa bedanya sistem informasi dan teknologi informasi?', mustInclude: ['Sistem Informasi', 'Teknologi Informasi'] },
  { q: 'apa itu bisnis digital?', mustInclude: ['Bisnis Digital'] },
  { q: 'apa bedanya bisnis digital dengan manajemen?', mustInclude: ['Bisnis Digital'] },
  { q: 'apakah bisnis digital belajar digital marketing?', mustInclude: ['Digital Marketing'] },
  { q: 'prodi Sistem Informasi termasuk fakultas apa?', mustInclude: ['Fakultas'] },
  { q: 'beasiswa apa saja yang tersedia?', mustInclude: ['Beasiswa'], productionLike: true },
  { q: 'beasiswa SKSS itu apa?', mustInclude: ['1K1S', 'belum ada di data training'], productionLike: true },
  { q: 'jalur RPL itu apa?', mustInclude: ['Rekognisi Pembelajaran Lampau'], productionLike: true },
  { q: 'program dual degree DNUI harus ke China?', mustInclude: ['DNUI'], productionLike: true },
  { q: 'program internasional apa saja?', mustInclude: ['Double Degree', 'Student Exchange'], productionLike: true },
  { q: 'student exchange itu apa?', mustInclude: ['pertukaran mahasiswa'], productionLike: true },
  { q: 'inbis itu apa?', mustInclude: ['Inkubator Bisnis'], productionLike: true },
  { q: 'career center itu apa?', mustInclude: ['Career Center'], productionLike: true },
  { q: 'Apa keuntungan menjadi mahasiswa ITB STIKOM Bali dari sisi karier?', mustInclude: ['Keuntungan', 'karier'], productionLike: true },
  { q: 'Apakah ITB STIKOM Bali membantu lulusannya mendapatkan pekerjaan?', mustInclude: ['membantu', 'Career Center'], productionLike: true },
  { q: 'Apakah ada program magang?', mustInclude: ['magang', 'Career Center'], productionLike: true },
  { q: 'Apakah perusahaan sering datang ke kampus untuk rekrutmen?', mustInclude: ['Perusahaan', 'rekrutmen'], productionLike: true },
  { q: 'Apakah ada Job Fair di ITB STIKOM Bali?', mustInclude: ['job fair', 'Career Center'], productionLike: true },
  { q: 'Kapan mahasiswa bisa mulai mengikuti program Career Center?', mustInclude: ['mahasiswa aktif', 'Career Center'], productionLike: true },
  { q: 'Apakah mahasiswa mendapat pelatihan sebelum melamar kerja?', mustInclude: ['pelatihan', 'melamar kerja'], productionLike: true },
  { q: 'Apakah kampus memiliki kerja sama dengan perusahaan?', mustInclude: ['kerja sama', 'industri'], productionLike: true },
  { q: 'Apakah alumni masih bisa mendapatkan informasi lowongan kerja?', mustInclude: ['Alumni', 'lowongan kerja'], productionLike: true },
  { q: 'Apa itu Tracer Study?', mustInclude: ['Tracer Study', 'alumni'], productionLike: true },
  { q: 'Apakah lulusan hanya bisa bekerja di bidang IT?', mustInclude: ['Tidak', 'bidang IT'], productionLike: true },
  { q: 'Mengapa memilih ITB STIKOM Bali?', mustInclude: ['teknologi', 'Career Center'], productionLike: true },
  { q: 'Apakah mahasiswa bisa berkonsultasi mengenai karier?', mustInclude: ['berkonsultasi', 'Career Center'], productionLike: true },
  { q: 'Bagaimana peluang kerja lulusan ITB STIKOM Bali?', mustInclude: ['Peluang kerja lulusan', 'Career Center'], productionLike: true },
  { q: 'LLC itu apa?', mustInclude: ['Language Learning Center'], productionLike: true },
  { q: 'kampus stikom ada berapa?', mustInclude: ['3'] },
  { q: 'akreditasi kampus ITB STIKOM Bali apa?', mustInclude: ['BAN-PT'], productionLike: true },
  { q: 'akreditasi sistem komputer apa?', mustInclude: ['Baik Sekali'] }
];

const MODES = [
  {
    name: 'no-provider',
    apiKey: '',
    cases: () => CASES,
    options: (testCase) => ({ topK: 8, mode: 'regression-no-provider', chatId: `regression:${testCase.q}` })
  },
  {
    name: 'production-like-provider',
    apiKey: '',
    fakeClient: true,
    cases: () => CASES.filter((testCase) => testCase.productionLike),
    options: (testCase) => ({ topK: 8, mode: 'regression-production-like', chatId: `regression-prod:${testCase.q}`, sessionData: {}, intentHint: '' })
  }
];

const noAnswerRe = /no-data|insufficient|disabled|out-of-domain|no-context|unanswerable/i;
const weakAnswerRe = /mohon maaf|tidak mempunyai jawaban|belum menemukan data yang cukup/i;

function evaluate(testCase, result) {
  const answer = String(result && result.answer ? result.answer : '').replace(/\s+/g, ' ').trim();
  const source = String(result && result.source ? result.source : '');
  const missing = (testCase.mustInclude || []).filter((needle) => !answer.toLowerCase().includes(String(needle).toLowerCase()));
  const bad = !answer || noAnswerRe.test(source) || weakAnswerRe.test(answer) || missing.length > 0;
  return { answer, source, missing, bad };
}

async function main() {
  let failed = 0;
  let total = 0;
  for (const mode of MODES) {
    process.env.OPENAI_API_KEY = mode.apiKey;
    process.env.SEMANTIC_RAG_FAKE_CLIENT_FOR_REGRESSION = mode.fakeClient ? 'true' : 'false';
    console.log(`MODE ${mode.name}`);
    for (const testCase of mode.cases()) {
      total += 1;
      const result = await querySemanticRag(testCase.q, mode.options(testCase));
      const evaluated = evaluate(testCase, result);
      if (evaluated.bad) failed += 1;
      console.log(`${evaluated.bad ? 'FAIL' : 'PASS'} | ${mode.name} | ${evaluated.source} | ${testCase.q}`);
      if (evaluated.bad) {
        console.log(`  missing=${JSON.stringify(evaluated.missing)} answer=${evaluated.answer.slice(0, 260)}`);
      }
    }
  }
  console.log(JSON.stringify({ ok: failed === 0, total, failed, modes: MODES.map((mode) => mode.name) }, null, 2));
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});