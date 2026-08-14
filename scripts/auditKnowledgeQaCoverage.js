/* eslint-disable no-console */

/**
 * Audit FAQ/QNA answer coverage across active TrainingData documents.
 *
 * It extracts FAQ/QNA pairs from active documents, asks the bot runtime the
 * extracted questions, and reports which documents are ready, weak, or need
 * review. This is a QA gate for old and new knowledge, not a handler patch.
 */

const fs = require('fs');
const path = require('path');
const {
  deriveQueryMetadataConstraints,
  applyKnowledgeMetadataHardGate
} = require('../src/engine/hardMetadataGates');

process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS || 'false';

function parseArgs(argv) {
  const out = { flags: new Set(), values: {} };
  const booleanFlags = new Set(['prod', 'includeInactive', 'json', 'failOnWeak', 'allowDbDown']);
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    const rawKey = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    const inlineValue = eq >= 0 ? a.slice(eq + 1) : '';
    if (booleanFlags.has(rawKey)) {
      out.flags.add(rawKey);
      continue;
    }
    if (inlineValue) {
      out.values[rawKey] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out.flags.add(rawKey);
    else {
      out.values[rawKey] = next;
      i += 1;
    }
  }
  return out;
}

function resolveFromProjectRoot(projectRoot, value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  return path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
}

function pickEnvPath(projectRoot, forceProd) {
  if (process.env.DOTENV_CONFIG_PATH) return resolveFromProjectRoot(projectRoot, process.env.DOTENV_CONFIG_PATH);
  const isProd = forceProd || String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (!isProd) return resolveFromProjectRoot(projectRoot, '.env');
  if (fs.existsSync(resolveFromProjectRoot(projectRoot, '.env.production.local'))) return resolveFromProjectRoot(projectRoot, '.env.production.local');
  return resolveFromProjectRoot(projectRoot, '.env.production');
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return compact(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s{2,}/g, ' ').trim();
}

function stripLabels(value) {
  return compact(value)
    .replace(/^\s*(?:q|tanya|pertanyaan|question|faq)\s*[:.\-]\s*/i, '')
    .replace(/^\s*(?:a|jawab|jawaban|answer)\s*[:.\-]\s*/i, '')
    .trim();
}

function uniqueByQuestion(pairs, max) {
  const seen = new Set();
  const out = [];
  for (const pair of pairs) {
    const question = compact(pair && pair.question);
    const answer = compact(pair && pair.answer);
    if (!question || !answer) continue;
    const key = normalize(question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ question, answer });
    if (out.length >= max) break;
  }
  return out;
}

function extractFaqPairs(content) {
  const text = String(content || '').replace(/\u00a0/g, ' ');
  const pairs = [];
  const labelPattern = /(?:^|\n|\r|\s)(?:(?:q|tanya|pertanyaan|question)\s*[:.\-]\s*)([^?\n\r]{4,240}\?)\s*(?:(?:a|jawab|jawaban|answer)\s*[:.\-]\s*)([\s\S]*?)(?=(?:\n|\r|\s)(?:(?:q|tanya|pertanyaan|question)\s*[:.\-]\s*)[^?\n\r]{4,240}\?|$)/gi;
  let match;
  while ((match = labelPattern.exec(text)) !== null) {
    const question = stripLabels(match[1]);
    const answer = stripLabels(match[2]).replace(/\s+(?:q|tanya|pertanyaan|question)\s*[:.\-]\s*$/i, '').trim();
    if (question.length >= 8 && answer.length >= 8) pairs.push({ question, answer });
  }
  const flat = text.replace(/\s+/g, ' ').trim();
  const questionPattern = /((?:apa\s+saja|apa|apakah|pakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|siapa|mengapa|kenapa)\b[^?]{4,240}\?)/gi;
  const markers = [];
  while ((match = questionPattern.exec(flat)) !== null) {
    markers.push({ question: stripLabels(match[1]), start: match.index, end: match.index + match[1].length });
  }
  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const nextStart = markers[i + 1] ? markers[i + 1].start : flat.length;
    const answer = stripLabels(flat.slice(current.end, nextStart))
      .replace(/^\s*(?:a|jawab|jawaban|answer)\s*[:.\-]\s*/i, '')
      .trim();
    if (current.question.length >= 8 && answer.length >= 8) pairs.push({ question: current.question, answer });
  }
  return uniqueByQuestion(pairs, 200);
}

