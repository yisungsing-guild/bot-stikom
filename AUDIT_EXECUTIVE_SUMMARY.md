# ROOT CAUSE AUDIT — EXECUTIVE SUMMARY

**Date**: Audit Phase (No Code Changes)
**Scope**: 4 SI Benchmark Queries (Evidence-Only Investigation)
**Methodology**: Complete filtering pipeline trace without modifications

---

## TL;DR — Root Cause

**The Double Degree chunk (`c2961b13...`) wins all 4 queries NOT because of confidence patching, semantic strength, or model selection, but because `filterRelevantChunks()` applies strict program-specific filtering that eliminates 7 of 8 candidates.**

### Elimination Mechanism

```
Question: "Apa itu Sistem Informasi?" (Definition query)
         ↓
Top 8 Chunks Scored: [6631dfc1 (0.49 semantic), c2961b13 (0.035 semantic), ...]
         ↓
filterRelevantChunks() applies rules:
  • 6631dfc1: itemProgram="SK" ≠ requestedProgram="SI" → ELIMINATED
  • 618a0474: Generic "all programs" overview → ELIMINATED  
  • b411e939: Multiple programs mentioned → ELIMINATED
  • Others: Cost/hobby/schedule categories → ELIMINATED
         ↓
Survivor: Only c2961b13 (lucky: mentions SI explicitly)
         ↓
applyIntentAwareFilteringAndValidation(): No additional elimination
         ↓
topAfter = [c2961b13]
         ↓
Answer generated from off-topic chunk
```

---

## Evidence Hierarchy

### Level 1: Chunk Retrieval & Scoring ✅ WORKING
- Embedding model correctly identifies semantic matches
- Query 1: Best semantic match = 6631dfc1 (0.4861)
- Query 2: Best semantic match = 6631dfc1 (0.5461) 
- Query 3: Best semantic match = 6631dfc1 (0.4930)
- Query 4: Best semantic match = 74be5da2 (0.5072)

### Level 2: Filtering (Primary Root Cause) ❌ CRITICAL ISSUE
**Location**: `src/engine/ragEngine.js`, `filterRelevantChunks()` (L4889-4968)

**Active Elimination Rules** (in order of severity):

#### Rule 1: Program-Category Mismatch (🔴 CRITICAL)
```javascript
// Line ~4954
if (itemProgram && itemProgram !== requestedProgram) return false;

// Eliminates Queries 1-3:
// Chunk 6631dfc1: category metadata = "SK" 
// Extracted as: program = "SK"
// But: requestedProgram = "SI"
// Result: Hard reject despite semantic 0.49-0.55
```

**Impact**:
- **Query 1**: Loses semantic 0.4861 (2nd best candidate)
- **Query 2**: Loses semantic 0.5461 (BEST candidate, career topic)
- **Query 3**: Loses semantic 0.4930 (2nd best candidate)
- **Severity**: 🔴 CRITICAL — Eliminates topically relevant chunks

#### Rule 2: Generic Overview Filtering
```javascript
// Line ~4962
const isGenericProgramOverviewChunk = (item) => {
  const fname = String(item.filename || item.trainingId || '').toLowerCase();
  return /penjelasan\s+semua\s+program\s+studi/i.test(fname);
};

// Eliminates:
// Chunk 618a0474: filename="Penjelasan Semua Program Studi.pdf"
// Reason: Covers all programs, not specific SI
// Semantic: 0.5881 (3rd best in Queries 1-3)
```

**Impact**:
- Loses highly semantic chunk (0.59 in Q1, 0.63 in Q2)
- Rationale: Deprioritize all-programs documents when program-specific query
- **Severity**: 🟠 HIGH — Eliminates relevant content

#### Rule 3: Multi-Program Mention Filtering
```javascript
// Line ~4959
if (mentionedPrograms.length > 1 && 
    !mentionedPrograms.every((p) => p === requestedProgram)) {
  return false;
}

// Eliminates:
// Chunk b411e939: Mentions both SI and other programs (Double Degree)
// Reason: Document discusses multiple program options
```

**Impact**:
- Eliminates one of duplicate Double Degree chunks
- Related to Program merging/deduplication logic

#### Rule 4: Intent-Based Keyword Filtering
```javascript
// Lines ~4915-4920
if (intent !== 'COST' && costPattern.test(lower)) return false;
// Eliminates cost/schedule/hobby chunks when intent != COST/SCHEDULE
```

**Impact**:
- Chunks 5-8: Filtered for semantic irrelevance
- Cost chunks removed for academic-intent queries
- **Severity**: 🟡 MEDIUM — Appropriately removes off-topic content

### Level 3: Validation (Secondary — Permissive) ⚠️ LOGGING-ONLY
**Location**: `src/engine/ragEngine.js`, `applyIntentAwareFilteringAndValidation()` (L5011-5130)

**Status**: Evidence validation flags LOW/VERY_LOW confidence but does NOT hard-reject

