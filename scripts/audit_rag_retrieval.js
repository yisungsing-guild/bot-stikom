const fs = require('fs');
const path = require('path');
const { query } = require('../src/engine/ragEngine');
const { buildWhatsappConversationalReply, detectIntentFromAnswer } = require('../src/utils/whatsappFormatter');

const SUMMARY_PATH = path.join(__dirname, 'audit_rag_retrieval_summary.json');

const testQueries = [
  { domain: 'Akademik', topic: 'Kurikulum Prodi', query: 'TI belajar apa saja' },
  { domain: 'Beasiswa', topic: 'Beasiswa Prestasi', query: 'Apa syarat beasiswa prestasi untuk mahasiswa baru' },
  { domain: 'Pendaftaran', topic: 'Status Pendaftaran', query: 'Bagaimana cara cek status pendaftaran' },
  { domain: 'Biaya', topic: 'Biaya Pendaftaran', query: 'Biaya pendaftaran prodi SI gelombang 1' },
  { domain: 'Laboratorium', topic: 'Fasilitas Lab', query: 'Apa saja fasilitas laboratorium komputer' },
  { domain: 'Magang', topic: 'Program Magang', query: 'Program magang industri seperti apa untuk mahasiswa TI' },
  { domain: 'Kerja Sama', topic: 'Partnership Benefits', query: 'Apa keuntungan kerja sama industri untuk mahasiswa' },
  { domain: 'Penelitian', topic: 'Pendanaan Riset', query: 'Bagaimana proses pendanaan penelitian mahasiswa' },
  { domain: 'Lokasi', topic: 'Lokasi Kampus', query: 'Di mana lokasi kampus STIKOM Bali' },
  { domain: 'Akreditasi', topic: 'Akreditasi Prodi', query: 'Apa akreditasi program TI' },
  { domain: 'Perbandingan', topic: 'Perbedaan Prodi', query: 'Perbedaan TI dan SI' },
  { domain: 'Jadwal', topic: 'Jadwal Pendaftaran', query: 'Jadwal pendaftaran terbaru untuk PMB' },
  { domain: 'UKM/Ormawa', topic: 'Daftar UKM', query: 'Daftar UKM dan ormawa STIKOM Bali' },
  { domain: 'Non-akademik', topic: 'Beasiswa Pegawai', query: 'Informasi beasiswa karyawan dan pegawai' },
  { domain: 'Keuangan', topic: 'Laporan Keuangan', query: 'Apa komponen laporan keuangan bulanan instansi' },
  { domain: 'Beasiswa', topic: 'Beasiswa Kurang Mampu', query: 'Bagaimana cara mengajukan beasiswa kurang mampu' },
  { domain: 'Kerja Sama', topic: 'Double Degree', query: 'Apakah ada program double degree UTB' },
  { domain: 'Biaya', topic: 'Biaya Semester', query: 'Rincian biaya semester TI' },
  { domain: 'Pendaftaran', topic: 'Dokumen Pendaftaran', query: 'Dokumen apa yang harus disiapkan untuk daftar' },
  { domain: 'Prospek Kerja', topic: 'Peluang Lulusan', query: 'Apa saja peluang kerja lulusan Sistem Informasi' }
];

function splitAnswerAndSuggestions(rawText) {
  const normalized = String(rawText || '').replace(/\r\n/g, '\n').trim();
  const markerRegex = /(?:^|\n)\s*(Rekomendasi pertanyaan berikutnya[:\s]*|Rekomendasi pertanyaan[:\s]*|Apakah\s+Kakak\s+ingin\s+dijelaskan[^\n]*\?|Balas\s*:\s*|Silakan\s+diketikkan|Butuh\s+informasi|Coba\s+tanya|Mau\s+info\b|Mau\s+saya\s+jelaskan\b)/i;
  const match = normalized.match(markerRegex);
  if (!match || typeof match.index !== 'number') {
    return { mainAnswer: normalized, suggestions: undefined };
  }
  const splitIndex = match.index;
  const mainAnswer = normalized.slice(0, splitIndex).trim();
  const suggestionText = normalized.slice(splitIndex).trim();
  return {
    mainAnswer: mainAnswer || suggestionText,
    suggestions: suggestionText || undefined
  };
}

