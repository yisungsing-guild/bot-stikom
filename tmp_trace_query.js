const { query } = require('./src/engine/ragEngine');
const { classifyIntent } = require('./src/engine/intentClassifier');

const q = 'Apa itu Sistem Informasi?';

function buildRecommendedFollowupQuestions(t) {
  const q1 = '* Mau saya jelaskan keunggulan program Studi tersebut lagi?';
  const q2 = '* Mau saya jelaskan prospek kerja atau mata kuliah lain?';
  const q3 = '* Mau info biaya atau akreditasi untuk program ini?';
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

(async () => {
  const intent = classifyIntent(q);
  const result = await query(q, 6, { answerQuestion: q, strict: false, includeGlobal: true, minScore: 0.2, returnDebug: true });
  console.log('QUERY:', q);
  console.log('INTENT:', intent);
  console.log('SOURCE:', result.source);
  console.log('ANSWER:', result.answer);
  console.log('CONTEXT SUMMARY:', result.contextSummary || '(none)');
  console.log('CONTEXT COUNT:', Array.isArray(result.contexts) ? result.contexts.length : 'n/a');
  if (Array.isArray(result.contexts)) {
    result.contexts.slice(0,3).forEach((ctx, idx) => {
      console.log(`CONTEXT #${idx+1}:`, (ctx && ctx.chunk ? String(ctx.chunk).replace(/\n/g, ' ').slice(0, 240) : '')); 
    });
  }
  const decorated = decorateBotAnswerText(result.answer || '', q);
  console.log('DECORATED:', decorated);
})();
