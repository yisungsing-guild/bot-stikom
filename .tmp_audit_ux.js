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
  const followUp = blocks.length >= 3 ? blocks[blocks.length - 1] : (blocks.length === 2 && /\?$/.test(blocks[1]) ? blocks[1] : '');
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

function guessAssumption(question) {
  const q = question.toLowerCase();
  if (q.includes('apa itu') || q.includes('jelaskan apa itu')) return 'Pengguna ingin definisi dan gambaran singkat tentang program studi.';
  if (q.includes('mata kuliah') || q.includes('kurikulumnya') || q.includes('dipelajari')) return 'Pengguna ingin detail materi atau mata kuliah yang dipelajari di program studi.';
  if (q.includes('prospek kerja') || q.includes('lulusan')) return 'Pengguna mencari informasi karir dan peluang kerja lulusan program studi.';
  if (q.includes('biaya')) return 'Pengguna ingin mengetahui besaran biaya kuliah untuk program studi tersebut.';
  if (q.includes('akreditasi')) return 'Pengguna ingin mengetahui peringkat atau status akreditasi program studi.';
  return 'Pengguna ingin informasi program studi terkait.';
}

function evaluateRating(desc, condition) {
  if (condition === 'good') return '✅ Baik';
  if (condition === 'problem') return '❌ Bermasalah';
  return '⚠️ Perlu perbaikan';
}

function extractConclusion(body) {
  const sentences = body.match(/[^.!?\n]+[.!?]/g) || [];
  if (!sentences.length) return '';
  const last = sentences[sentences.length - 1].trim();
  if (/^(secara umum|singkatnya|kesimpulannya|jadi|intinya|sehingga)/i.test(last)) return last;
  return '';
}

(async () => {
  const results = [];
  for (const program of programs) {
    for (const q of queries) {
      const question = q.prompt.replace('{program}', program.label);
      const intent = classifyIntent(question);
      try {
        const result = await query(question, 6, { answerQuestion: question, strict: false, includeGlobal: true, minScore: 0.2, returnDebug: true });
        const parsed = splitAnswer(result.answer || '');
        const conclusion = extractConclusion(parsed.body);
        const assumption = guessAssumption(question);

        const evaluation = {
          greeting: evaluateRating('greeting', parsed.greeting && !parsed.greeting.toLowerCase().includes('saya bantu') ? 'good' : 'problem'),
          intent: evaluateRating('intent', intent ? 'good' : 'problem'),
          assumption: evaluateRating('assumption', assumption ? 'good' : 'problem'),
          mainAnswer: evaluateRating('mainAnswer', parsed.body && parsed.body.length > 20 ? 'good' : 'problem'),
          conclusion: evaluateRating('conclusion', conclusion ? 'good' : 'problem'),
          recommendation: evaluateRating('recommendation', parsed.followUp ? 'good' : 'problem')
        };

        results.push({
          program: program.label,
          questionLabel: q.label,
          question,
          source: result.source || 'unknown',
          intent,
          greeting: parsed.greeting,
          assumption,
          body: parsed.body,
          conclusion: conclusion || '(tidak eksplisit)',
          followUp: parsed.followUp || '(tidak tersedia)',
          _rawAnswer: parsed.full,
          evaluation,
          debug: result.debug || null
        });
      } catch (err) {
        results.push({
          program: program.label,
          questionLabel: q.label,
          question,
          source: 'error',
          intent,
          greeting: '',
          assumption: guessAssumption(question),
          body: '',
          conclusion: '',
          followUp: '',
          _rawAnswer: '',
          evaluation: {
            greeting: '❌ Bermasalah',
            intent: '✅ Baik',
            assumption: '✅ Baik',
            mainAnswer: '❌ Bermasalah',
            conclusion: '❌ Bermasalah',
            recommendation: '❌ Bermasalah'
          },
          error: err.message
        });
      }
    }
  }

  fs.writeFileSync(path.join(process.cwd(), 'tmp_audit_ux_results.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('Audit UX selesai. Hasil tersimpan di tmp_audit_ux_results.json');
})();