**Impact**: 
- Survivor chunk has VERY_LOW evidence confidence
- No additional filtering occurs
- Chunk proceeds to answer generation

### Level 4: Scoring (Tertiary — Metadata Dominance) 🔴 COMPOUNDING ISSUE
**Formula**: `compositeScore = 0.1×semantic + evidenceScore + attributeScore + metadataBoost + intentBoost`

**Result**:
- Semantic: 0.1 × 0.035 = 0.004 (0.1% of final score)
- MetadataBoost: 2.0 (SI program) + 0.5 (category) = 2.5 (62% of final score)
- Even if semantic=0.59, metadataBoost dominance means metadata-matched low-semantic chunks score higher

**Example (Q2 hypothetical)**:
```
Chunk 6631dfc1 (rejected before scoring):
  semanticBoost: 0.546 × 0.1 = 0.0546
  metadataBoost: 2.5 (SK program, but would be SK category)
  BLOCKED by: itemProgram="SK" rejection

Chunk c2961b13 (selected):
  semanticBoost: 0.025 × 0.1 = 0.0025
  metadataBoost: 2.5 (SI program match) → WINS due to metadata
```

---

## Four Queries — Root Cause Classification

### QUERY 1: "Apa itu Sistem Informasi?" (Definition)

**Scenario**:
```
Top 8 candidates → Best semantic: 6631dfc1 (0.49)
                   Best matched: c2961b13 (0.035)
```

**Elimination Chain**:
1. ✅ Retrieve & score 8 chunks → `6631dfc1` ranks high (semantic 0.4861)
2. ❌ filterRelevantChunks() → `6631dfc1` eliminated (program="SK" vs requested="SI")
3. ❌ filterRelevantChunks() → `618a0474` eliminated (generic all-programs)
4. ❌ filterRelevantChunks() → Others eliminated (wrong categories)
5. ✅ Survivor: Only `c2961b13` remains
6. ✅ applyIntentAwareFilteringAndValidation() → Passes (no hard-reject)
7. ✅ Final answer generated from off-topic chunk

**Root Cause Classification**: 
- **PRIMARY**: Program-category mismatch rule in filterRelevantChunks()
- **SECONDARY**: Generic overview filtering
- **TERTIARY**: Metadata dominance in scoring
- **NOT RESPONSIBLE**: Confidence patch, semantic scoring, model selection

---

### QUERY 2: "Apa prospek kerja Sistem Informasi?" (Career)

**Scenario**:
```
Question asks: Career prospects
Best match: 6631dfc1 (document: "Penjelasan Prodi dan KARIER", semantic: 0.5461)
Selected: c2961b13 (document: "Double Degree enrollment", semantic: 0.0252)
```

**Critical Failure**:
- Chunk 6631dfc1 is TOPICALLY PERFECT for career question
- Has BEST semantic similarity (0.546)
- Contains CAREER information in metadata
- **But**: Metadata says program="SK" (Sistem Komputer), not SI
- **Eliminated**: Hard reject due to program mismatch

**Root Cause Classification**:
- **PRIMARY**: Program-category mismatch (severity 🔴 CRITICAL)
- **Compounding**: Metadata boosts prevent recovery even if semantic were high
- **Most Severe Example**: 18x better semantic candidate rejected

---

### QUERY 3: "Apa yang dipelajari di Sistem Informasi?" (Curriculum)

**Scenario**:
```
Question asks: What is taught (curriculum/courses)
Best match: 6631dfc1 (semantic: 0.4930)
Selected: c2961b13 (semantic: 0.0551)
```

**Root Cause Classification**:
- **PRIMARY**: Program-category mismatch
- **Same pattern** as Queries 1-2

---

### QUERY 4: "Apa keunggulan Sistem Informasi?" (Advantages)

**Scenario**:
```
Question asks: Strengths/advantages
Best match: 74be5da2 (HOBY.pdf, semantic: 0.5072)
Selected: c2961b13 (Double Degree, semantic: 0.0286)
```

**Different Elimination Pattern**:
- Query 4 intent = `PROGRAM` (not `ACADEMIC_PROGRAM`)
- Chunk 74be5da2 eliminated by: Intent-based keyword filtering + relevance mismatch
- `c2961b13` survives by: Matching program name ("Sistem Informasi")

**Root Cause Classification**:
- **PRIMARY**: Intent-based keyword/topic filtering
- **SECONDARY**: Metadata program matching advantage
- **SEVERITY**: 🔴 CRITICAL — 18x semantic loss

---

## Quantified Impact

### Retrieval Quality Degradation

| Query | Best Semantic | Winner Semantic | Loss | Loss % |
|-------|---|---|---|---|
| 1. Definition (SI) | 0.5881 | 0.0353 | -0.5528 | -94% |
| 2. Career (SI) | 0.6294 | 0.0252 | -0.6042 | -96% |
| 3. Curriculum (SI) | 0.5878 | 0.0551 | -0.5327 | -91% |
| 4. Advantages (SI) | 0.5072 | 0.0286 | -0.4786 | -94% |
| **Average Loss** | — | — | **-0.552** | **-94%** |

