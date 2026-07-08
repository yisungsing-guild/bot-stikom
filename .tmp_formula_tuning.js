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
  const attributeScore = exactBoost;
  return semanticBoost + evidenceScore + attributeScore + metadataBoost + otherBoosts;
}

function formatRow(rankItem) {
  return `${rankItem.rank}. ${rankItem.id} | ${rankItem.filename} | ${rankItem.category || 'NONE'} | score=${rankItem.score.toFixed(4)} | sem=${rankItem.semantic.toFixed(4)} | meta=${rankItem.meta.toFixed(4)} | evidence=${rankItem.evidence.toFixed(3)} | exact=${rankItem.exact.toFixed(3)} | other=${rankItem.other.toFixed(3)}`;
}

const baselineRanks = {};
const results = [];

for (const q of data) {
  const baseline = q.top20.map((entry, idx) => ({
    id: entry.item.id,
    filename: entry.filename || entry.item.filename || entry.item.trainingId || 'unknown',
    category: entry.docCategory || entry.item.docCategory || entry.item.category || 'NONE',
    semantic: entry.scoreComponents.semantic || 0,
    meta: entry.scoreComponents.metadataBoost || 0,
    evidence: entry.scoreComponents.evidenceScore || 0,
    exact: entry.scoreComponents.exactBoost || 0,
    other: entry.scoreComponents.otherBoosts || 0,
    score: score(entry, 0.10, 1.0),
    rank: idx + 1,
  }));
  baselineRanks[q.question] = baseline.map((item) => item.id);

  for (const scenario of scenarios) {
    const ranked = q.top20.map((entry) => ({
      id: entry.item.id,
      filename: entry.filename || entry.item.filename || entry.item.trainingId || 'unknown',
      category: entry.docCategory || entry.item.docCategory || entry.item.category || 'NONE',
      semantic: entry.scoreComponents.semantic || 0,
      meta: entry.scoreComponents.metadataBoost || 0,
      evidence: entry.scoreComponents.evidenceScore || 0,
      exact: entry.scoreComponents.exactBoost || 0,
      other: entry.scoreComponents.otherBoosts || 0,
      score: score(entry, scenario.semScale, scenario.metaScale),
      originalRank: null,
    })).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id));

    ranked.forEach((item, idx) => item.rank = idx+1);
    ranked.forEach((item) => item.originalRank = baselineRanks[q.question].indexOf(item.id) + 1);

    const top10 = ranked.slice(0, 10);
    const changes = top10.map((item) => ({ id: item.id, filename: item.filename, originalRank: item.originalRank, newRank: item.rank, delta: item.originalRank - item.rank }));
    const semanticTop = ranked.reduce((best, item) => item.semantic > best.semantic ? item : best, {semantic:-Infinity});
    const semanticHighMoved = semanticTop.originalRank > semanticTop.rank;
    const candidateHigh = ranked.find((item) => item.id === semanticTop.id);
    const improvedQuery = q.question === 'Apa keunggulan Sistem Informasi?' ? {
      top1Changed: top10[0].id !== baseline[0].id,
      top1Id: top10[0].id,
      baselineTop1Id: baseline[0].id,
      semanticHighId: semanticTop.id,
      semanticHighRank: semanticTop.rank,
      baselineSemanticHighRank: semanticTop.originalRank,
      semanticHighMovedUp: semanticHighMoved
    } : null;

    results.push({
      question: q.question,
      scenario,
      top10,
      changes,
      semanticTop,
      semanticHighMoved,
      improvedQuery,
      baselineTop1Id: baseline[0].id,
    });
  }
}

const out = [];
for (const question of [...new Set(results.map(r => r.question))]) {
  out.push('='.repeat(120));
  out.push(`QUESTION: ${question}`);
  for (const scenario of scenarios) {
    const entry = results.find(r => r.question === question && r.scenario.id === scenario.id);
    out.push(`\nSCENARIO: ${scenario.label}`);
    entry.top10.forEach((item) => out.push(formatRow(item)));
    out.push('\nTop10 position changes (new rank vs baseline):');
    entry.changes.forEach((c) => out.push(`${c.newRank}. ${c.filename} (${c.id}) from ${c.originalRank} -> ${c.newRank} (Δ${c.delta})`));
    if (entry.improvedQuery) {
      out.push(`\n-- QUERY IMPACT for 'Apa keunggulan Sistem Informasi?' --`);
      out.push(`Baseline top1 id: ${entry.improvedQuery.baselineTop1Id}`);
      out.push(`Scenario top1 id: ${entry.improvedQuery.top1Id}`);
      out.push(`High semantic chunk id: ${entry.improvedQuery.semanticHighId}`);
      out.push(`High semantic rank: ${entry.improvedQuery.semanticHighRank} (baseline ${entry.improvedQuery.baselineSemanticHighRank})`);
      out.push(`High semantic moved up? ${entry.improvedQuery.semanticHighMoved}`);
      out.push(`Top1 changed? ${entry.improvedQuery.top1Changed}`);
    }
    out.push('');
  }
}

out.push('='.repeat(120));
fs.writeFileSync('.tmp_formula_tuning_output.txt', out.join('\n'), 'utf8');
console.log('Simulation complete. Output written to .tmp_formula_tuning_output.txt');
