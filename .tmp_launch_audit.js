const path = require('path');
const { query } = require('./src/engine/ragEngine');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

const cases = [
  { id: 'hobby-ngoding', question: 'hoby saya suka ngoding cocok jurusan apa?', expectSourceNot: ['rag-major-recommendation'], expectContextFile: 'HOBY' },
  { id: 'hobby-memasak', question: 'anak saya suka memasak cocok jurusan apa?', expectAnswerNot: ['Sistem Komputer'] },
  { id: 'dual-degree-general', question: 'apakah ada program dual degree di stikom?', expectSource: 'rag-dual-degree-list', expectAnswerMust: ['UTB', 'DNUI', 'HELP'] },
  { id: 'double-degree-intl', question: 'apakah ada di stikom program double degree internasional?', expectSource: 'rag-dual-degree-list', expectAnswerMust: ['DNUI', 'HELP'], expectAnswerNot: ['UTB'] },
  { id: 'double-degree-nasional', question: 'apakah ada di stikom program double degree nasional?', expectSource: 'rag-dual-degree-list', expectAnswerMust: ['UTB'], expectAnswerNot: ['DNUI', 'HELP'] },
  { id: 'dual-degree-discount', question: 'kalau biaya untuk double degree apakah ada potongan biaya?', expectSource: 'rag-dual-degree-dpp-discount', expectAnswerMust: ['Potongan', 'DPP', 'Gelombang'] },
  { id: 'program-def-si', question: 'Jelaskan apa itu program studi Sistem Informasi di ITB STIKOM Bali', expectSourceNot: ['rag-no-match'], expectContextFile: 'Sistem Informasi' },
  { id: 'program-cur-tI', question: 'Apa saja yang dipelajari di Teknologi Informasi? Jelaskan kurikulumnya.', expectSourceNot: ['rag-no-match'], expectContextFile: 'Teknologi Informasi' },
  { id: 'program-career-bd', question: 'Prospek kerja lulusan Bisnis Digital di ITB STIKOM Bali seperti apa?', expectSourceNot: ['rag-no-match'], expectContextFile: 'Bisnis Digital' },
  { id: 'program-accred-sk', question: 'Apa akreditasi program Sistem Komputer di ITB STIKOM Bali?', expectSourceNot: ['rag-no-match'], expectContextFile: 'Sistem Komputer' },
  { id: 'out-of-scope-hello', question: 'halo, apa kabar?', expectSourceNot: ['rag-no-match'], expectAnswerContains: ['halo', 'apa kabar'] },
  { id: 'out-of-scope-thanks', question: 'terima kasih, sampai jumpa', expectSourceNot: ['rag-no-match'], expectAnswerContains: ['terima kasih', 'sampai jumpa'] },
  { id: 'requirement-query', question: 'Apa persyaratan untuk melakukan pendaftaran kuliah di STIKOM Bali?', expectSource: 'rag-no-match', expectAnswerNull: true },
];

(async () => {
  for (const c of cases) {
    try {
      const res = await query(c.question, 6, { answerQuestion: c.question, strict: false, includeGlobal: true, minScore: 0.2, returnDebug: true });
      const src = res.source || 'NONE';
      const contextNames = Array.isArray(res.contexts)
        ? Array.from(new Set(res.contexts.map(i => String(i.filename || i.trainingId || i.id || '').trim()).filter(Boolean)))
        : [];
      const answer = String(res.answer || '');
      const passed = {
        source: c.expectSource ? src === c.expectSource : true,
        sourceNot: c.expectSourceNot ? !c.expectSourceNot.includes(src) : true,
        answerNull: c.expectAnswerNull ? res.answer === null : true,
        answerContains: c.expectAnswerMust ? c.expectAnswerMust.every(tok => answer.toLowerCase().includes(tok.toLowerCase())) : true,
        answerNot: c.expectAnswerNot ? c.expectAnswerNot.every(tok => !answer.toLowerCase().includes(tok.toLowerCase())) : true,
        contextFile: c.expectContextFile ? contextNames.some(fn => fn.toLowerCase().includes(c.expectContextFile.toLowerCase())) : true,
      };
      console.log(`--- ${c.id}`);
      console.log(`question: ${c.question}`);
      console.log(`source: ${src}`);
      console.log(`confidenceTier: ${res.confidenceTier || 'N/A'}`);
      console.log(`contexts: ${contextNames.join('; ')}`);
      console.log(`answer: ${answer.substring(0, 320).replace(/\n/g,' ')}${answer.length > 320 ? '...' : ''}`);
      console.log('pass:', passed);
      if (res.debug) console.log('debug.source', res.debug.method || res.debug.retrieved || res.debug.aiModel || JSON.stringify(res.debug).slice(0,200));
      console.log('');
    } catch (err) {
      console.error(`ERROR for ${c.id}:`, err && err.message ? err.message : err);
    }
  }
})();
