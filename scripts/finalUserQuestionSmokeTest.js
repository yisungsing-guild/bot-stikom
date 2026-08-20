/* eslint-disable no-console */
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.OPENAI_API_KEY = '';

const fs = require('fs');
const path = require('path');
const { querySemanticRag } = require('../src/engine/semanticRagEngine');

const HARD_TIMEOUT_MS = 120000;
const PERFORMANCE_BUDGET_MS = 15000;
const BAD_SOURCE_RE = /disabled|out-of-domain|clarify-suppressed/i;
const NO_DATA_RE = /belum menemukan|tidak menemukan|tidak cukup|agar tidak keliru|konfirmasi ke/i;
const RAW_LEAK_RE = /\[Sheet:|OCR berhasil mengekstrak teks|Ringkasan dokumen:|source\s*:|chunk\s*:|embedding|metadata|debug|didedikasikan\s*-\s*Selain|-\s*Career Center[\s\S]{0,140}-\s*Selain memperoleh/i;

function c(id, query, expected) { return { id, query, ...expected }; }
function rx(value) { return value instanceof RegExp ? value : new RegExp(String(value), 'i'); }
function arr(value) { return Array.isArray(value) ? value : (value ? [value] : []); }
function norm(value) { return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(); }
function compact(value, max = 900) { const text = String(value || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); return text.length > max ? text.slice(0, max - 3).trim() + '...' : text; }
function hit(pattern, text) { return pattern instanceof RegExp ? pattern.test(text) : norm(text).includes(norm(pattern)); }
function misses(patterns, text) { return arr(patterns).filter((p) => !hit(p, text)); }
function hits(patterns, text) { return arr(patterns).filter((p) => hit(p, text)); }
function label(pattern) { return pattern instanceof RegExp ? pattern.toString() : String(pattern); }

const cases = [
  c('greeting_open_question', 'Halo kak, saya ingin bertanya', { domain: 'GREETING', intent: 'greeting', entity: [], source: /semantic-rag-small-talk/i, requiredTopics: [/silakan|boleh|tanyakan/i] }),
  c('small_talk_wellbeing', 'Apa kabar?', { domain: 'SMALL_TALK', intent: 'wellbeing', source: /semantic-rag-small-talk/i, requiredTopics: [/baik|bantu/i], forbiddenTopics: [/biaya|gelombang|DPP/i] }),

  c('pmb_still_open', 'Selamat malam saya ingin menanyakan terkait penerimaan mahasiswa baru apakah masih dibuka?', { domain: 'PMB', intent: 'pmb_open_status', source: /semantic-rag-schedule-window/i, requiredTopics: [/PMB|penerimaan|pendaftaran/i, /buka|dibuka/i], requiredFacts: [/Gelombang|siap\.stikom-bali\.ac\.id/i] }),
  c('registration_how', 'Cara daftarnya bagaimana?', { domain: 'PENDAFTARAN', intent: 'registration_how', source: /semantic-rag-registration-info/i, requiredTopics: [/daftar|pendaftaran/i], requiredFacts: [/https:\/\/siap\.stikom-bali\.ac\.id/i, /online|offline|kampus/i] }),
  c('explicit_date_wave_one', 'gelombang 1 masih buka tanggal 7 juli 2026?', { domain: 'TANGGAL_GELOMBANG', intent: 'schedule_point_in_time', entity: ['Gelombang I'], source: /semantic-rag-schedule-window/i, requiredTopics: [/Gelombang I|gelombang 1/i, /7 Juli 2026|tanggal 7 juli/i], requiredFacts: [/sudah tidak buka|sudah berakhir|berakhir/i], forbiddenTopics: [/Per 19 Agustus 2026/i], dateContext: { explicitDate: '2026-07-07', mustMentionExplicitDate: true, mustNotUseToday: true } }),
  c('month_wave_august', 'jadi di bulan agustus itu ada gelombang berapa?', { domain: 'TANGGAL_GELOMBANG', intent: 'schedule_month_lookup', source: /semantic-rag-schedule-window/i, requiredTopics: [/Agustus 2026|bulan Agustus/i, /Gelombang IV/i], forbiddenFacts: [/Rp\.?\s*\d/i] }),

  c('registration_fee_si', 'berapa biaya pendaftaran SI?', { domain: 'BIAYA', intent: 'registration_fee', entity: ['Sistem Informasi'], source: /semantic-rag-registration-fee/i, requiredTopics: [/biaya pendaftaran/i, /Sistem Informasi|SI/i], requiredFacts: [/Rp\.?\s*500\.000/i], forbiddenTopics: [/UKT.*Rp\.?\s*6\.500\.000/i] }),
  c('fee_detail_si_ukt', 'UKT sistem informasi', { domain: 'BIAYA', intent: 'fee_detail', entity: ['Sistem Informasi'], source: /semantic-rag-fee-detail/i, requiredTopics: [/UKT|biaya pendidikan per semester/i, /Sistem Informasi/i], requiredFacts: [/Rp\.?\s*6\.500\.000/i] }),

  c('program_list', 'apa saja prodi yg ada di stikom?', { domain: 'PROGRAM_STUDI', intent: 'program_list', source: /semantic-rag-program-list/i, requiredFacts: [/Sistem Informasi/i, /Teknologi Informasi/i, /Bisnis Digital/i, /Sistem Komputer/i, /Manajemen Informatika/i] }),
  c('program_comparison_si_ti', 'Apa perbedaan program studi sistem informasi dan program studi teknologi informasi?', { domain: 'PROGRAM_COMPARISON', intent: 'program_comparison', entity: ['Sistem Informasi', 'Teknologi Informasi'], source: /semantic-rag-program-comparison/i, requiredTopics: [/perbedaan|berbeda|dibandingkan/i], requiredFacts: [/Sistem Informasi/i, /Teknologi Informasi/i, /software|aplikasi|infrastruktur|keamanan/i, /bisnis|organisasi|sistem informasi/i] }),
  c('program_comparison_bd_management', 'Apa bedanya Bisnis Digital dengan Manajemen?', { domain: 'PROGRAM_COMPARISON', intent: 'program_comparison', entity: ['Bisnis Digital', 'Manajemen'], source: /semantic-rag-program-comparison/i, requiredTopics: [/Bisnis Digital/i, /Manajemen/i, /digital marketing|e-commerce|produk digital/i], forbiddenTopics: [/Sistem Komputer|embedded|IoT/i] }),
  c('weak_it_concern', 'Saya ingin menjadi mahasiswa di ITB STIKOM Bali, tapi saya kurang cakap di bidang Teknologi Informasi, apa yang harus saya lakukan?', { domain: 'CAREER_ADVICE', intent: 'program_advice', entity: ['Teknologi Informasi'], source: /semantic-rag-/i, requiredTopics: [/kurang cakap|belum jago|tidak harus|mulai dari dasar|belajar bertahap|pengembangan kemampuan|arahan/i], forbiddenTopics: [/technopreneurship|seminar industri|networking dengan perusahaan/i], forbiddenFacts: [/Kurikulum juga dirancang agar relevan dengan kebutuhan dunia industri\.\s*3\.?/i] }),
  c('bd_ai_full', 'Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence (AI)?', { domain: 'PROGRAM_STUDI', intent: 'curriculum', entity: ['Bisnis Digital'], source: /semantic-rag-program-curriculum/i, requiredTopics: [/Bisnis Digital/i, /AI|Artificial Intelligence|data analytics|teknologi/i], forbiddenTopics: [/belum menemukan data yang sesuai/i] }),
  c('bd_ai_abbrev', 'apakah mahasiswa BD belajar AI?', { domain: 'PROGRAM_STUDI', intent: 'curriculum', entity: ['Bisnis Digital'], source: /semantic-rag-program-curriculum/i, requiredTopics: [/Bisnis Digital|BD/i, /AI|Artificial Intelligence|data analytics|teknologi/i], forbiddenTopics: [/belum menemukan data yang sesuai/i] }),
  c('bd_ai_negative_wording', 'Bisnis Digital belajar AI tidak?', { domain: 'PROGRAM_STUDI', intent: 'curriculum', entity: ['Bisnis Digital'], source: /semantic-rag-program-curriculum/i, requiredTopics: [/Bisnis Digital/i, /AI|Artificial Intelligence|data analytics|teknologi/i], forbiddenTopics: [/belum menemukan data yang sesuai/i] }),
  c('bd_ai_short', 'di BD ada materi AI?', { domain: 'PROGRAM_STUDI', intent: 'curriculum', entity: ['Bisnis Digital'], source: /semantic-rag-program-curriculum/i, requiredTopics: [/Bisnis Digital|BD/i, /AI|Artificial Intelligence|data analytics|teknologi/i], forbiddenTopics: [/belum menemukan data yang sesuai/i] }),
  c('bd_digital_marketing', 'Apakah mahasiswa Bisnis Digital belajar digital marketing?', { domain: 'PROGRAM_STUDI', intent: 'curriculum', entity: ['Bisnis Digital'], source: /semantic-rag-program-curriculum/i, requiredFacts: [/digital marketing/i, /Bisnis Digital/i] }),

  c('institution_accreditation', 'Apakah ITB STIKOM Bali sudah terakreditasi oleh BAN-PT? Apa peringkat akreditasinya?', { domain: 'AKREDITASI', intent: 'accreditation', entity: ['BAN-PT'], source: /rag-accreditation|semantic-rag-accreditation/i, requiredFacts: [/BAN-PT/i, /BAIK SEKALI/i] }),
  c('scholarship_available', 'apakah tersedia beasiswa?', { domain: 'BEASISWA', intent: 'scholarship', source: /semantic-rag-scholarship/i, requiredTopics: [/beasiswa/i], requiredFacts: [/KIP|SKSS|1K1S|Prestasi|Yayasan/i] }),

  c('facility_generic_full', 'apa saja fasilitas kampus?', { domain: 'FASILITAS', intent: 'facility_list', source: /semantic-rag-campus-facility|semantic-rag-campus-support/i, requiredTopics: [/fasilitas|layanan|program pendukung/i], forbiddenTopics: [/belum menemukan data yang sesuai/i] }),
  c('facility_generic_kampus', 'fasilitas kampus apa saja?', { domain: 'FASILITAS', intent: 'facility_list', source: /semantic-rag-campus-facility|semantic-rag-campus-support/i, requiredTopics: [/fasilitas|layanan|program pendukung/i], forbiddenTopics: [/belum menemukan data yang sesuai/i] }),
  c('facility_generic_short', 'fasilitas apa saja?', { domain: 'FASILITAS', intent: 'facility_list', source: /semantic-rag-campus-facility|semantic-rag-campus-support/i, requiredTopics: [/fasilitas|layanan|program pendukung/i], forbiddenTopics: [/belum menemukan data yang sesuai/i] }),
  c('career_center_raw_fragment', 'layanan karier ada?', { domain: 'CAREER', intent: 'career_support', entity: ['Career Center'], source: /semantic-rag-campus-support-entity/i, requiredTopics: [/Career Center|karier|magang|lowongan|job fair/i], forbiddenTopics: [/-\s*Career Center[\s\S]{0,140}-\s*Selain memperoleh/i, /didedikasikan\s*-\s*Selain/i] }),
  c('student_orgs', 'Apakah tersedia organisasi mahasiswa yang bisa mendukung minat mahasiswa di luar dari pembelajaran formal?', { domain: 'UKM_ORGANISASI', intent: 'student_organization', source: /semantic-rag-(campus-support|ukm|bem)/i, requiredTopics: [/organisasi mahasiswa|UKM|Ormawa|BEM|Himaprodi/i] }),
  c('ukm_join_followup', 'bagaimana cara ikut UKM VOS?', { domain: 'UKM_ORGANISASI', intent: 'ukm_join', entity: ['UKM VOS'], source: /semantic-rag-ukm-specific-insufficient-data|semantic-rag-ukm-list/i, requiredTopics: [/UKM VOS|Vos/i, /bergabung|mendaftar|konfirmasi|kemahasiswaan|pengurus/i], expectedFallback: true }),

  c('academic_sks_s1', 'Berapa sks yang harus ditempuh untuk dapat lulus program S1?', { domain: 'ACADEMIC', intent: 'academic_credit', source: /semantic-rag-academic-credit/i, requiredFacts: [/144 SKS/i] }),
  c('academic_ta_pages', 'berapa halaman minimal dibuat untuk tugas akhir di prodi SI atau fakultas infokom', { domain: 'ACADEMIC', intent: 'academic_policy', source: /semantic-rag-academic-policy/i, requiredTopics: [/minimal halaman total|Tugas Akhir|Skripsi/i], requiredFacts: [/150 kata/i, /200 kata/i, /4 SKS/i], expectedFallback: true }),

  c('foreign_study_permit_visa', 'Bagaimana cara mengurus Izin Belajar dan Visa Study?', { domain: 'FOREIGN_STUDENT', intent: 'foreign_admin', entity: ['Izin Belajar', 'Visa Study'], source: /semantic-rag-(known-faq-qna|generic-faq-qna|admin-topic-composer)/i, requiredTopics: [/Izin Belajar/i, /Visa Study|Visa E30B/i, /kampus|International Office|dokumen/i] }),
  c('itas_how', 'bagaimana cara mengurus ITAS?', { domain: 'ITAS_KITAS_VISA_SKTT', intent: 'foreign_admin', entity: ['ITAS'], source: /semantic-rag-(known-faq-qna|generic-faq-qna|admin-topic-composer|international-topic-composer)/i, requiredTopics: [/ITAS|izin tinggal/i, /kampus|dokumen|paspor|administrasi/i] }),
  c('kitas_definition', 'KITAS itu apa?', { domain: 'ITAS_KITAS_VISA_SKTT', intent: 'foreign_admin', entity: ['KITAS'], source: /semantic-rag-(known-faq-qna|generic-faq-qna|admin-topic-composer|international-topic-composer)/i, requiredTopics: [/KITAS|izin tinggal/i] }),
  c('sktt_definition', 'SKTT itu apa?', { domain: 'ITAS_KITAS_VISA_SKTT', intent: 'foreign_admin', entity: ['SKTT'], source: /semantic-rag-(known-faq-qna|generic-faq-qna|admin-topic-composer|international-topic-composer)/i, requiredTopics: [/SKTT|Surat Keterangan Tempat Tinggal|tempat tinggal/i] }),

  c('double_degree_help', 'apa itu Double Degree HELP?', { domain: 'DOUBLE_DEGREE_HELP', intent: 'double_degree', entity: ['HELP'], source: /semantic-rag-(dual-degree|international|campus-support-entity)/i, requiredTopics: [/HELP University|HELP/i, /Double Degree/i] }),
  c('double_degree_dnui_china', 'Program Dual Degree DNUI apa harus ke China?', { domain: 'DOUBLE_DEGREE_DNUI', intent: 'double_degree', entity: ['DNUI', 'China'], source: /semantic-rag-(international-topic-composer|dual-degree)/i, requiredTopics: [/DNUI|Dalian/i, /China/i, /tahun keempat|onsite|kuliah/i] }),
  c('hi_think_definition', 'Hi-Think itu apa?', { domain: 'HI_THINK', intent: 'international_career_program', entity: ['Hi-Think'], source: /semantic-rag-(campus-support-entity|career-readiness|international)/i, requiredTopics: [/Hi-Think/i, /Jepang|karier|kerja|teknologi/i] }),
  c('student_exchange', 'ada Student Exchange?', { domain: 'STUDENT_EXCHANGE', intent: 'student_exchange', entity: ['Student Exchange'], source: /semantic-rag-(international|campus-support-entity)/i, requiredTopics: [/Student Exchange|pertukaran mahasiswa/i] }),

  c('general_unknown', 'berapa tinggi gedung kampus?', { domain: 'GENERAL_UNKNOWN', intent: 'unknown_or_no_data', source: /semantic-rag-|rag-/i, requiredTopics: [/belum menemukan|tidak menemukan|konfirmasi|cek informasi resmi/i], expectedFallback: true }),
  c('followup_dual_degree_fee', 'Berapa rincian biayanya?', { domain: 'FOLLOW_UP_MULTI_TURN', intent: 'contextual_fee_followup', source: /semantic-rag-fee-detail|semantic-rag-dual-degree/i, requiredTopics: [/Double Degree|DNUI|HELP|UTB|DPP|UKT|biaya/i], sessionData: { messages: [{ direction: 'user', message: 'Seperti apa itu program Dual Degree?' }, { direction: 'bot', message: 'ITB STIKOM Bali memiliki program Dual Degree dengan mitra UTB, DNUI, dan HELP University.' }] } })
];

function classify(item, result, duration, error) {
  const answer = String(result && result.answer || '').trim();
  const source = String(result && result.source || '');
  const combined = source + '\n' + answer;
  const hardTimedOut = duration > HARD_TIMEOUT_MS || /HARD_TIMEOUT/.test(String(error && error.message || ''));
  const sourceMismatch = item.source ? !rx(item.source).test(source) : false;
  const entityMissing = misses(item.entity || [], combined);
  const requiredTopicMissing = misses(item.requiredTopics || [], answer);
  const requiredFactMissing = misses(item.requiredFacts || [], answer);
  const forbiddenTopicHit = hits(item.forbiddenTopics || [], answer);
  const forbiddenFactHit = hits(item.forbiddenFacts || [], answer);
  const meaningMismatch = /meaning-mismatch/i.test(source);
  const rawLeak = RAW_LEAK_RE.test(answer);
  const noDataSignal = NO_DATA_RE.test(answer) || /insufficient|no-data/i.test(source);
  const unexpectedNoData = !item.expectedFallback && noDataSignal && (requiredTopicMissing.length > 0 || requiredFactMissing.length > 0 || /meaning-mismatch/i.test(source));
  const dateMismatch = Boolean(item.dateContext && item.dateContext.mustMentionExplicitDate && !/7 Juli 2026|tanggal 7 juli/i.test(answer)) || Boolean(item.dateContext && item.dateContext.mustNotUseToday && /Per 19 Agustus 2026/i.test(answer));
  const slow = duration > PERFORMANCE_BUDGET_MS;

  let firstFailure = 'NONE';
  let rootCause = 'OK';
  let status = 'PASS';
  if (hardTimedOut) [firstFailure, rootCause, status] = ['TEST_HARNESS', 'HARD_TIMEOUT', 'TIMEOUT'];
  else if (error) [firstFailure, rootCause, status] = ['TEST_HARNESS', 'UNRESOLVED_RUNTIME_ERROR', 'BLOCKED'];
  else if (!answer) [firstFailure, rootCause, status] = ['GENERATION', 'EMPTY_ANSWER', 'WRONG'];
  else if (meaningMismatch) [firstFailure, rootCause, status] = ['VERIFIER', 'MEANING_VERIFIER_BLOCKED_EXPECTED_ANSWER', 'WRONG'];
  else if (sourceMismatch || BAD_SOURCE_RE.test(source)) [firstFailure, rootCause, status] = ['ROUTING', 'EXPECTED_ROUTE_OR_SOURCE_MISMATCH', 'WRONG'];
  else if (entityMissing.length) [firstFailure, rootCause, status] = ['ENTITY', 'EXPECTED_ENTITY_MISSING', 'WRONG'];
  else if (dateMismatch) [firstFailure, rootCause, status] = ['DATE_CONTEXT', 'EXPLICIT_DATE_NOT_PRIORITIZED', 'WRONG'];
  else if (rawLeak) [firstFailure, rootCause, status] = ['POST_PROCESSING', 'RAW_EVIDENCE_OR_INTERNAL_FRAGMENT_LEAK', 'WRONG'];
  else if (requiredTopicMissing.length) [firstFailure, rootCause, status] = ['ANSWER_RELEVANCE', 'REQUIRED_TOPIC_MISSING', 'WRONG'];
  else if (requiredFactMissing.length) [firstFailure, rootCause, status] = ['GROUNDING', 'REQUIRED_FACT_MISSING', 'WRONG'];
  else if (forbiddenTopicHit.length || forbiddenFactHit.length) [firstFailure, rootCause, status] = ['ANSWER_RELEVANCE', 'FORBIDDEN_TOPIC_OR_FACT_PRESENT', 'WRONG'];
  else if (unexpectedNoData) [firstFailure, rootCause, status] = ['RETRIEVAL_OR_GROUNDING', 'UNEXPECTED_FALLBACK_OR_NO_DATA', 'PARTIAL'];
  else if (item.expectedFallback && (/insufficient|no-data/i.test(source) || NO_DATA_RE.test(answer))) [firstFailure, rootCause, status] = ['NONE', 'EXPECTED_FALLBACK', 'EXPECTED_FALLBACK'];
  else if (slow) [firstFailure, rootCause, status] = ['PERFORMANCE', 'PERFORMANCE_BUDGET_EXCEEDED', 'PARTIAL'];

  const debug = result && typeof result.debug === 'object' ? result.debug : {};
  return { id: item.id, query: item.query, expected: { domain: item.domain, intent: item.intent, entity: arr(item.entity), source: item.source ? item.source.toString() : null, dateContext: item.dateContext || null }, actual: { source, answer: compact(answer, 1800), duration, completed: !error && !hardTimedOut, hardTimedOut, performancePass: duration <= PERFORMANCE_BUDGET_MS, confidenceTier: result && result.confidenceTier || null, confidenceScore: result && result.confidenceScore || null }, trace: { normalization: debug.normalizedRouting || (debug.rewrite && debug.rewrite.normalizedQuestion) || norm(item.query), intent: debug.rewrite && (debug.rewrite.intent || debug.rewrite.semanticIntent) || 'N/A', entity: debug.rewrite && debug.rewrite.entities || 'N/A', route: source || 'N/A', retrieval: debug.indexSize || debug.retrievedCount || 'N/A', evidence: Array.isArray(result && result.contexts) ? result.contexts.slice(0, 3).map((ctx) => compact(ctx.chunk || ctx.text || ctx.content || '', 260)) : [], verifier: debug.preflight || (meaningMismatch ? 'meaning-mismatch-source' : 'N/A'), generation: answer ? 'ANSWER_GENERATED' : 'EMPTY', postProcessing: rawLeak ? 'RAW_FRAGMENT_DETECTED' : 'OK' }, checks: { sourceMismatch, entityMissing: entityMissing.map(label), requiredTopicMissing: requiredTopicMissing.map(label), requiredFactMissing: requiredFactMissing.map(label), forbiddenTopicHit: forbiddenTopicHit.map(label), forbiddenFactHit: forbiddenFactHit.map(label), unexpectedNoData, meaningMismatch, rawLeak, dateMismatch, slow }, firstFailure, rootCause, status, error: error ? String(error.message || error) : null };
}

async function runQuery(item) {
  const start = Date.now();
  let timer;
  const query = querySemanticRag(item.query, { topK: 8, mode: 'final-user-question-smoke', chatId: `final-smoke:${item.id}`, sessionData: item.sessionData || {}, intentHint: item.intent || '' });
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), HARD_TIMEOUT_MS); });
  const raced = await Promise.race([query.then((result) => ({ result })).catch((error) => ({ error })), timeout]);
  if (timer) clearTimeout(timer);
  const duration = Date.now() - start;
  if (raced.timeout) return { result: null, duration, error: new Error(`HARD_TIMEOUT after ${HARD_TIMEOUT_MS}ms`) };
  return { result: raced.result || null, duration, error: raced.error || null };
}