function parseFormattedReply(formatted) {
  const parts = String(formatted || '').split(/\n\n/).map((part) => part.trim()).filter(Boolean);
  const conclusion = parts.find((part) => /^Kesimpulannya|^Ringkasnya/i.test(part)) || '';
  const suggestionIndex = parts.findIndex((part) => /^(Rekomendasi pertanyaan|Mau|Apakah|Butuh|Coba)/i.test(part));
  const suggestions = suggestionIndex >= 0 ? parts.slice(suggestionIndex).join('\n\n') : '';
  return { conclusion, suggestions };
}

async function runAudit() {
  console.log('='.repeat(100));
  console.log('REAL RAG RETRIEVAL AUDIT FROM rag_index.json');
  console.log('Using actual query() from src/engine/ragEngine.js and formatting with WhatsApp reply builder.');
  console.log('='.repeat(100));

  const summary = [];

  for (const item of testQueries) {
    console.log(`\n${'-'.repeat(100)}`);
    console.log(`DOMAIN: ${item.domain} | TOPIK: ${item.topic}`);
    console.log(`Query: ${item.query}`);
    console.log(`${'-'.repeat(100)}`);

    const result = await query(item.query, 8, { strict: false });
    const formatted = result && result.success && result.answer
      ? buildWhatsappConversationalReply({ rawMainAnswer: result.answer, userQuery: item.query, includeMeta: true })
      : '';

    const detectedIntent = result && result.answer ? detectIntentFromAnswer(result.answer, item.query) : 'unknown';
    const { conclusion, suggestions } = parseFormattedReply(formatted);
    const { mainAnswer, suggestions: rawSuggestions } = splitAnswerAndSuggestions(result.answer || '');
    const topContext = (Array.isArray(result.contexts) && result.contexts.length > 0) ? result.contexts[0] : null;
    const topSourceDoc = topContext ? (topContext.filename || topContext.trainingId || topContext.id || 'unknown') : 'none';
    const topContextPreview = topContext ? String(topContext.chunk || '').replace(/\s+/g, ' ').trim().slice(0, 250) : 'none';
    const retrievalScore = result && Number.isFinite(result.confidenceScore) ? result.confidenceScore : null;

    console.log('RESULT');
    console.log('Query:', item.query);
    console.log('Top Source Document:', topSourceDoc);
    console.log('Retrieval Score:', retrievalScore != null ? retrievalScore.toFixed(4) : 'n/a');
    console.log('Top Retrieved Context:', topContextPreview || 'none');
    console.log('Raw RAG Answer:', result && result.answer ? result.answer : '(no answer)');
    console.log('Formatted WhatsApp Reply:', formatted || '(no reply)');
    console.log('Conclusion:', conclusion || '(empty)');
    console.log('Suggestions:', suggestions || rawSuggestions || '(empty)');
    console.log('-'.repeat(100));

    summary.push({
      domain: item.domain,
      topic: item.topic,
      query: item.query,
      success: Boolean(result && result.success),
      source: result && result.source,
      retrievalScore,
      topSourceDoc,
      topRetrievedContext: topContextPreview,
      rawAnswer: result && result.answer ? result.answer : '',
      formattedReply: formatted || '',
      conclusion: conclusion || '',
      suggestions: suggestions || rawSuggestions || '',
      confidenceTier: result && result.confidenceTier || null,
      contexts: Array.isArray(result.contexts) ? result.contexts.slice(0, 4).map((ctx) => ({ id: ctx.id || null, filename: ctx.filename || ctx.trainingId || null, docCategory: ctx.docCategory || ctx.category || null, preview: String(ctx.chunk || '').slice(0, 120).replace(/\s+/g, ' ').trim() })) : []
    });
  }

  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), 'utf8');

  console.log('\n' + '='.repeat(100));
  console.log('AUDIT RESULTS SUMMARY WRITTEN TO:', SUMMARY_PATH);
  console.log('QUERY COUNT:', summary.length);
  console.log('='.repeat(100));
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
