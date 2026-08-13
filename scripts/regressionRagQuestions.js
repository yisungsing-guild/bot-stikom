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
  { q: 'keunggulannya apa?', mustInclude: ['Keunggulan', 'S2 Sistem Informasi'], productionLike: true, sessionData: { messages: [{ direction: 'user', message: 'Apa itu program pascasarjana atau S2 di ITB STIKOM Bali?' }, { direction: 'bot', message: 'ITB STIKOM Bali memiliki Prodi S2 Sistem Informasi.' }] } },
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
  { q: 'harus ke sana?', mustInclude: ['DNUI'], productionLike: true, sessionData: { messages: [{ direction: 'user', message: 'Program Dual Degree DNUI itu apa?' }, { direction: 'bot', message: 'Program Dual Degree DNUI adalah program internasional dengan Dalian Neusoft University of Information di China.' }] } },
  { q: 'rincian biayanya?', mustInclude: ['Double Degree'], productionLike: true, sessionData: { messages: [{ direction: 'user', message: 'Saya mau tanya program Dual Degree DNUI' }, { direction: 'bot', message: 'Program Dual Degree DNUI adalah kerja sama internasional ITB STIKOM Bali.' }] } },
  { q: 'program internasional apa saja?', mustInclude: ['Double Degree', 'Student Exchange'], productionLike: true },
  { q: 'student exchange itu apa?', mustInclude: ['pertukaran mahasiswa'], productionLike: true },
  { q: 'inbis itu apa?', mustInclude: ['Inkubator Bisnis'], productionLike: true },
  { q: 'career center itu apa?', mustInclude: ['Career Center'], productionLike: true },
  { q: 'Apa keuntungan menjadi mahasiswa ITB STIKOM Bali dari sisi karier?', mustInclude: ['Keuntungan', 'karier'], productionLike: true },
  { q: 'Apakah ITB STIKOM Bali membantu lulusannya mendapatkan pekerjaan?', mustInclude: ['membantu', 'Career Center'], productionLike: true },
  { q: 'Apakah ada program magang?', mustInclude: ['magang', 'Career Center'], productionLike: true },
  { q: 'kapan bisa mulai ikut?', mustInclude: ['mahasiswa aktif', 'Career Center'], productionLike: true, sessionData: { messages: [{ direction: 'user', message: 'Apa itu Career Center ITB STIKOM Bali?' }, { direction: 'bot', message: 'Career Center ITB STIKOM Bali membantu mahasiswa dan alumni terkait karier, magang, job fair, dan campus hiring.' }] } },
  { q: 'Apakah perusahaan sering datang ke kampus untuk rekrutmen?', mustInclude: ['Perusahaan', 'rekrutmen'], productionLike: true },
  { q: 'Apakah ada Job Fair di ITB STIKOM Bali?', mustInclude: ['job fair', 'Career Center'], productionLike: true },
  { q: 'Kapan mahasiswa bisa mulai mengikuti program Career Center?', mustInclude: ['mahasiswa aktif', 'Career Center'], productionLike: true },
  { q: 'Apakah mahasiswa mendapat pelatihan sebelum melamar kerja?', mustInclude: ['pelatihan', 'melamar kerja'], productionLike: true },
  { q: 'Apakah kampus memiliki kerja sama dengan perusahaan?', mustInclude: ['kerja sama', 'industri'], productionLike: true },
  { q: 'Apakah alumni masih bisa mendapatkan informasi lowongan kerja?', mustInclude: ['Alumni', 'lowongan kerja'], productionLike: true },
  { q: 'Apa itu Tracer Study?', mustInclude: ['Tracer Study', 'alumni'], productionLike: true },
  { q: 'Apakah lulusan hanya bisa bekerja di bidang IT?', mustInclude: ['Tidak', 'bidang IT'], productionLike: true },
  { q: 'Mengapa memilih ITB STIKOM Bali?', mustInclude: ['teknologi', 'Career Center'], productionLike: true },
  { q: 'kenapa harus milih stikom bali?', mustInclude: ['teknologi', 'Career Center'], productionLike: true },
  { q: 'Apakah mahasiswa bisa berkonsultasi mengenai karier?', mustInclude: ['berkonsultasi', 'Career Center'], productionLike: true },
  { q: 'Bagaimana peluang kerja lulusan ITB STIKOM Bali?', mustInclude: ['Peluang kerja lulusan', 'Career Center'], productionLike: true },
  { q: 'Bagaimana cara mengurus Izin Belajar dan Visa Study?', mustInclude: ['Izin Belajar', 'kampus'], productionLike: true },
  { q: 'Dokumen apa saja untuk mahasiswa asing?', mustInclude: ['paspor', 'mahasiswa asing'], productionLike: true },
  { q: 'dokumennya apa aj?', mustInclude: ['paspor', 'mahasiswa asing'], productionLike: true, sessionData: { messages: [{ direction: 'user', message: 'Bagaimana cara mengurus Izin Belajar dan Visa Study untuk mahasiswa asing?' }, { direction: 'bot', message: 'Pengurusan Izin Belajar dan Visa Study untuk mahasiswa asing dibantu sesuai ketentuan kampus.' }] } },
  { q: 'dokumen mhs asing apa aj?', mustInclude: ['paspor', 'mahasiswa asing'], productionLike: true },
  { q: 'Apakah Financial Statement diperlukan untuk Izin Belajar?', mustInclude: ['Financial Statement', 'Izin Belajar'], productionLike: true },
  { q: 'Apakah proses Izin Belajar membutuhkan waktu 1-2 minggu?', mustInclude: ['1-2 minggu', 'Izin Belajar'], productionLike: true },
  { q: 'Apa saja syarat perpanjangan Izin Belajar?', mustInclude: ['paspor', 'SKTT'], productionLike: true },
  { q: 'Jenis visa apa yang saya butuhkan untuk kuliah di Indonesia?', mustInclude: ['Visa E30B', 'studi'], productionLike: true },
  { q: 'Apa itu ITAS/KITAS?', mustInclude: ['izin tinggal', 'Visa'], productionLike: true },
  { q: 'Apa saja dokumen yang diperlukan untuk perpanjangan ITAS?', mustInclude: ['Izin Belajar', 'SKTT'], productionLike: true },
  { q: 'Apakah ada denda jika ITAS expired?', mustInclude: ['overstay', 'denda'], productionLike: true },
  { q: 'Dokumen apa saja yang dibutuhkan untuk SKTT?', mustInclude: ['paspor', 'Form F1-01'], productionLike: true },
  { q: 'Apa itu Hi-Think?', mustInclude: ['Hi-Think', 'Jepang'], productionLike: true },
  { q: 'hi-think gmn kak?', mustInclude: ['Hi-Think', 'Jepang'], productionLike: true },
  { q: 'Bagaimana program Hi-Think membantu karier mahasiswa?', mustInclude: ['Hi-Think', 'peluang kerja'], productionLike: true },
  { q: 'Kapan saya bisa mengikuti program Hi-Think?', mustInclude: ['Hi-Think', 'Semester 5'], productionLike: true },
  { q: 'kapan bisa ikut?', mustInclude: ['Hi-Think', 'Semester 5'], productionLike: true, sessionData: { messages: [{ direction: 'user', message: 'Apa itu Hi-Think?' }, { direction: 'bot', message: 'Hi-Think adalah program Jepang yang dapat mendukung peluang kerja mahasiswa.' }] } },
  { q: 'Apakah program Hi-Think sulit?', mustInclude: ['Hi-Think', 'menantang'], productionLike: true },
  { q: 'Apakah harus memiliki kemampuan bahasa Jepang minimal N2?', mustInclude: ['N2', 'Jepang'], productionLike: true },
  { q: 'Berapa gelar yang diperoleh dari Program Double Degree HELP University?', mustInclude: ['S.Kom', 'Bachelor of Information Technology'], productionLike: true },
  { q: 'Apakah mahasiswa harus pergi ke China pada tahun keempat?', mustInclude: ['tahun keempat', 'DNUI'], productionLike: true },
  { q: 'Apakah mahasiswa mendapatkan dormitory selama kuliah di China?', mustInclude: ['dormitory', 'shared room'], productionLike: true },
  { q: 'Apakah mahasiswa mendapatkan gelar Bachelor of Management?', mustInclude: ['Bachelor of Management', 'S.Bns'], productionLike: true },
  { q: 'Apa saja jenis program Student Exchange yang tersedia?', mustInclude: ['Exchange Reguler', 'GCCP'], productionLike: true },
  { q: 'Ke negara mana saja Student Exchange tersedia?', mustInclude: ['China', 'Thailand'], productionLike: true },
  { q: 'Apa saja syarat mengikuti Student Exchange?', mustInclude: ['mahasiswa aktif', 'IPK'], productionLike: true },
  { q: 'Bagaimana cara mendapatkan informasi Student Exchange?', mustInclude: ['Direktorat Urusan Internasional', 'media sosial'], productionLike: true },
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
    options: (testCase) => ({ topK: 8, mode: 'regression-no-provider', chatId: `regression:${testCase.q}`, sessionData: testCase.sessionData || {} })
  },
  {
    name: 'production-like-provider',
    apiKey: '',
    fakeClient: true,
    cases: () => CASES.filter((testCase) => testCase.productionLike),
    options: (testCase) => ({ topK: 8, mode: 'regression-production-like', chatId: `regression-prod:${testCase.q}`, sessionData: testCase.sessionData || {}, intentHint: '' })
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