function clusters(results) {
  const out = new Map();
  for (const r of results) if (!['PASS', 'EXPECTED_FALLBACK'].includes(r.status)) { if (!out.has(r.rootCause)) out.set(r.rootCause, []); out.get(r.rootCause).push(r.id); }
  return [...out.entries()].map(([rootCause, ids]) => ({ rootCause, count: ids.length, cases: ids }));
}

function markdown(results, failureClusters) {
  const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const lines = ['# Final User Question Golden Smoke Test', '', `Total: ${results.length}`, `PASS: ${counts.PASS || 0}`, `EXPECTED_FALLBACK: ${counts.EXPECTED_FALLBACK || 0}`, `PARTIAL: ${counts.PARTIAL || 0}`, `WRONG: ${counts.WRONG || 0}`, `BLOCKED: ${counts.BLOCKED || 0}`, `TIMEOUT: ${counts.TIMEOUT || 0}`, '', `HARD_TIMEOUT_MS: ${HARD_TIMEOUT_MS}`, `PERFORMANCE_BUDGET_MS: ${PERFORMANCE_BUDGET_MS}`, '', '## Failure Clusters', ''];
  if (!failureClusters.length) lines.push('No failure clusters.', ''); else for (const cl of failureClusters) lines.push(`- ${cl.rootCause}: ${cl.count} case(s) - ${cl.cases.join(', ')}`);
  lines.push('', '## First Failure Matrix', '', '| Status | Query | Expected | Actual Source | First Failure | Root Cause | Duration |', '|---|---|---|---|---|---|---|');
  for (const r of results) lines.push(`| ${r.status} | ${r.id} | ${r.expected.domain}/${r.expected.intent} | ${r.actual.source || '-'} | ${r.firstFailure} | ${r.rootCause} | ${r.actual.duration}ms |`);
  lines.push('', '## Failure Details', '');
  for (const r of results.filter((x) => !['PASS', 'EXPECTED_FALLBACK'].includes(x.status))) lines.push(`### ${r.id}`, '', `Query: ${r.query}`, '', `Expected: ${r.expected.domain} / ${r.expected.intent}`, '', `Actual source: ${r.actual.source || '-'}`, '', `Status: ${r.status}`, '', `First Failure: ${r.firstFailure}`, '', `Root Cause: ${r.rootCause}`, '', 'Checks:', '', `- Missing entity: ${r.checks.entityMissing.join(', ') || '-'}`, `- Missing required topics: ${r.checks.requiredTopicMissing.join(', ') || '-'}`, `- Missing required facts: ${r.checks.requiredFactMissing.join(', ') || '-'}`, `- Forbidden topics hit: ${r.checks.forbiddenTopicHit.join(', ') || '-'}`, `- Forbidden facts hit: ${r.checks.forbiddenFactHit.join(', ') || '-'}`, `- Raw leak: ${r.checks.rawLeak}`, `- Date mismatch: ${r.checks.dateMismatch}`, `- Slow: ${r.checks.slow}`, '', 'Answer:', '', r.actual.answer || '-', '');
  return lines.join('\n');
}