function getExpectedTerms(pair) {
  const answer = normalize(pair.answer);
  const candidates = answer.split(/\s+/).filter((term) => {
    if (!term || term.length < 4) return false;
    if (/^\d+$/.test(term)) return false;
    return !/^(yang|dan|atau|dari|untuk|dengan|pada|dalam|adalah|merupakan|akan|dapat|bisa|mahasiswa|program|stikom|bali|kampus|kakak|informasi|terkait|sebagai|bagian|secara)$/.test(term);
  });
  return Array.from(new Set(candidates)).slice(0, 8);
}

function evaluateAnswer(pair, result) {
  const answer = compact(result && result.answer);
  const source = String(result && result.source ? result.source : '');
  const contexts = result && Array.isArray(result.contexts) ? result.contexts : [];
  const constraints = deriveQueryMetadataConstraints(pair && pair.question, {});
  const wrongDomain = constraints.strict && contexts.length > 0 && contexts.every((ctx) => !applyKnowledgeMetadataHardGate(ctx, constraints).pass);
  const expectedTerms = getExpectedTerms(pair);
  const answerNorm = normalize(answer);
  const hits = expectedTerms.filter((term) => answerNorm.includes(term));
  const weakAnswer = !answer
    || /meaning-mismatch|preflight-blocked|no-context|unanswerable|insufficient|no-data/i.test(source)
    || /\b(?:mohon maaf|belum menemukan data|belum mempunyai jawaban|tidak mempunyai jawaban|tidak cukup aman)\b/i.test(answer);
  const hitRatio = expectedTerms.length ? hits.length / expectedTerms.length : 1;
  const ok = !weakAnswer && !wrongDomain && (expectedTerms.length < 3 || hitRatio >= 0.25);
  return {
    ok,
    source,
    wrongDomain,
    hitRatio: Number(hitRatio.toFixed(2)),
    expectedTerms,
    matchedTerms: hits,
    answerPreview: answer.slice(0, 260)
  };
}

