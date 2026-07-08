const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.BOT_FALLBACK_ENABLED = 'true';

const { query } = require('./src/engine/ragEngine');
const { classifyIntent } = require('./src/engine/intentClassifier');

const programs = [
  { code: 'SI', label: 'Sistem Informasi' },
  { code: 'TI', label: 'Teknologi Informasi' },
  { code: 'SK', label: 'Sistem Komputer' },
  { code: 'BD', label: 'Bisnis Digital' },
  { code: 'MI', label: 'Manajemen Informatika' }
];

const queries = [
  { key: 'definition', prompt: 'Jelaskan apa itu program studi {program} di ITB STIKOM Bali', label: 'Definisi' },
  { key: 'curriculum', prompt: 'Apa saja yang dipelajari di {program}? Jelaskan kurikulumnya.', label: 'Mata kuliah' },
  { key: 'career', prompt: 'Prospek kerja lulusan {program} di ITB STIKOM Bali seperti apa?', label: 'Prospek kerja' },
  { key: 'cost', prompt: 'Berapa biaya kuliah untuk program {program}?', label: 'Biaya' },
  { key: 'accreditation', prompt: 'Apa akreditasi program {program} di ITB STIKOM Bali?', label: 'Akreditasi' }
];

function splitAnswer(answer) {
  const raw = String(answer || '').replace(/\r\n/g, '\n').trim();
  const blocks = raw
    .split(/\n{2,}/)
    .map(b => String(b || '').trim())
    .filter(Boolean);

  const header = blocks.length >= 1 ? blocks[0] : '';
  const followUp = blocks.length >= 3
    ? blocks[blocks.length - 1]
    : (blocks.length === 2 && /\?$/.test(blocks[1]) ? blocks[1] : '');
  let body = '';
  if (blocks.length === 1) {
    body = blocks[0];
  } else if (blocks.length === 2) {
    if (followUp) {
      body = blocks[0];
    } else {
      body = blocks.join('\n\n');
    }
  } else {
    body = blocks.slice(1, blocks.length - (followUp ? 1 : 0)).join('\n\n');
  }
  return {
    greeting: header,
    body: body.trim(),
    followUp: followUp.trim(),
    full: raw
  };
}

function extractConclusion(body) {
  const sentences = body.match(/[^.!?\n]+[.!?]/g) || [];
  if (!sentences.length) return '';
  const last = sentences[sentences.length - 1].trim();
  if (/^(secara umum|singkatnya|kesimpulannya|jadi|intinya|sehingga|ringkasnya)/i.test(last)) return last;
  return '';
}

function guessAssumption(question) {
  const q = question.toLowerCase();
  if (q.includes('apa itu') || q.includes('jelaskan apa itu')) return 'Pengguna ingin definisi dan gambaran singkat tentang program studi.';
  if (q.includes('mata kuliah') || q.includes('kurikulumnya') || q.includes('dipelajari')) return 'Pengguna ingin detail materi atau mata kuliah yang dipelajari di program studi.';
  if (q.includes('prospek kerja') || q.includes('lulusan')) return 'Pengguna mencari informasi karir dan peluang kerja lulusan program studi.';
  if (q.includes('biaya')) return 'Pengguna ingin mengetahui besaran biaya kuliah untuk program studi tersebut.';
  if (q.includes('akreditasi')) return 'Pengguna ingin mengetahui peringkat atau status akreditasi program studi.';
  return 'Pengguna ingin informasi program studi terkait.';
}