async function main() {
  const results = [];
  for (const item of cases) {
    const { result, duration, error } = await runQuery(item);
    const evaluated = classify(item, result, duration, error);
    results.push(evaluated);
    console.log(`${evaluated.status} | ${evaluated.firstFailure} | ${evaluated.actual.source || 'no-source'} | ${item.id} | ${duration}ms`);
    if (!['PASS', 'EXPECTED_FALLBACK'].includes(evaluated.status)) console.log(`  root=${evaluated.rootCause}\n  answer=${compact(evaluated.actual.answer, 260)}`);
  }
  const failureClusters = clusters(results);
  const outDir = path.resolve(__dirname, '..', 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'final_user_question_smoke_test.md'), markdown(results, failureClusters), 'utf8');
  fs.writeFileSync(path.join(outDir, 'final_user_question_smoke_test.json'), JSON.stringify({ thresholds: { HARD_TIMEOUT_MS, PERFORMANCE_BUDGET_MS }, clusters: failureClusters, results }, null, 2), 'utf8');
  const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const blocking = (counts.WRONG || 0) + (counts.BLOCKED || 0) + (counts.TIMEOUT || 0);
  console.log(JSON.stringify({ ok: blocking === 0, total: results.length, counts, clusters: failureClusters, report: path.join(outDir, 'final_user_question_smoke_test.md') }, null, 2));
  if (blocking) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });

