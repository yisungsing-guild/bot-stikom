const { query } = require('../src/engine/ragEngine');
const { queryScoped } = require('../src/engine/ragScoped');

const DEFAULT_TOP_K = parseInt(process.env.RAG_TOP_K || '6', 10);

const CASES = [
  {
    label: 'program_list',
    question: 'prodi apa saja yang ada di stikom?',
    family: 'program_list',
    category: null,
    scope: 'engine'
  },
  {
    label: 'curriculum',
    question: 'di sistem informasi belajar apa saja?',
    family: 'academic_rag',
    category: 'curriculum',
    scope: 'scoped'
  },
  {
    label: 'career',
    question: 'prospek kerja TI bagaimana?',
    family: 'academic_rag',
    category: 'career_path',
    scope: 'scoped'
  },
  {
    label: 'career_si_short',
    question: 'lulusan SI kerja dimana?',
    family: 'academic_rag',
    category: 'career_path',
    scope: 'scoped'
  },
  {
    label: 'career_ti_short',
    question: 'kerjanya nanti jadi apa untuk TI?',
    family: 'academic_rag',
    category: 'career_path',
    scope: 'scoped'
  },
  {
    label: 'career_sk_short',
    question: 'lulusan SK bisa jadi apa?',
    family: 'academic_rag',
    category: 'career_path',
    scope: 'scoped'
  },
  {
    label: 'career_bd_short',
    question: 'lulusan BD kerja dimana?',
    family: 'academic_rag',
    category: 'career_path',
    scope: 'scoped'
  },
  {
    label: 'curriculum_ti_short',
    question: 'Di Teknologi Informasi belajar apa saja?',
    family: 'academic_rag',
    category: 'curriculum',
    scope: 'scoped'
  },
  {
    label: 'curriculum_sk_short',
    question: 'Di Sistem Komputer belajar apa saja?',
    family: 'academic_rag',
    category: 'curriculum',
    scope: 'scoped'
  },
  {
    label: 'curriculum_bd_short',
    question: 'Bisnis digital belajar apa saja?',
    family: 'academic_rag',
    category: 'curriculum',
    scope: 'scoped'
  },
  {
    label: 'international_program_short',
    question: 'kelas internasional itu apa?',
    family: 'academic_rag',
    category: 'international_program',
    scope: 'scoped'
  },
  {
    label: 'tuition_fee_short',
    question: 'biaya kuliah berapa?',
    family: 'academic_rag',
    category: 'tuition_fee',
    scope: 'scoped'
  },
  {
    label: 'tuition',
    question: 'berapa biaya SI?',
    family: 'registration_flow',
    category: null,
    scope: 'engine'
  },
  {
    label: 'requirements',
    question: 'syarat pendaftaran apa saja?',
    family: 'registration_flow',
    category: null,
    scope: 'engine'
  }
];

function getAnswerLength(answer) {
  return String(answer || '').trim().length;
}

function getTopScore(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.debug && typeof result.debug.topScore === 'number' && Number.isFinite(result.debug.topScore)) {
    return result.debug.topScore;
  }
  if (typeof result.confidenceScore === 'number' && Number.isFinite(result.confidenceScore)) {
    return result.confidenceScore;
  }
  return null;
}

function getContextCount(result) {
  return Array.isArray(result && result.contexts) ? result.contexts.length : 0;
}

function getRetrievedCategories(result) {
  if (result && result.debug && Array.isArray(result.debug.retrievedCategories) && result.debug.retrievedCategories.length > 0) {
    return result.debug.retrievedCategories;
  }

  const categories = new Set();
  for (const context of Array.isArray(result && result.contexts) ? result.contexts : []) {
    const category = context && context.metadata && context.metadata.category;
    if (category) categories.add(String(category));
  }
  return Array.from(categories);
}

function classifyRisk(row) {
  const flags = [];

  if (!row.answerPresent) flags.push('no_answer');
  if (row.topScore !== null && Number.isFinite(row.topScore) && row.topScore < 0.35) flags.push('low_top_score');
  if (row.contextCount === 0) flags.push('no_contexts');
  if (row.answerLength > 0 && row.answerLength < 120) flags.push('short_answer');
  if (/rag-(no-match|low-confidence|ai-error|answer-rejected)/i.test(String(row.source || ''))) flags.push('fallback_like_source');
  if (/rag-lexical-fallback|rag-lexical-ukm|rag-lexical/i.test(String(row.source || ''))) flags.push('lexical_fallback_source');
  if (/sebutkan prodi atau kalimat lengkapnya|kalau kakak mau/i.test(String(row.answerPreview || ''))) flags.push('generic_followup_prompt');
  if (row.family === 'academic_rag' && row.label === 'curriculum' && row.contextCount < 2) flags.push('thin_academic_context');

  return flags;
}