function matchesAssumption(question, body) {
  const text = String(body || '').toLowerCase();
  const q = question.toLowerCase();
  if (!text.trim()) return false;
  if (q.includes('apa itu') || q.includes('jelaskan apa itu')) {
    return /\b(bidang|program studi|mengelola|informasi|sistem|mengolah|distribusi|penelitian|riset)\b/i.test(text);
  }
  if (q.includes('mata kuliah') || q.includes('kurikulumnya') || q.includes('dipelajari')) {
    return /\b(mata kuliah|kurikulum|materi|dipelajari|pelajari|semester|pembelajaran|komponen)\b/i.test(text);
  }
  if (q.includes('prospek kerja') || q.includes('lulusan')) {
    return /\b(prospek|karir|pekerjaan|lulus|lowongan|posisi|industri|peluang)\b/i.test(text);
  }
  if (q.includes('biaya')) {
    return /\b(biaya|dpp|semester|uang kuliah|harga|tagihan|pembayaran|UKT)\b/i.test(text);
  }
  if (q.includes('akreditasi')) {
    return /\b(akreditasi|peringkat|sk|ban-pt|lam-infokom|baik sekali|baik|terakreditasi)\b/i.test(text);
  }
  return /\w+/.test(text);
}

function evaluateRating(condition) {
  if (condition === 'good') return '✅';
  if (condition === 'warning') return '⚠️';
  return '❌';
}

function buildRecommendedFollowupQuestions(userText) {
  let q1 = '* Mau saya jelaskan keunggulan program Studi tersebut lagi?';
  let q2 = '* Mau saya jelaskan prospek kerja atau mata kuliah lain?';
  let q3 = '* Mau info biaya atau akreditasi untuk program ini?';

  if (/(biaya|dpp|semester|pembayaran|cicil|cicilan|uang kuliah)/i.test(userText)) {
    q1 = '* Mau saya jelaskan juga jadwal pendaftaran atau gelombang yang berlaku?';
    q2 = '* Mau saya bantu hitung total biaya awal masuk atau potongan?';
    q3 = '* Mau info kontak atau persyaratan pendaftaran?';
  } else if (/(akreditasi|ban-pt|sk)/i.test(userText)) {
    q1 = '* Mau saya jelaskan lagi program studi atau jurusan lain?';
    q2 = '* Mau saya bantu cek status akreditasi terbaru?';
    q3 = '* Mau saya jelaskan prospek kerja atau kurikulum program ini?';
  }

  return `Rekomendasi pertanyaan berikutnya:\n${q1}\n${q2}\n${q3}`;
}

function decorateBotAnswerText(rawAnswerText, inboundUserText) {
  let out = String(rawAnswerText || '').trim();
  if (!out) return out;

  if (/(^|\n)\s*Balas\s*:\s*/i.test(out) || /\b(pilih|ketik)\s+angka\b/i.test(out)) {
    return out;
  }

  out = out.replace(/^(?:Baik,?\s*kak\.?\s*)?(?:Terima\s*kasih|Terimakasih)\s+atas\s+pertanyaan(?:an)?\.?\s*\n+/i, '');

  const alreadyHasFollowups =
    /Rekomendasi\s+pertanyaan\s+berikutnya\s*:/i.test(out) ||
    /Fasilitas\s+yang\s+ada\s+di\s+ITB\s+STIKOM\s+Bali/i.test(out) ||
    /Apakah\s+Kakak\s+ingin\s+dijelaskan\s+tentang\?/i.test(out);

  const suffix = alreadyHasFollowups ? '' : `\n\n${buildRecommendedFollowupQuestions(inboundUserText)}`;
  return `${out}${suffix}`.trim();
}

function evaluateMainAnswer(body) {
  const text = String(body || '').trim();
  if (!text) return 'problem';
  if (text.length < 40) return 'warning';
  return 'good';
}

function evaluateRecommendation(followUp) {
  if (!followUp) return 'problem';
  if (/Rekomendasi pertanyaan berikutnya/i.test(followUp) || /Mau saya/i.test(followUp) || /apakah.*ingin/i.test(followUp)) {
    return 'good';
  }
  return 'warning';
}

