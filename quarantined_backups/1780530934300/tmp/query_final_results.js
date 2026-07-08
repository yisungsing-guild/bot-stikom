const fs = require('fs');
const path = require('path');
const { query } = require('../src/engine/ragEngine');
const questions = [
  'Apa itu Sistem Informasi',
  'Sistem Informasi belajar apa saja',
  'Mata kuliah Sistem Informasi',
  'Prospek kerja Sistem Informasi',
  'Lulusan Sistem Informasi bisa kerja dimana',
  'Apa itu Teknologi Informasi',
  'Teknologi Informasi belajar apa saja',
  'Prospek kerja Teknologi Informasi'
];

(async () => {
  const results = [];
  for (const question of questions) {
    try {
      const res = await query(question, 8, { strict: false });
      results.push({ question, success: true, res });
    } catch (err) {
      results.push({ question, success: false, error: err.message || String(err) });
    }
  }
  fs.writeFileSync(path.join(__dirname, 'query_final_results.json'), JSON.stringify(results, null, 2), 'utf8');
})();
