# Code Reference Guide — Root Cause Locations

**For Manual Verification and Implementation Planning**

---

## File: `src/engine/ragEngine.js`

### Function: `filterRelevantChunks()`

**Location**: Lines 4889-4968
**Purpose**: Filter chunks based on program, intent, and category matching

**Key Code Segments**:

#### Segment 1: Query Entity Extraction (L4895-4900)
```javascript
const requestedProgram = queryEntities && queryEntities.program 
  ? String(queryEntities.program).toUpperCase() 
  : null;
const intent = queryEntities && queryEntities.intent ? String(queryEntities.intent).toUpperCase() : null;
const requestedCategory = queryEntities && queryEntities.category ? String(queryEntities.category) : null;
```

**Purpose**: Extract requested program/intent/category from query
**In Audit**: Sets `requestedProgram = "SI"` for all 4 queries

---

#### Segment 2: Generic Overview Filtering (L4915-4950)
```javascript
// Line ~4920
const isGenericProgramOverviewChunk = (item) => {
  const fname = String((item && (item.filename || item.trainingId)) || '').toLowerCase();
  const overviewPattern = /\b(?:penjelasan\s+semua\s+program\s+studi|semua\s+program\s+studi|all\s+programs|...)/i;
  return overviewPattern.test(fname) || overviewPattern.test(chunkText.toLowerCase());
};

if (isGenericProgramOverviewChunk(s.item)) {
  // Marked for filtering when requestedProgram is set
  hasGenericOverview = true;
}
```

**Purpose**: Detect and flag all-programs documents
**In Audit**: Filters chunk 618a0474 ("Penjelasan Semua Program Studi.pdf")

---

#### Segment 3: Intent-Based Keyword Filtering (L4915-4920)
```javascript
// Line ~4916
if (intent !== 'COST' && costPattern.test(lower)) return false;

const programPattern = /\b(program|studi|sistem|informasi|prodi|...)\b/i;
if ((intent === 'PROGRAM' || intent === 'ACADEMIC_PROGRAM') && 
    !programPattern.test(lower) && 
    s.item.chunkType !== 'GENERAL') {
  return false;
}
```

**Purpose**: Remove chunks not matching intent-based patterns
**In Audit**: Filters chunks 5-8 (cost/hobby/schedule) from Queries 1-3

---

#### Segment 4: PRIMARY ROOT CAUSE — Program Mismatch (L4950-4960)
```javascript
// Line ~4954 ← CRITICAL ELIMINATION POINT
if (requestedProgram) {
  const itemEntities = getChunkEntities(s.item);
  const itemProgram = itemEntities.program ? String(itemEntities.program).toUpperCase() : null;
  const requestedProgramRegex = requestedProgramPatterns[requestedProgram];
  const mentionsRequestedProgram = requestedProgramRegex 
    ? requestedProgramRegex.test(lower) 
    : false;
  
  // ← HARD REJECT
  if (itemProgram && itemProgram !== requestedProgram) return false;  // Line 4956
  
  if (!mentionsRequestedProgram && !itemProgram) {
    // Additional check for explicit mention
    return false;
  }
}
```

**Purpose**: Hard-reject chunks with non-matching program
**In Audit**: 
- Line 4956 eliminates chunk 6631dfc1 (itemProgram="SK", requestedProgram="SI")
- Eliminates chunks 1, 2, 3 in Queries 1-3

---

#### Segment 5: Multi-Program Filtering (L4959-4965)
```javascript
// Line ~4959
const mentionedPrograms = Array.from(new Set(normalizeProgramMentions(lower)));
if (mentionedPrograms.length > 1 && 
    !mentionedPrograms.every((p) => p === requestedProgram)) {
  return false;  // Eliminate if multiple programs mentioned and not all match requested
}
```

**Purpose**: Remove chunks that discuss multiple programs
**In Audit**: May filter chunk b411e939 (mentions multiple Double Degree options)