(async () => {
  const results = [];
  const issues = {};
  const totals = {
    greeting: 0,
    assumption: 0,
    answer: 0,
    conclusion: 0,
    recommendation: 0
  };

  for (const program of programs) {
    for (const q of queries) {
      const question = q.prompt.replace('{program}', program.label);
      const intent = classifyIntent(question);
      const assumption = guessAssumption(question);
      let result;
      try {
        result = await query(question, 6, { answerQuestion: question, strict: false, includeGlobal: true, minScore: 0.2, returnDebug: true });
      } catch (err) {
        result = { success: false, answer: '', source: 'error', error: err.message };
      }

      const queryAnswer = String(result.answer || '').trim();
      const decoratedAnswer = decorateBotAnswerText(queryAnswer, question);
      const parsed = splitAnswer(queryAnswer);
      const parsedDecor = splitAnswer(decoratedAnswer);
      const conclusion = extractConclusion(parsedDecor.body);
      const hasAssumption = matchesAssumption(question, parsedDecor.body);

      const evalGreeting = parsedDecor.greeting ? 'good' : 'problem';
      const evalAssumption = hasAssumption ? 'good' : 'problem';
      const evalAnswer = evaluateMainAnswer(parsedDecor.body);
      const evalConclusion = conclusion ? 'good' : 'problem';
      const evalRecommendation = evaluateRecommendation(parsedDecor.followUp);

      if (evalGreeting === 'good') totals.greeting += 1;
      if (evalAssumption === 'good') totals.assumption += 1;
      if (evalAnswer === 'good') totals.answer += 1;
      if (evalConclusion === 'good') totals.conclusion += 1;
      if (evalRecommendation === 'good') totals.recommendation += 1;

      const record = {
        program: program.label,
        queryLabel: q.label,
        question,
        intent,
        source: result.source || 'unknown',
        queryAnswer,
        decoratedAnswer,
        parsed: {
          greeting: parsedDecor.greeting || '(tidak tersedia)',
          assumption,
          body: parsedDecor.body || '(tidak tersedia)',
          conclusion: conclusion || '(tidak eksplisit)',
          recommendation: parsedDecor.followUp || '(tidak tersedia)'
        },
        evaluation: {
          greeting: evaluateRating(evalGreeting),
          assumption: evaluateRating(evalAssumption),
          answer: evaluateRating(evalAnswer),
          conclusion: evaluateRating(evalConclusion),
          recommendation: evaluateRating(evalRecommendation)
        },
        debug: result.debug || null
      };

      if (evalGreeting !== 'good') {
        issues['missing greeting'] = (issues['missing greeting'] || 0) + 1;
      }
      if (evalAssumption !== 'good') {
        issues['weak or missing assumption evidence'] = (issues['weak or missing assumption evidence'] || 0) + 1;
      }
      if (evalAnswer !== 'good') {
        issues['main answer too short or missing'] = (issues['main answer too short or missing'] || 0) + 1;
      }
      if (evalConclusion !== 'good') {
        issues['missing conclusion'] = (issues['missing conclusion'] || 0) + 1;
      }
      if (evalRecommendation !== 'good') {
        issues['missing follow-up / recommendation'] = (issues['missing follow-up / recommendation'] || 0) + 1;
      }

      if (parsedDecor.followUp && /Rekomendasi pertanyaan berikutnya/i.test(parsedDecor.followUp)) {
        record.parsed.recommendation = parsedDecor.followUp;
      }

      results.push(record);
    }
  }

  const totalQueries = results.length;
  const summary = {
    totalQueries,
    greetingPct: Math.round((totals.greeting / totalQueries) * 100),
    assumptionPct: Math.round((totals.assumption / totalQueries) * 100),
    answerPct: Math.round((totals.answer / totalQueries) * 100),
    conclusionPct: Math.round((totals.conclusion / totalQueries) * 100),
    recommendationPct: Math.round((totals.recommendation / totalQueries) * 100),
    topIssues: Object.entries(issues)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([issue, count]) => ({ issue, count }))
  };

  const output = {
    summary,
    results
  };

  fs.writeFileSync(path.join(process.cwd(), 'tmp_audit_ux_final.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log('Audit UX final selesai. Hasil tersimpan di tmp_audit_ux_final.json');
})();
