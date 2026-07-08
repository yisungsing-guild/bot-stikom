const fs = require('fs');
const data = JSON.parse(fs.readFileSync('.tmp_retrieval_results.json', 'utf8'));

const scenarios = [
  { id: 'current', label: 'Current', semScale: 0.10, metaScale: 1.00 },
  { id: 'S0.25_M100', label: 'Semantic x0.25, Metadata 100%', semScale: 0.25, metaScale: 1.00 },
  { id: 'S0.50_M100', label: 'Semantic x0.50, Metadata 100%', semScale: 0.50, metaScale: 1.00 },
  { id: 'S1.00_M100', label: 'Semantic x1.00, Metadata 100%', semScale: 1.00, metaScale: 1.00 },
  { id: 'S0.25_M75', label: 'Semantic x0.25, Metadata 75%', semScale: 0.25, metaScale: 0.75 },
  { id: 'S0.50_M75', label: 'Semantic x0.50, Metadata 75%', semScale: 0.50, metaScale: 0.75 },
  { id: 'S1.00_M75', label: 'Semantic x1.00, Metadata 75%', semScale: 1.00, metaScale: 0.75 },
  { id: 'S0.25_M50', label: 'Semantic x0.25, Metadata 50%', semScale: 0.25, metaScale: 0.50 },
  { id: 'S0.50_M50', label: 'Semantic x0.50, Metadata 50%', semScale: 0.50, metaScale: 0.50 },
  { id: 'S1.00_M50', label: 'Semantic x1.00, Metadata 50%', semScale: 1.00, metaScale: 0.50 },
  { id: 'S0.25_M25', label: 'Semantic x0.25, Metadata 25%', semScale: 0.25, metaScale: 0.25 },
  { id: 'S0.50_M25', label: 'Semantic x0.50, Metadata 25%', semScale: 0.50, metaScale: 0.25 },
  { id: 'S1.00_M25', label: 'Semantic x1.00, Metadata 25%', semScale: 1.00, metaScale: 0.25 }
];

function score(entry, semScale, metaScale) {
  const c = entry.scoreComponents;
  const semanticBoost = (Number.isFinite(c.semantic) ? c.semantic : 0) * semScale;
  const evidenceScore = Number.isFinite(c.evidenceScore) ? c.evidenceScore : 0;
  const metadataBoost = Number.isFinite(c.metadataBoost) ? c.metadataBoost * metaScale : 0;
  const otherBoosts = Number.isFinite(c.otherBoosts) ? c.otherBoosts : 0;
  const exactBoost = Number.isFinite(c.exactBoost) ? c.exactBoost : 0;
  return semanticBoost + evidenceScore + exactBoost + metadataBoost + otherBoosts;
}

function summarizeQuery(q) {
  const base = q.top20.map((entry, idx) => ({ id: entry.item.id, rank: idx + 1 }));
  const table = [];
  const baselineTop1 = base[0].id;
  const semanticHigh = q.top20.reduce((best, entry, idx) => {
    const sem = entry.scoreComponents.semantic || 0;
    return sem > best.semantic ? { semantic: sem, id: entry.item.id, baselineRank: idx + 1 } : best;
  }, { semantic: -Infinity, id: null, baselineRank: null });
  for (const scenario of scenarios) {
    const ranked = q.top20.map((entry) => {
      const s = score(entry, scenario.semScale, scenario.metaScale);
      return { id: entry.item.id, filename: entry.filename || entry.item.filename || entry.item.trainingId || 'unknown', score: s, semantic: entry.scoreComponents.semantic || 0, evidence: entry.scoreComponents.evidenceScore || 0, meta: entry.scoreComponents.metadataBoost || 0, exact: entry.scoreComponents.exactBoost || 0, other: entry.scoreComponents.otherBoosts || 0 };
    }).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id));
    const top10 = ranked.slice(0, 10);
    const changedTop1 = top10[0].id !== baselineTop1;
    const movesInTop10 = top10.filter(item => base.find(b => b.id === item.id).rank !== item.id).length;
    const totalTop10Moves = top10.reduce((acc, item) => {
      const baseRank = base.find(b => b.id === item.id).rank;
      return acc + (baseRank !== item.rank);
    }, 0);
    const sm = ranked.find(item => item.id === semanticHigh.id);
    const semanticHighMovedUp = sm ? semanticHigh.baselineRank > ranked.indexOf(sm) + 1 : false;
    table.push({ scenario: scenario.label, top1: top10[0].filename, top1Id: top10[0].id, changedTop1, top10MoveCount: totalTop10Moves, semanticHighRank: ranked.findIndex(item => item.id === semanticHigh.id) + 1, semanticHighMovedUp });
  }
  return { question: q.question, baselineTop1, semanticHigh, table };
}

const all = data.map(summarizeQuery);
const lines = [];
lines.push('Scenario\tQuery\tTop1Changed\tTop1Id\tHighSemanticRank\tHighSemanticMovedUp\tTop10Moves');
for (const query of all) {
  for (const row of query.table) {
    lines.push(`${row.scenario}\t${query.question}\t${row.changedTop1}\t${row.top1Id}\t${row.semanticHighRank}\t${row.semanticHighMovedUp}\t${row.top10MoveCount}`);
  }
}
fs.writeFileSync('.tmp_formula_summary.tsv', lines.join('\n'), 'utf8');
console.log('Summary written to .tmp_formula_summary.tsv');
