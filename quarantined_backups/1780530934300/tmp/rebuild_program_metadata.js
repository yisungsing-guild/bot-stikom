const fs = require('fs');
const rag = require('../src/engine/ragEngine');

const indexPath = rag.getIndexPath();
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

const VALID_PROGRAMS = new Set([
  'SI',
  'TI',
  'BD',
  'SK',
  'MI',
  'DKV',
  'TRPL',
  'TK',
  'MM',
  'AN',
  'DG',
  'RPL'
]);

let filled = 0;
let invalidFound = 0;
let repaired = 0;
let updatedAliases = 0;

for (const item of index) {
  if (!item || typeof item !== 'object') continue;
  const chunk = String(item.chunk || '');
  const structured = rag.extractStructuredChunkMetadata(chunk);
  const currentProgram = item.program ? String(item.program).trim() : null;
  const hasValidProgram = currentProgram && VALID_PROGRAMS.has(currentProgram);

  if (currentProgram && !hasValidProgram) {
    invalidFound += 1;
    item.program = null;
  }

  const validStructuredPrograms = [];
  if (structured.program && VALID_PROGRAMS.has(structured.program)) validStructuredPrograms.push(structured.program);
  if (Array.isArray(structured.programAliases)) {
    for (const alias of structured.programAliases) {
      const normalizedAlias = String(alias || '').trim().toUpperCase();
      if (VALID_PROGRAMS.has(normalizedAlias)) validStructuredPrograms.push(normalizedAlias);
    }
  }
  const structuredProgram = validStructuredPrograms.length > 0 ? validStructuredPrograms[0] : null;
  const normalizedProgram = rag.normalizeProgramLabel(chunk);
  const detectedProgram = structuredProgram || (normalizedProgram && VALID_PROGRAMS.has(normalizedProgram) ? normalizedProgram : null);

  if (!item.program && detectedProgram) {
    item.program = detectedProgram;
    filled += 1;
    if (currentProgram && !hasValidProgram) repaired += 1;
  }

  let validAliases = Array.isArray(item.programAliases)
    ? item.programAliases.map((alias) => String(alias || '').trim().toUpperCase()).filter((alias) => VALID_PROGRAMS.has(alias))
    : [];
  if (!Array.isArray(validAliases)) validAliases = [];

  const structuredValidAliases = Array.isArray(structured.programAliases)
    ? structured.programAliases.map((alias) => String(alias || '').trim().toUpperCase()).filter((alias) => VALID_PROGRAMS.has(alias))
    : [];

  if (structuredValidAliases.length > 0 && validAliases.length === 0) {
    item.programAliases = structuredValidAliases;
    updatedAliases += 1;
  } else if (validAliases.length > 0) {
    if (!Array.isArray(item.programAliases) || item.programAliases.length !== validAliases.length || item.programAliases.some((alias) => !VALID_PROGRAMS.has(String(alias || '').trim().toUpperCase()))) {
      item.programAliases = validAliases;
    }
  } else if (Array.isArray(item.programAliases) && item.programAliases.length > 0) {
    item.programAliases = [];
  }

  if (!item.programName && structured.programName) {
    item.programName = structured.programName;
  }

  if (!item.sectionTitle && structured.sectionTitle) {
    item.sectionTitle = structured.sectionTitle;
  }
}

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
console.log(JSON.stringify({ indexPath, total: index.length, filled, invalidFound, repaired, updatedAliases }, null, 2));