---

### Function: `getChunkEntities()`

**Location**: Lines 4113-4215
**Purpose**: Extract program, wave, partner, campus, category from chunk

**Key Code Segments**:

#### Segment 1: Program Extraction (L4120-4140)
```javascript
// Line ~4125
const programMatch = chunkText.match(/\b(SK|SI|DKV|IK|KA|TG|TI|...)\b/i);
let program = null;

if (chunk.metadata && chunk.metadata.program) {
  program = String(chunk.metadata.program).toUpperCase();
} else if (chunk.filename) {
  // Extract from filename
  const fname = chunk.filename.toLowerCase();
  if (fname.includes('sistem komputer')) program = 'SK';
  if (fname.includes('sistem informasi')) program = 'SI';
  if (fname.includes('penjelasan prodi')) {
    // Infer from document name (SK mentioned first in files)
    program = 'SK';  // Default assumption
  }
}
```

**Purpose**: Extract program code from metadata or filename
**In Audit**:
- Chunk 6631dfc1 ("Penjelasan Prodi...SK..."): program = "SK"
- Chunk c2961b13 ("Double Degree"): program = "SI" (extracted from text)

---

#### Segment 2: Category Extraction (L4150-4170)
```javascript
// Line ~4160
const itemCategory = chunk.metadata && chunk.metadata.category 
  ? String(chunk.metadata.category).toLowerCase() 
  : categorizeChunkByContent(chunk);

// Categorization by content if metadata missing
const categorizeChunkByContent = (chunk) => {
  const text = chunk.text.toLowerCase();
  if (text.includes('biaya') || text.includes('ukt')) return 'BIAYA';
  if (text.includes('jadwal') || text.includes('gelombang')) return 'SCHEDULE';
  if (text.includes('mata kuliah') || text.includes('kurikulum')) return 'CURRICULUM';
  // ...etc
};
```

**Purpose**: Extract category (SK, BIAYA, SCHEDULE, etc.)
**In Audit**: Used in validation category matching

---

### Function: `applyIntentAwareFilteringAndValidation()`

**Location**: Lines 5011-5130
**Purpose**: Apply intent-specific validation, evidence checking, relevance checking

**Key Code Segments**:

#### Segment 1: Category Filtering (L5020-5040)
```javascript
// Line ~5025
const allowedDocCategories = getallowedCategoriesForIntent(userIntent);
// allowedDocCategories for DEFINISI_PRODI: ['PROGRAM_STUDI', 'SK', 'CURRICULUM', 'PROGRAM_KHUSUS']

const categoryMismatch = itemCategory && !allowedDocCategories.includes(itemCategory);

if (categoryMismatch) {
  // Log but don't hard-reject
  validationMetadata.categoryMismatch = true;
}
```

**Purpose**: Check if chunk category allowed for intent
**In Audit**: PROGRAM_KHUSUS allowed for all intents (permissive)

---

#### Segment 2: Evidence Validation (L5050-5080)
```javascript
// Line ~5060
const validateChunkEvidence = (chunk, intent) => {
  const evidenceMarkers = {
    'DEFINISI_PRODI': ['definisi prodi', 'program definition', 'apa itu', 'pengertian'],
    'PROSPEK_KERJA': ['prospek kerja', 'career prospect', 'alumni career', 'bidang kerja'],
    'MATA_KULIAH': ['mata kuliah', 'kurikulum', 'course', 'pembelajaran'],
    // ...etc
  };
  
  let evidenceCount = 0;
  evidenceMarkers[intent].forEach((marker) => {
    if (chunk.text.toLowerCase().includes(marker)) evidenceCount++;
  });
  
  return {
    hasEvidence: evidenceCount > 0,
    confidence: evidenceCount > 2 ? 'HIGH' : evidenceCount > 0 ? 'MEDIUM' : 'LOW'
  };
};

// Line ~5075
const evidenceResult = validateChunkEvidence(s, userIntent);
validationMetadata.evidenceConfidence = evidenceResult.confidence;

// NO hard-reject based on evidence
```

