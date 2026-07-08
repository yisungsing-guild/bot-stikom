const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '.tmp_retrieval_results.json'), 'utf8'));
const lines = [];

lines.push('# RETRIEVAL BASELINE BEFORE PATCH');
lines.push('');
lines.push('## Context');
lines.push('');
lines.push('- Dataset: existing `.tmp_retrieval_results.json` baseline audit for 4 academic queries.');
lines.push('- Current scoring formula is the production formula before patch.');
lines.push('- Patch candidate: increase semantic contribution from `0.10` to `0.25` while leaving metadata boosts unchanged.');
lines.push('');
lines.push('## Current Scoring Formula (baseline)');
lines.push('');
lines.push('- `semanticBoost = semantic * 0.10`');
lines.push('- `evidenceScore = keywordScore * 0.18`');
lines.push('- `attributeScore = exactBoost`');
lines.push('- `metadataBoost` is calculated from program match, academic year, wave, partner, campus, program mode, fee type, category match, intent-category boosts, and program-related metadata signals.');
lines.push('- `otherBoosts` includes chunk type signal, category signal, trust boost, penalties, and intent-specific quality adjustments.');
lines.push('- `rawScore = semanticBoost + evidenceScore + attributeScore + metadataBoost + otherBoosts`; `finalScore` is clamped to [-1,1].');
lines.push('');
lines.push('## Baseline Candidate A');
lines.push('');
lines.push('- Minimal targeted patch: change only the semantic weight from `0.10` to `0.25`.');
lines.push('- Rationale: preserve metadata-based program/intent boosts while making semantic similarity more influential.');
lines.push('- This is the lowest-risk formula change to correct cases where strong semantic matches are underweighted.');
lines.push('');

function itemLabel(entry) {
  const item = entry.item;
  return `${item.filename || item.trainingId || item.id || 'unknown'} (${item.docCategory || item.category || 'NONE'} / ${item.chunkType || 'N/A'})`;
}

for (const query of data) {
  const top20 = Array.isArray(query.top20) ? query.top20 : [];
  const top1 = top20[0];
  const highestSemantic = top20.reduce((best, entry, idx) => {
    const sem = entry.scoreComponents && Number.isFinite(entry.scoreComponents.semantic) ? entry.scoreComponents.semantic : -Infinity;
    return sem > best.semantic ? { semantic: sem, rank: idx + 1, entry } : best;
  }, { semantic: -Infinity, rank: null, entry: null });

  lines.push(`## Query: ${query.question}`);
  lines.push('');
  lines.push(`- ` + `Retrieval query: \\`${query.queryForRetrieval}\\``);
  lines.push(`- Detected intent: \\`${query.intent}\\``);
  lines.push(`- User intent: \\`${query.userIntent}\\``);
  lines.push('');
  if (top1) {
    lines.push(`### Top 1 candidate`);
    lines.push('');
    lines.push(`- Rank 1: ${itemLabel(top1)} `);
    lines.push(`- Raw score: ${Number(top1.compositeScore || 0).toFixed(4)}`);
    lines.push(`- Semantic: ${Number(top1.scoreComponents.semantic || 0).toFixed(4)}`);
    lines.push(`- Semantic boost: ${Number(top1.scoreComponents.semanticBoost || 0).toFixed(4)}`);
    lines.push(`- Keyword/evidence: ${Number(top1.scoreComponents.evidenceScore || 0).toFixed(4)}`);
    lines.push(`- Metadata boost: ${Number(top1.scoreComponents.metadataBoost || 0).toFixed(4)}`);
    lines.push(`- Exact/attribute: ${Number(top1.scoreComponents.exactBoost || 0).toFixed(4)}`);
    lines.push(`- Other boosts/penalties: ${Number(top1.scoreComponents.otherBoosts || 0).toFixed(4)}`);
    lines.push('');
  }
  if (highestSemantic.entry) {
    lines.push(`- Highest semantic candidate rank: ${highestSemantic.rank}`);
    lines.push(`- Highest semantic score: ${highestSemantic.semantic.toFixed(4)}`);
    lines.push(`- Candidate: ${itemLabel(highestSemantic.entry)} `);
    lines.push('');
  }
  lines.push('### Top 10 candidates');
  lines.push('');
  lines.push('| Rank | Candidate | Doc Category | Chunk Type | Score | Semantic | Metadata | Exact | Other |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (let i = 0; i < Math.min(10, top20.length); i++) {
    const entry = top20[i];
    const c = entry.scoreComponents || {};
    const label = itemLabel(entry);
    lines.push(`| ${i + 1} | ${label} | ${entry.item.docCategory || entry.item.category || 'NONE'} | ${entry.item.chunkType || 'N/A'} | ${Number(entry.compositeScore || 0).toFixed(4)} | ${Number(c.semantic || 0).toFixed(4)} | ${Number(c.metadataBoost || 0).toFixed(4)} | ${Number(c.exactBoost || 0).toFixed(4)} | ${Number(c.otherBoosts || 0).toFixed(4)} |`);
  }
  lines.push('');
}

fs.writeFileSync(path.join(__dirname, 'RETRIEVAL_BASELINE_BEFORE_PATCH.md'), lines.join('\n'), 'utf8');
console.log('RETRIEVAL_BASELINE_BEFORE_PATCH.md generated');