async function runCase(testCase) {
  const q = String(testCase.question || '').trim();
  const result = testCase.scope === 'scoped'
    ? await queryScoped({
        query: q,
        category: testCase.category,
        topK: DEFAULT_TOP_K,
        filters: {},
        options: { strict: false }
      })
    : await query(q, DEFAULT_TOP_K, { strict: false });

  const row = {
    label: testCase.label,
    family: testCase.family,
    category: testCase.category,
    question: q,
    success: Boolean(result && result.success),
    source: result && result.source ? String(result.source) : null,
    answerPresent: Boolean(result && typeof result.answer === 'string' && result.answer.trim()),
    answerLength: getAnswerLength(result && result.answer),
    confidenceScore: getTopScore(result),
    topScore: getTopScore(result),
    contextCount: getContextCount(result),
    retrievedCategories: getRetrievedCategories(result),
    riskFlags: []
  };

  row.riskFlags = classifyRisk(row);
  row.answerPreview = row.answerPresent ? String(result.answer).trim().slice(0, 220) : null;
  row.debug = result && result.debug ? result.debug : null;

  return row;
}

function formatRow(row) {
  const scoreText = row.topScore === null ? 'n/a' : row.topScore.toFixed(3);
  const confText = row.confidenceScore === null ? 'n/a' : row.confidenceScore.toFixed(3);
  const categoriesText = row.retrievedCategories.length ? row.retrievedCategories.join(', ') : '-';
  const riskText = row.riskFlags.length ? row.riskFlags.join(', ') : 'ok';
  const answerText = row.answerPresent ? row.answerPreview : '[no answer]';

  return [
    `- ${row.label}`,
    `  question: ${row.question}`,
    `  source: ${row.source || 'n/a'}`,
    `  topScore: ${scoreText}`,
    `  confidenceScore: ${confText}`,
    `  contextCount: ${row.contextCount}`,
    `  retrievedCategories: ${categoriesText}`,
    `  answerPresent: ${row.answerPresent}`,
    `  answerLength: ${row.answerLength}`,
    `  riskFlags: ${riskText}`,
    `  answerPreview: ${answerText}`
  ].join('\n');
}

async function main() {
  const rows = [];

  for (const testCase of CASES) {
    try {
      rows.push(await runCase(testCase));
    } catch (error) {
      rows.push({
        label: testCase.label,
        family: testCase.family,
        category: testCase.category,
        question: testCase.question,
        success: false,
        source: 'error',
        answerPresent: false,
        answerLength: 0,
        confidenceScore: null,
        topScore: null,
        contextCount: 0,
        retrievedCategories: [],
        riskFlags: ['execution_error'],
        answerPreview: String(error && error.message ? error.message : error),
        debug: null
      });
    }
  }

  const academicRows = rows.filter((row) => row.family === 'academic_rag');
  const weakAcademicRows = academicRows.filter((row) => row.riskFlags.length > 0);
  const controlRows = rows.filter((row) => row.family !== 'academic_rag');

  console.log('# Academic RAG Audit');
  console.log('');
  console.log(`Top K: ${DEFAULT_TOP_K}`);
  console.log(`Academic rows: ${academicRows.length}`);
  console.log(`Control rows: ${controlRows.length}`);
  console.log('');

  for (const row of rows) {
    console.log(formatRow(row));
    console.log('');
  }

  if (weakAcademicRows.length === 0) {
    console.log('Verdict: academic rows are answer-bearing and retrieval-backed under the current sample set.');
  } else {
    console.log('Verdict: some academic rows still need review.');
    console.log(`Weak academic rows: ${weakAcademicRows.map((row) => row.label).join(', ')}`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    topK: DEFAULT_TOP_K,
    rows,
    summary: {
      academicRows: academicRows.length,
      controlRows: controlRows.length,
      weakAcademicRows: weakAcademicRows.map((row) => row.label)
    }
  };

  if (process.env.RAG_AUDIT_JSON_PATH) {
    const fs = require('fs');
    const path = require('path');
    const outputPath = path.resolve(String(process.env.RAG_AUDIT_JSON_PATH));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});