**Purpose**: Check chunk evidence for query intent
**In Audit**: Flags c2961b13 as LOW confidence, but continues (non-hard-reject)

---

#### Segment 3: Relevance Validation (L5090-5110)
```javascript
// Line ~5095
const validateChunkRelevanceToQuestion = (chunk, question) => {
  const questionKeywords = extractKeywords(question);
  const chunkKeywords = extractKeywords(chunk.text);
  const overlapScore = calculateKeywordOverlap(questionKeywords, chunkKeywords);
  
  return {
    score: overlapScore,
    verdict: overlapScore > RELEVANCE_THRESHOLD ? 'RELEVANT' : 'QUESTIONABLE'
  };
};

const relevanceResult = validateChunkRelevanceToQuestion(s, question);
validationMetadata.relevanceScore = relevanceResult.score;

// NO hard-reject based on relevance (can be added but currently not)
```

**Purpose**: Check semantic alignment between chunk and question
**In Audit**: May flag as QUESTIONABLE but doesn't reject

---

#### Segment 4: Return Validation Metadata (L5120-5130)
```javascript
// Line ~5125
return {
  ...scores,
  validationMetadata: {
    categoryMismatch,
    evidenceConfidence: evidenceResult.confidence,
    relevanceScore: relevanceResult.score,
    forbiddenCategoryMatch: false
  }
};

// Chunk survives → continues to final ranking
```

**Purpose**: Return scores with validation flags
**In Audit**: c2961b13 marked with evidenceConfidence='LOW', still survives

---

### Function: `getChunkScoreBreakdown()`

**Location**: Lines 3310-3625
**Purpose**: Calculate composite score components

**Key Code Segments**:

#### Scoring Formula (L3320-3350)
```javascript
// Line ~3320
let semanticBoost = semanticScore * SEMANTIC_WEIGHT;  // SEMANTIC_WEIGHT = 0.1

let attributeScore = 0;
if (chunkEntities.program && chunkEntities.program === queryEntities.program) {
  attributeScore += 1.0;  // +1.0 for program match
}
if (chunkEntities.category && chunkEntities.category === queryEntities.category) {
  attributeScore += 0.8;  // +0.8 for category match
}

let metadataBoost = 0;
if (chunkEntities.program === queryEntities.program) {
  metadataBoost += 2.0;  // +2.0 for program match (PRIMARY BOOST)
}
if (chunkEntities.programMode && queryEntities.program === 'SI') {
  metadataBoost += 0.5;  // +0.5 for program mode
}

let intentBoost = 0;
if (matchesIntentCategory(chunkCategory, intent)) {
  intentBoost += 0.9;  // +0.9 for intent category match
}

let compositeScore = semanticBoost + attributeScore + metadataBoost + intentBoost;
// Line ~3350
```

**Purpose**: Calculate final ranking score
**In Audit**: Shows why metadata dominates (metadataBoost=2.0 vs semanticBoost=0.004)

---

## File: `src/routes/provider.js`

### Function: `ragQueryWithEval()`

**Location**: Lines 7600-7750
**Purpose**: Orchestrate RAG pipeline: retrieve → filter → validate → generate answer

**Key Code Segments**:

#### Segment 1: Query Classification (L7610-7630)
```javascript
// Line ~7615
const userIntent = classifyIntent(question);
const queryEntities = extractQueryEntities(question);

// For "Apa itu Sistem Informasi?":
// userIntent = 'ACADEMIC_PROGRAM'
// queryEntities = { intent: 'ACADEMIC_PROGRAM', program: 'SI', category: 'PROGRAM_STUDI', ... }
```

---

