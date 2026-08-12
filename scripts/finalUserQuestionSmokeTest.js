/* eslint-disable no-console */

process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.OPENAI_API_KEY = '';

const fs = require('fs');
const path = require('path');
const { querySemanticRag } = require('../src/engine/semanticRagEngine');

const cases = [
  { id: 'program_list_1', q: 'Tentang jurusan apa saja yang ada di STIKOM Bali' },
  { id: 'dual_degree_definition', q: 'Seperti apa itu program Dual Degree?' },
  { id: 'si_vs_sk', q: 'Apa perbedaan mendasar dari program studi Sistem Informasi dengan Sistem Komputer?' },
  { id: 'tiktok_recommendation', q: 'Jurusan apa yang cocok buat anak saya jika anak saya suka sosial media dan sering live di tiktok?' },
  { id: 'program_details_all', q: 'Berikan detail tentang masing-masing prodi' },
  { id: 'scholarship_available', q: 'apakah tersedia beasiswa?' },
  { id: 'foreign_student_permit', q: 'Bagaimana cara mengurus Izin Belajar dan Visa Study?' },
  { id: 'student_orgs', q: 'Apakah tersedia organisasi mahasiswa yang bisa mendukung minat mahasiswa di luar dari pembelajaran formal?' },
  { id: 'institution_accreditation', q: 'Apakah akreditasi dari kampus ITB STIKOM Bali?' },
  { id: 'dual_degree_discount', q: 'kalau biaya untuk double degree apakah ada potongan biaya' },
  { id: 'feedback_short_initial_1', q: 'perlu koreksi terhadap informasi awal, supaya kesan nya singkat dan informatif' },
  { id: 'si_even_semester_start', q: 'Saya Prodi Sistem Informasi, kapan saya mulai kuliah semester genap tahun akademik 2025/2026?' },
  { id: 'banpt_accreditation', q: 'Apakah ITB STIKOM Bali sudah terakreditasi oleh BAN-PT? Apa peringkat akreditasinya?' },
  { id: 'rpl_info_1', q: 'Aku pengen tau informasi tentang kuliah tapi jalur RPL' },
  { id: 'dnui_china', q: 'Program Dual Degree DNUI apa harus ke China?' },
  { id: 'international_programs', q: 'di STIKOM Bali ada program internasional apa saja' },
  {
    id: 'dual_degree_fee_followup',
    q: 'Berapa rincian biayanya?',
    sessionData: {
      messages: [
        { direction: 'user', message: 'Seperti apa itu program Dual Degree?' },
        { direction: 'bot', message: 'ITB STIKOM Bali memiliki program Dual Degree dengan mitra UTB, DNUI, dan HELP University.' }
      ]
    }
  },
  { id: 'programs_and_accreditation', q: 'dikampus ada program apa aja, dan akreditasinya gimana?' },
  {
    id: 'program_learning_followup',
    q: 'belajar di jurusannya gimana kak? apa aja yang dipelajarin?',
    sessionData: {
      messages: [
        { direction: 'user', message: 'apa saja prodi yg ada di stikom?' },
        { direction: 'bot', message: 'Program studi ITB STIKOM Bali: Sistem Informasi, Teknologi Informasi, Bisnis Digital, Sistem Komputer, D3 Manajemen Informatika, dan S2 Sistem Informasi.' }
      ],
      lastRetrievedPrograms: ['Sistem Informasi']
    }
  },
  { id: 'program_learning_list', q: 'jurusan di stikom ada apa aj kak? yang dipelajarin apa saja?' },
  { id: 'scholarship_natural', q: 'program beasiswanya gimana kak?' },
  { id: 'skss_scholarship', q: 'Pertanyaan terkait beasiswa SKSS' },
  { id: 'rpl_info_2', q: 'Aku pengen tau informasi tentang kuliah tapi jalur RPL' },
  { id: 'banpt_accreditation_2', q: 'Apakah ITB STIKOM Bali sudah terakreditasi oleh BAN-PT? Apa peringkat akreditasinya?' },
  { id: 'greeting', q: 'Halo kak, saya ingin bertanya' },
  { id: 'program_list_2', q: 'apa saja prodi yg ada di stikom?' },
  { id: 'd3_mi_requirement', q: 'apa saja syarat untuk mendaftar di program studi d3 manajemen informatika?' },
  { id: 'smk_computer_recommendation', q: 'Saya berasal dari SMK bidang komputer, prodi apa yang paling cocok untuk saya?' },
  { id: 'campus_count', q: 'Ada berapa jumlah kampus ITB STIKOM Bali?' },
  { id: 'bd_sks_total', q: 'Berapa total SKS yang harus saya tempuh untuk bisa lulus di Program Studi S1-Bisnis Digital?' },
  {
    id: 'bd_comparison_followup',
    q: 'Apa perbedaan Bisnis Digital dengan prodi serupa?',
    sessionData: {
      messages: [
        { direction: 'user', message: 'Apa itu Program Studi Bisnis Digital?' },
        { direction: 'bot', message: 'Bisnis Digital memadukan bisnis, teknologi, dan pemasaran digital.' }
      ]
    }
  },
  { id: 'weak_it_concern', q: 'Saya ingin menjadi mahasiswa di ITB STIKOM Bali, tapi saya kurang cakap di bidang Teknologi Informasi, apa yang harus saya lakukan?' },
  { id: 'bd_definition', q: 'Apa itu Program Studi Bisnis Digital?' },
  { id: 'bd_coding', q: 'Apakah Bisnis Digital harus jago komputer atau coding?' },
  { id: 'bd_vs_management', q: 'Apa bedanya Bisnis Digital dengan Manajemen?' },
  { id: 'bd_digital_marketing', q: 'Apakah mahasiswa Bisnis Digital belajar digital marketing?' },
  { id: 'bd_ai', q: 'Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence (AI)?' },
  { id: 'ta_min_pages_si', q: 'berapa halaman minimal dibuat untuk tugas akhir di prodi SI atau fakultas infokom' },
  { id: 'seo_learning', q: 'Apakah mahasiswa belajar SEO?' },
  { id: 'si_faculty', q: 'Prodi SISTEM INFORMASI termasuk ke dalam fakultas apa?' },
  { id: 's1_sks_total', q: 'Berapa sks yang harus ditempuh untuk dapat lulus program S1?' },
  { id: 'si_vs_ti', q: 'Apa perbedaan program studi sistem informasi dan program studi teknologi informasi?' }
];