function isNonPublicAuditDoc(row) {
  const filename = normalize(row && row.filename);
  const content = normalize(row && row.content).slice(0, 4000);
  const haystack = `${filename} ${content}`;
  return /\b(?:form\s+iku|iku\s+pts|lldikti|indikator\s+kinerja\s+utama|borang|akreditasi\s+institusi|audit\s+mutu|laporan\s+kinerja|perjanjian\s+kerja\s+sama|nota\s+kesepahaman|surat\s+keputusan|sk\s+pembina|analisis\s+jabatan)\b/i.test(haystack)
    || /\b(?:menimbang|mengingat|memutuskan|pasal\s+\d+|pihak\s+pertama|pihak\s+kedua|ditetapkan\s+di)\b/i.test(haystack);
}
function summarizeDoc(row, pairs, results, options = {}) {
  const failed = results.filter((item) => !item.ok);
  const answered = results.length - failed.length;
  const coverage = results.length ? answered / results.length : null;
  const reviewReasons = [];
  if (options.nonPublic) reviewReasons.push('non_public_or_governance_document');
  else if (!pairs.length) reviewReasons.push('no_faq_qna_pairs_detected');
  if (results.some((item) => item.wrongDomain)) reviewReasons.push('wrong_domain_evidence_detected');
  if (results.length && coverage < 0.8) reviewReasons.push('runtime_answer_coverage_below_80_percent');
  if (String(row.ragIngestStatus || '').toLowerCase() !== 'success') reviewReasons.push('rag_ingest_status_not_success');
  return {
    id: row.id,
    filename: row.filename,
    divisionKey: row.divisionKey || null,
    active: row.active,
    ragIngestStatus: row.ragIngestStatus || 'unknown',
    contentLength: row.content ? String(row.content).length : 0,
    faqPairsDetected: pairs.length,
    sampledQuestions: results.length,
    answered,
    failed: failed.length,
    coverage: coverage == null ? null : Number(coverage.toFixed(2)),
    status: options.nonPublic ? 'skipped_review' : (reviewReasons.length ? 'review_required' : 'ready'),
    reviewReasons,
    failures: failed.slice(0, 10)
  };
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const args = parseArgs(process.argv);
  const envPath = pickEnvPath(projectRoot, args.flags.has('prod'));
  require('dotenv').config({ path: envPath, quiet: true, override: true });
  const limit = Math.max(1, Math.min(parseInt(args.values.limit || '500', 10) || 500, 5000));
  const perDoc = Math.max(1, Math.min(parseInt(args.values.perDoc || '5', 10) || 5, 25));
  const includeInactive = args.flags.has('includeInactive');
  const outPath = args.values.out ? resolveFromProjectRoot(projectRoot, args.values.out) : null;
  const jsonMode = args.flags.has('json') || Boolean(outPath);
  const failOnWeak = args.flags.has('failOnWeak');
  const prisma = require('../src/db');
  const { querySemanticRag } = require('../src/engine/semanticRagEngine');
  let rows;
  try {
    rows = await prisma.trainingData.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, filename: true, divisionKey: true, active: true, content: true, ragIngestStatus: true, updatedAt: true }
    });
  } catch (err) {
    const report = { ok: false, envPath, dbError: err && err.message ? err.message : String(err) };
    console.log(JSON.stringify(report, null, 2));
    try { await prisma.$disconnect(); } catch (_) {}
    if (!args.flags.has('allowDbDown')) process.exitCode = 1;
    return;
  }
  const docs = [];
  let testedQuestions = 0;
  let failedQuestions = 0;
  let docsWithFaq = 0;
  for (const row of rows) {
    const nonPublic = isNonPublicAuditDoc(row);
    const pairs = nonPublic ? [] : extractFaqPairs(row.content).slice(0, perDoc);
    if (pairs.length) docsWithFaq += 1;
    const results = [];
    for (const pair of pairs) {
      const result = await querySemanticRag(pair.question, {
        topK: 8,
        mode: 'knowledge-qa-audit',
        chatId: 'knowledge-qa:' + row.id + ':' + normalize(pair.question).slice(0, 80),
        sessionData: {},
        intentHint: ''
      });
      const evaluated = evaluateAnswer(pair, result);
      results.push({ question: pair.question, expectedAnswerPreview: compact(pair.answer).slice(0, 220), ...evaluated });
      testedQuestions += 1;
      if (!evaluated.ok) failedQuestions += 1;
    }
    docs.push(summarizeDoc(row, pairs, results, { nonPublic }));
  }
  const reviewDocs = docs.filter((doc) => doc.status === 'review_required' || doc.status === 'skipped_review');
  const failedDocs = docs.filter((doc) => doc.failed > 0);
  const report = {
    ok: failedQuestions === 0,
    generatedAt: new Date().toISOString(),
    envPath,
    filters: { includeInactive, limit, perDoc },
    summary: {
      scannedDocuments: rows.length,
      documentsWithFaqQna: docsWithFaq,
      testedQuestions,
      answeredQuestions: testedQuestions - failedQuestions,
      failedQuestions,
      readyDocuments: docs.length - reviewDocs.length,
      reviewRequiredDocuments: reviewDocs.length,
      failedCoverageDocuments: failedDocs.length
    },
    reviewRequiredDocuments: reviewDocs,
    failedCoverageDocuments: failedDocs,
    documents: docs
  };
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  }
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('KNOWLEDGE QA AUDIT');
    console.log('Scanned documents: ' + report.summary.scannedDocuments);
    console.log('Documents with FAQ/QNA: ' + report.summary.documentsWithFaqQna);
    console.log('Tested questions: ' + report.summary.testedQuestions);
    console.log('Answered: ' + report.summary.answeredQuestions + ', failed: ' + report.summary.failedQuestions);
    console.log('Ready docs: ' + report.summary.readyDocuments + ', review required: ' + report.summary.reviewRequiredDocuments);
    if (failedDocs.length) {
      console.log('\nFailed coverage documents:');
      for (const doc of failedDocs.slice(0, 20)) {
        console.log('- ' + doc.filename + ' | coverage=' + doc.coverage + ' | failed=' + doc.failed + '/' + doc.sampledQuestions);
      }
    }
    if (outPath) console.log('\nReport written to ' + outPath);
  }
  try { await prisma.$disconnect(); } catch (_) {}
  if (failOnWeak && failedQuestions > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('AUDIT_KNOWLEDGE_QA_COVERAGE_ERROR', err && err.message ? err.message : String(err));
  process.exitCode = 1;
});