#### Segment 2: filterRelevantChunks() Call (L7650-7670)
```javascript
// Line ~7652
let scored = [...topChunks];  // 8 candidates from embedding

const filtered = filterRelevantChunks(question, scored, queryEntities);

// Line ~7655: Logging audit info
if (process.env.RAG_AUDIT_LOGGING) {
  console.log('[RAG AUDIT] Query:', question);
  console.log('[RAG AUDIT] topBefore:', topChunks.map(s => s.item.id).slice(0, 3));
  console.log('[RAG AUDIT] filterStats:', { before: scored.length, after: filtered.length, filtered: scored.length - filtered.length });
}
```

**In Audit**: Shows filterStats.before=1, filtered=7 for Queries 1-3

---

#### Segment 3: applyIntentAwareFilteringAndValidation() Call (L7665-7680)
```javascript
// Line ~7667
const topAfter = applyIntentAwareFilteringAndValidation(
  question,
  filtered,
  userIntent
);

// Line ~7675: Audit logging
if (process.env.RAG_AUDIT_LOGGING) {
  console.log('[RAG AUDIT] topAfter:', topAfter.map(s => s.item.id));
}
```

**In Audit**: Shows topAfter = [c2961b13...] for all 4 queries

---

#### Segment 4: Score Normalization (L7700-7720)
```javascript
// Line ~7705
const normalizeRagScore = (rawScore) => {
  return Math.min(1.0, rawScore / RAG_SCORE_NORMALIZATION_FACTOR);
};

const confidenceScore = normalizeRagScore(topAfter[0].rawScore);

// Line ~7710: Confidence gating
if (confidenceScore < RAG_MIN_SCORE) {
  // Fallback to other strategies
  return { type: 'FALLBACK', ... };
}
```

**Purpose**: Convert rawScore to [0,1] confidence
**In Audit**: Applied AFTER ranking decision already made

---

## Environment Variables Controlling Audit/Debug

### RAG_AUDIT_LOGGING
```javascript
// File: src/routes/provider.js, L7650-7670
if (process.env.RAG_AUDIT_LOGGING === 'true') {
  // Logs topBefore, filterStats, topAfter
  console.log('[RAG AUDIT] ...');
}
```

**Status**: Enables audit trace output
**In Audit**: Used to capture debug_four_results_utf8.txt

---

### RAG_DEBUG_INTENT_FILTERING
```javascript
// File: src/engine/ragEngine.js, L5000-5020
if (process.env.RAG_DEBUG_INTENT_FILTERING === 'true') {
  // Logs intent category filtering details
  console.log('[RAG DEBUG INTENT]', ...);
}
```

**Status**: Enables intent filtering debug output

---

### RAG_MIN_SCORE
```javascript
// File: src/engine/ragEngine.js, L7710
const RAG_MIN_SCORE = parseFloat(process.env.RAG_MIN_SCORE || '0.6');

if (confidenceScore < RAG_MIN_SCORE) {
  // Fallback triggered
}
```

**Default**: 0.6
**In Audit**: Double Degree chunk passes with score ~0.7-0.8

---

## Critical Numbers

### Semantic Weight
```javascript
// L3330
const SEMANTIC_WEIGHT = 0.1;  // Semantic contribution to score
// Impact: Semantic score of 0.5 contributes only 0.05 to final score
```

---

### MetadataBoost Amounts
```javascript
// L3340-3360 (approximate)
metadataBoost += 2.0;  // Program match
metadataBoost += 0.5;  // ProgramMode match
metadataBoost += 0.8;  // Category match
metadataBoost += 0.9;  // Academic intent category match
// Total possible: ~4.2 from metadata
// Versus: ~0.05 from semantic (at best)
```

---

### Program Mismatch Hard-Reject
```javascript
// L4956
if (itemProgram && itemProgram !== requestedProgram) return false;
// No fallback, no scoring chance: IMMEDIATE ELIMINATION
```

---

## Verification Steps