const weakAnswerRe = /mohon maaf|tidak mempunyai jawaban|belum menemukan data yang cukup|belum menemukan rincian|tidak cukup aman/i;
const badSourceRe = /disabled|no-data|insufficient|out-of-domain|meaning-mismatch|clarify-suppressed/i;

function compact(value, max = 900) {
  const text = String(value || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

async function main() {
  const results = [];
  for (const item of cases) {
    const result = await querySemanticRag(item.q, {
      topK: 8,
      mode: 'final-user-question-smoke',
      chatId: `final-smoke:${item.id}`,
      sessionData: item.sessionData || {},
      intentHint: item.intentHint || ''
    });
    const answer = String(result && result.answer ? result.answer : '').trim();
    const weak = !answer || weakAnswerRe.test(answer) || badSourceRe.test(String(result && result.source || ''));
    results.push({ id: item.id, question: item.q, source: result && result.source || null, weak, answer });
    console.log(`${weak ? 'WEAK' : 'PASS'} | ${result && result.source || 'no-source'} | ${item.q}`);
    if (weak) console.log(`  answer=${compact(answer, 240)}`);
  }

  const reportLines = ['# Final User Question Smoke Test', '', `Total: ${results.length}`, `Weak: ${results.filter((r) => r.weak).length}`, ''];
  for (const r of results) {
    reportLines.push(`## ${r.id}`, '', `Pertanyaan: ${r.question}`, '', `Source: ${r.source || '-'}`, '', 'Jawaban bot:', '', compact(r.answer, 1800), '');
  }
  const outDir = path.resolve(__dirname, '..', 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'final_user_question_smoke_test.md'), reportLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'final_user_question_smoke_test.json'), JSON.stringify(results, null, 2), 'utf8');

  const weakCount = results.filter((r) => r.weak).length;
  console.log(JSON.stringify({ ok: weakCount === 0, total: results.length, weak: weakCount, report: path.join(outDir, 'final_user_question_smoke_test.md') }, null, 2));
  if (weakCount) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});