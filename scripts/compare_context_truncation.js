const path = require('path');
const { queryScoped } = require(path.resolve(__dirname, '..', 'src', 'engine', 'ragScoped.js'));
const { selectEvidenceFromContexts } = require(path.resolve(__dirname, '..', 'src', 'engine', 'evidenceSelector.js'));
const curBuilder = require(path.resolve(__dirname, '..', 'src', 'engine', 'evidenceSelector.js')).buildSelectedEvidenceContext;
const safe = require(path.resolve(__dirname, '..', 'src', 'utils', 'contextTruncation.js'));

const QUERIES = [
  'rincian biaya kuliah',
  'berapa biaya pendaftaran',
  'biaya mahasiswa baru',
  'biaya UKT semester 1',
  'potongan biaya pendaftaran',
  'apa syarat KIP'
];

function stableEvidenceId(item) {
  if (!item) return null;
  return item.id || item.sourceId || item.chunkId || item.trainingId || null;
}

function countCurrencyTokens(text) {
  if (!text) return 0;
  return (String(text).match(/Rp\.?\s*\d[\d.,]*/gi) || []).length;
}
function countPartialCurrency(text) {
  if (!text) return 0;
  return (String(text).match(/Rp\.?\s*\d+[.,]$/gi) || []).length;
}
function countPartialNumeric(text) {
  if (!text) return 0;
  return (String(text).match(/\b\d[\d,.]*[.,]$/g) || []).length;
}
function countPartialTableRows(text) {
  if (!text) return 0;
  return (String(text).match(/\|[^\n]*Rp\.?\s*\d+[.,][^\n]*$/gi) || []).length;
}
function countCompleteMarkers(text) {
  if (!text) return 0;
  const matches = String(text).match(/\[E\d+\]\s*Sumber:\s*[\s\S]*?Evidence:/g);
  return matches ? matches.length : 0;
}

function sameArray(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function buildSelectedEvidence(selectedEvidence) {
  return selectedEvidence.map((item) => ({
    id: stableEvidenceId(item),
    sourceId: item.sourceId || null,
    chunkId: item.chunkId || null,
    trainingId: item.trainingId || null
  }));
}

(async () => {
  const report = [];
  for (const query of QUERIES) {
    const scopedResult = await queryScoped({ query, category: 'tuition_fee', topK: 8, options: { explicitDomain: false } });
    const retrievalPath = scopedResult && scopedResult.debug && scopedResult.debug.retrievalPath ? scopedResult.debug.retrievalPath : 'unknown';
    const localDomainRetrievalUsed = !!(scopedResult && scopedResult.debug && scopedResult.debug.localDomainRetrievalUsed);
    const contexts = Array.isArray(scopedResult.contexts) ? scopedResult.contexts : [];
    const selectedEvidence = selectEvidenceFromContexts({ question: query, contexts, intent: '', maxEvidence: 5 });
    const selectedSnapshot = JSON.parse(JSON.stringify(selectedEvidence));
    const currentContext = curBuilder(selectedEvidence, 9000);
    const proposedContext = safe.buildSelectedEvidenceContextSafe(selectedEvidence, 9000);
    const currentIds = selectedEvidence.map(stableEvidenceId).filter(Boolean);
    const proposedIds = selectedEvidence.map(stableEvidenceId).filter(Boolean);
    const entry = {
      query,
      retrievalPath,
      localDomainRetrievalUsed,
      selectedEvidenceCount: selectedEvidence.length,
      currentContextChars: currentContext.length,
      proposedContextChars: proposedContext.length,
      currentEvidenceIds: currentIds,
      proposedEvidenceIds: proposedIds,
      sameEvidenceIds: sameArray(currentIds, proposedIds),
      sameOrder: sameArray(currentIds, proposedIds),
      currentCurrencyTokenCount: countCurrencyTokens(currentContext),
      proposedCurrencyTokenCount: countCurrencyTokens(proposedContext),
      currentPartialCurrencyCount: countPartialCurrency(currentContext),
      proposedPartialCurrencyCount: countPartialCurrency(proposedContext),
      currentPartialNumericCount: countPartialNumeric(currentContext),
      proposedPartialNumericCount: countPartialNumeric(proposedContext),
      currentPartialTableRowCount: countPartialTableRows(currentContext),
      proposedPartialTableRowCount: countPartialTableRows(proposedContext),
      currentMarkerCount: countCompleteMarkers(currentContext),
      proposedMarkerCount: countCompleteMarkers(proposedContext),
      currentWithinBudget: currentContext.length <= 9000,
      proposedWithinBudget: proposedContext.length <= 9000,
      inputMutated: JSON.stringify(selectedEvidence) !== JSON.stringify(selectedSnapshot)
    };
    report.push(entry);
  }
  console.log(JSON.stringify(report, null, 2));
})();