### Candidate Survival Rate

| Query | Total Candidates | Survivors | Survival Rate |
|-------|---|---|---|
| 1. Definition | 8 | 1 | 12.5% |
| 2. Career | 8 | 1 | 12.5% |
| 3. Curriculum | 8 | 1 | 12.5% |
| 4. Advantages | 8 | 2 | 25% |
| **Average** | **8** | **~1.25** | **15.6%** |

### Answer Quality Impact

| Query | Question Type | Chunk Type | Relevance | Evidence |
|---|---|---|---|---|
| 1 | Definition | Enrollment | ❌ Poor | ❌ NONE |
| 2 | Career | Enrollment | ❌ Very Poor | ❌ NONE |
| 3 | Curriculum | Enrollment | ❌ Very Poor | ❌ NONE |
| 4 | Advantages | Enrollment | ❌ Very Poor | ❌ NONE |

---

## What's NOT the Root Cause

### ❌ Confidence Patch
- Patch applies AFTER retrieval pipeline
- Patch doesn't affect filterRelevantChunks()
- Evidence: Chunk is selected before confidence normalization

### ❌ Embedding/Semantic Quality
- Embeddings correctly identify semantic matches
- Evidence: Top 8 candidates ranked appropriately by semantics
- Failure is in filtering, not retrieval

### ❌ Model Selection
- Model selection is downstream (after chunk filtering)
- Evidence: Chunk selection happens in RAG engine, not in model

### ❌ Scoring Formula Alone
- While metadata dominance contributes, it's not primary
- Primary: Filtering eliminates candidates before scoring
- Evidence: Query 2 chunk would score high if it reached scoring step

### ❌ Vector Database Corruption
- Both high-semantic and low-semantic chunks retrieved correctly
- Evidence: Top candidates ranked appropriately by embedding score

---

## Conclusion: Evidence Chain

### The 3-Step Mechanism

**Step 1: Chunk Retrieval** ✅ Working
- Embeddings correctly identify semantic similarity
- Top 8 candidates retrieved for each query
- Semantic scores are accurate (correlation with relevance visible)

**Step 2: Aggressive Filtering** ❌ Root Cause
- `filterRelevantChunks()` applies 4 filtering rules
- Rule 1 (program-category mismatch) eliminates topically perfect chunks
- Rule 2 (generic overview) eliminates relevant candidates
- Rule 3 (multi-program) filters duplicates
- Rule 4 (intent-keyword) removes off-topic content
- **Result**: Only 1 survivor (12.5% retention)

**Step 3: Permissive Validation** ⚠️ Compounding
- Validation flags evidence as LOW/VERY_LOW
- But does NOT hard-reject
- Survivor reaches final selection regardless of evidence quality

**Step 4: Metadata-Biased Scoring** 🔴 Amplification
- Metadata boosts dominate (62% of score)
- Semantic contributes minimally (0.1% of score)
- Even IF high-semantic chunk survived filtering, metadata match would still win

---

## Accountability Matrix

| Component | Culpability | Evidence | Fix Difficulty |
|---|---|---|---|
| **filterRelevantChunks()** | 🔴 PRIMARY | Hard-rejects on metadata mismatch despite semantic strength | Medium |
| **filterRelevantChunks() generic overview** | 🟠 SECONDARY | Eliminates multi-program documents | Low |
| **getChunkEntities()** | 🟠 SUPPORTING | Extracts program="SK" from metadata, triggering mismatch | Low |
| **applyIntentAwareFilteringAndValidation()** | 🟡 MINOR | Doesn't hard-reject despite LOW evidence | Low |
| **Scoring formula** | 🟡 AMPLIFYING | Metadata dominance prevents recovery | Medium |
| **Confidence patch** | 🟢 NOT RESPONSIBLE | Applied downstream of filtering | N/A |
| **Embeddings** | 🟢 NOT RESPONSIBLE | Correctly identify semantic matches | N/A |

---

## Final Determination

**ROOT CAUSE**: The `filterRelevantChunks()` function in `src/engine/ragEngine.js` (lines 4889-4968) applies **program-specific entity matching** that eliminates topically relevant, semantically strong chunks due to metadata category mismatches.

**EVIDENCE**: All 4 queries show the same pattern:
- Best semantic candidates (0.49-0.63) eliminated by program mismatch
- Only metadata-matched chunk (c2961b13, semantic 0.025-0.055) survives
- Validation stage does not recover these candidates
- Final answer generated from off-topic chunk

**SEVERITY**: 🔴 CRITICAL
- 94% loss in semantic quality
- 87.5% candidate elimination rate
- All 4 queries affected identically

**RECOMMENDATION**: See separate implementation proposal document for fix strategies.