### Step 1: Confirm filterRelevantChunks() is the culprit
```bash
# With RAG_AUDIT_LOGGING=true, check:
# - filterStats.before should show significant reduction
# - Expected: before=1-2 (only metadata-matching chunks)
# - Actual: before=1-2 (confirms filtering occurred)
```

### Step 2: Confirm Program Mismatch Rule
```bash
# Check chunk metadata:
# 1. Extract chunk 6631dfc1
# 2. Find filename: "Penjelasan Prodi dan Karier..."
# 3. Confirm metadata.program or filename contains "SK"
# 4. Confirm queryEntities.program = "SI"
# 5. Result: Hard-rejected by L4956
```

### Step 3: Confirm Validation is Non-Hard-Rejecting
```bash
# Check if validationMetadata shows:
# - categoryMismatch: false (usually)
# - evidenceConfidence: LOW/VERY_LOW (flagged but not rejecting)
# - No additional elimination in applyIntentAwareFilteringAndValidation()
```

### Step 4: Confirm Metadata Dominance
```bash
# Compare scores:
# - semanticBoost: 0.003-0.008 (0.03-0.08 semantic × 0.1 weight)
# - metadataBoost: 2.0-2.5 (program + category + intent)
# - Ratio: Metadata is 300-500x dominant
```

---

## Implementation Planning

### Option 1: Soften Program Mismatch (Recommended)
```javascript
// Change L4956 from hard-reject to scoring
if (itemProgram && itemProgram !== requestedProgram) {
  // Instead of: return false;
  // Add penalty: score *= 0.5;  // 50% discount
}
```

**Pros**: Allows better semantic candidates
**Cons**: May increase off-topic results

---

### Option 2: Adjust Generic Overview Filtering
```javascript
// Change L4962-4970 logic
if (isGenericProgramOverviewChunk(s.item)) {
  // Instead of removing: deprioritize in scoring
  // score *= 0.7;  // 30% discount
}
```

**Pros**: Keeps general information available
**Cons**: May rank generic content too high

---

### Option 3: Increase Semantic Weight
```javascript
// Change L3330
const SEMANTIC_WEIGHT = 0.3;  // Was 0.1, now 0.3

// Impact: Semantic becomes 30% vs metadata 20% of total
```

**Pros**: Direct fix for metadata dominance
**Cons**: May reduce program-specific accuracy

---

### Option 4: Multi-Factor Filtering (Recommended Best)
```javascript
// Replace L4956 hard-reject with score-based filtering
const getProgramMismatchPenalty = (itemProgram, requestedProgram, semanticScore) => {
  if (itemProgram === requestedProgram) return 1.0;  // No penalty
  if (semanticScore > 0.5) return 0.7;  // Allow high-semantic despite mismatch
  if (semanticScore > 0.3) return 0.5;  // Moderate discount
  return 0.1;  // Heavy discount for low-semantic mismatch
};
```

**Pros**: Allows recovery for high-quality candidates
**Cons**: Requires careful threshold tuning

---

## Summary Table: Code Locations to Modify

| Issue | File | Function | Lines | Type | Severity |
|-------|------|----------|-------|------|----------|
| **Program mismatch hard-reject** | ragEngine.js | filterRelevantChunks() | 4954-4956 | Hard-reject | 🔴 Critical |
| **Generic overview filtering** | ragEngine.js | filterRelevantChunks() | 4962-4970 | Filtering | 🟠 High |
| **Semantic weight too low** | ragEngine.js | getChunkScoreBreakdown() | 3320 | Scoring | 🔴 Critical |
| **Evidence non-hard-rejecting** | ragEngine.js | applyIntentAwareFilteringAndValidation() | 5060-5075 | Validation | 🟡 Medium |
| **Relevance non-hard-rejecting** | ragEngine.js | applyIntentAwareFilteringAndValidation() | 5095-5110 | Validation | 🟡 Medium |

