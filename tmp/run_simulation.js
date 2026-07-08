const fs = require('fs');
const path = require('path');
const fetch = global.fetch || require('node-fetch');
const base = 'http://127.0.0.1:4001';
const queries = [
  'Apa itu TI?',
  'Apa yang dipelajari di TI?',
  'Prospek kerja TI?',
  'Biaya kuliah TI?',
  'Akreditasi TI?',
  'Saya ingin daftar TI'
];
const logPath = path.join(__dirname, 'final_wa_outputs.log');
try {
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
} catch (e) {
  console.error('Unable to remove log file', e);
}
(async () => {
  for (const text of queries) {
    const res = await fetch(`${base}/_simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: 'test-chat', text })
    });
    const body = await res.text();
    console.log('SIMULATE', text, '=>', res.status, body);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const content = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  console.log('===LOG START===');
  console.log(content);
  console.log('===LOG END===');
})();
