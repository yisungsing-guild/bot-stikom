const fs = require('fs');
const path = require('path');
const { AIReplyEngine } = require('../src/engine/aiEngine');

(async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const questions = [
    'Apa saja prodi yang ada di kampus ini?',
    'Berapa biaya kuliah untuk program SI?',
    'Bandingkan biaya antara SI dan TI',
    'Apa itu program dual degree dan apa keuntungannya?',
    'Apa perbedaan prodi SI dan TI?',
    'Berapa biaya kuliah untuk program SI gelombang 1A?',
    'Apakah ada program dual degree di SI?',
    'Apa saja biaya yang dibutuhkan saat daftar ulang?'
  ];

  if (!apiKey) {
    console.log(JSON.stringify({ hasApiKey: false, model }, null, 2));
    return;
  }

  const engine = new AIReplyEngine(apiKey, model);
  const reportLines = [];

  for (const q of questions) {
    const res = await engine.getReply(q);
    const entry = [
      '========================================',
      `QUESTION: ${q}`,
      `SUCCESS: ${res.success}`,
      `MODEL: ${res.model || model}`,
      `TOKENS: ${JSON.stringify(res.usage || {})}`,
      'BOT_REPLY_START',
      res.reply || '',
      'BOT_REPLY_END',
      ''
    ];

    console.log('\n' + entry.join('\n'));
    reportLines.push(...entry);
  }

  const reportPath = path.join(__dirname, 'bot_response_detail_report.txt');
  fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');
  console.log(`\nLaporan disimpan ke: ${reportPath}`);
})();
