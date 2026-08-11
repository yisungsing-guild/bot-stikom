/* eslint-disable no-console */

const { querySemanticRag } = require('../src/engine/semanticRagEngine');

delete process.env.OPENAI_API_KEY;
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';

const CASES = [
  { q: 'Apa keunggulan program prodi pasca?', mustInclude: ['Keunggulan', 'S2 Sistem Informasi'] },
  { q: 'keunggulan program pascasarjana apa?', mustInclude: ['Keunggulan', 'S2 Sistem Informasi'] },
  { q: 'Apa fokus penelitian prodi pasca?', mustInclude: ['Cyber Security', 'Data Science'] },
  { q: 'berapa lama masa studi S2?', mustInclude: ['4 semester', '56 SKS'] },
  { q: 'gelar pascasarjana apa?', mustInclude: ['Magister Komputer', 'M.Kom'] },
  { q: 'Apa visi program studi pascasarjana?', mustInclude: ['2030'] },
  { q: 'Lulusan pasca bisa bekerja sebagai apa?', mustInclude: ['System Analyst'] },
  { q: 'akrediasi pasca sarjana atau s2 apa?', mustInclude: ['Baik Sekali'] },
  { q: 'apa saja prodi yg ada di stikom?', mustInclude: ['Sistem Informasi', 'Bisnis Digital', 'Manajemen Informatika'] },
  { q: 'jurusan di stikom ada apa aja?', mustInclude: ['Sistem Informasi', 'Teknologi Informasi'] },
  { q: 'apa yang dipelajari di sistem informasi?', mustInclude: ['Sistem Informasi'] },
  { q: 'apa bedanya sistem informasi dan teknologi informasi?', mustInclude: ['Sistem Informasi', 'Teknologi Informasi'] },
  { q: 'apa itu bisnis digital?', mustInclude: ['Bisnis Digital'] },
  { q: 'apa bedanya bisnis digital dengan manajemen?', mustInclude: ['Bisnis Digital'] },
  { q: 'apakah bisnis digital belajar digital marketing?', mustInclude: ['Digital Marketing'] },
  { q: 'prodi Sistem Informasi termasuk fakultas apa?', mustInclude: ['Fakultas'] },
  { q: 'beasiswa apa saja yang tersedia?', mustInclude: ['Beasiswa'] },
  { q: 'beasiswa SKSS itu apa?', mustInclude: ['1K1S', 'belum ada di data training'] },
  { q: 'jalur RPL itu apa?', mustInclude: ['Rekognisi Pembelajaran Lampau'] },
  { q: 'program dual degree DNUI harus ke China?', mustInclude: ['DNUI'] },
  { q: 'program internasional apa saja?', mustInclude: ['Double Degree', 'Student Exchange'] },
  { q: 'student exchange itu apa?', mustInclude: ['pertukaran mahasiswa'] },
  { q: 'inbis itu apa?', mustInclude: ['Inkubator Bisnis'] },
  { q: 'career center itu apa?', mustInclude: ['Career Center'] },
  { q: 'LLC itu apa?', mustInclude: ['Language Learning Center'] },
  { q: 'kampus stikom ada berapa?', mustInclude: ['3'] },
  { q: 'akreditasi kampus ITB STIKOM Bali apa?', mustInclude: ['BAN-PT'] },
  { q: 'akreditasi sistem komputer apa?', mustInclude: ['Baik Sekali'] }
];

const noAnswerRe = /no-data|insufficient|disabled|out-of-domain|no-context|unanswerable/i;
const weakAnswerRe = /mohon maaf|tidak mempunyai jawaban|belum menemukan data yang cukup/i;

async function main() {
  let failed = 0;
  for (const testCase of CASES) {
    const result = await querySemanticRag(testCase.q);
    const answer = String(result && result.answer ? result.answer : '').replace(/\s+/g, ' ').trim();
    const source = String(result && result.source ? result.source : '');
    const missing = (testCase.mustInclude || []).filter((needle) => !answer.toLowerCase().includes(String(needle).toLowerCase()));
    const bad = !answer || noAnswerRe.test(source) || weakAnswerRe.test(answer) || missing.length > 0;
    if (bad) failed += 1;
    console.log(`${bad ? 'FAIL' : 'PASS'} | ${source} | ${testCase.q}`);
    if (bad) {
      console.log(`  missing=${JSON.stringify(missing)} answer=${answer.slice(0, 260)}`);
    }
  }
  console.log(JSON.stringify({ ok: failed === 0, total: CASES.length, failed }, null, 2));
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
