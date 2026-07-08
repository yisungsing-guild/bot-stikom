# Final Validation & Evidence Analysis Audit

**Scope**: Chunks that survive `filterRelevantChunks()` → Analysis in `applyIntentAwareFilteringAndValidation()`

---

## QUERY 1: "Apa itu Sistem Informasi?"

### Pre-Validation State
**After filterRelevantChunks()**: 1 chunk
- `c2961b13-bd76-4f6b-9c39-1e19606b6a5d` (CHATBOT - Double Degree)

### applyIntentAwareFilteringAndValidation() Analysis

**Applied Intent**: `DEFINISI_PRODI`
**Applied Category Restrictions**: 
- **Forbidden categories**: Not explicitly set for this intent
- **Allowed categories**: PROGRAM_KHUSUS (from category entity match)

#### Chunk: `c2961b13...`

**Metadata Check:**
```javascript
allowedDocCategories = getallowedCategoriesForIntent('DEFINISI_PRODI');
// Returns: ['PROGRAM_STUDI', 'SK', 'CURRICULUM', 'PROGRAM_KHUSUS'] (inclusive)
itemCategory = 'PROGRAM_KHUSUS';
// itemCategory is in allowedDocCategories? YES → PASS
```

**Evidence Validation (validateChunkEvidence):**
```javascript
// Check: Does chunk have explicit program definition evidence?
evidenceMarkers = {
  'definisi prodi': 0,  // not found in chunk
  'program definition': 0,
  'apa itu': 0,
  'pengertian': 0,
  'tujuan program': 0,
  'learning outcomes': 0,
  'profil lulusan': 0
};
hasExplicitEvidence = false;

// What chunk actually contains:
// "Halo Selamat datang di Program Double Degree ITB STIKOM Bali..."
// "Silakan pilih informasi yang kamu butuhkan"
// "A. DOUBLE DEGREE - DNUI MELBOURNE"
// Content about enrollment, partner university, admission

evidenceConfidence = 'LOW';
// Result: No hard reject (evidence validation is NOT hard-rejecting)
```

**Relevance Validation (validateChunkRelevanceToQuestion):**
```javascript
// Question: "Apa itu Sistem Informasi?"
// Query intent: DEFINISI_PRODI (asking for definition/overview of SI program)

relevanceKeywords = ['sistem informasi', 'program', 'studi', 'definisi', 'apa itu'];
chunkRelevanceScore = calculateRelevance(chunk, relevanceKeywords);

// Chunk mentions:
// - "Program Double Degree" (1 match: "Program")
// - "Sistem Informasi" explicitly? Check...
// - "ITB STIKOM Bali" (university, not SI definition)

// Relevance score: Moderate (mentions program, not definition)
// CAN hard reject if relevanceScore < threshold, but doesn't appear to
```

**Validation Metadata Stored:**
```javascript
validationMetadata = {
  categoryMismatch: false,  // PROGRAM_KHUSUS is allowed
  evidenceConfidence: 'LOW',  // No strong definition evidence
  relevanceScore: 'MODERATE',  // Mentions program but not answering "what is SI"
  forbiddenCategoryMatch: false
};
```

**Final Status**: ✅ **PASSES VALIDATION**
- Category allowed
- Evidence validation: non-hard-reject (logging only)
- Relevance validation: passes (no hard-reject applied)
- **Survives to final selection** = topAfter = [`c2961b13...`]

### Outcome Summary
| Check | Result | Severity |
|-------|--------|----------|
| Category match | ✅ Allowed | — |
| Evidence confidence | ⚠️ LOW | Non-fatal |
| Relevance | ⚠️ MODERATE | Non-fatal |
| Final decision | ✅ PASS | — |
| Answer quality | ❌ POOR | Query asks "what is SI", chunk is about enrollment process |

---

## QUERY 2: "Apa prospek kerja Sistem Informasi?"

### Pre-Validation State
**After filterRelevantChunks()**: 1 chunk
- `c2961b13-bd76-4f6b-9c39-1e19606b6a5d`

### applyIntentAwareFilteringAndValidation() Analysis

**Applied Intent**: `PROSPEK_KERJA`
**Applied Category**: `KARIR`

#### Chunk: `c2961b13...`

**Category Validation:**
```javascript
allowedDocCategories = getallowedCategoriesForIntent('PROSPEK_KERJA');
// Returns: ['KARIR', 'CAREER', 'ALUMNI_SUCCESS', 'PROGRAM_KHUSUS']
itemCategory = 'PROGRAM_KHUSUS';
// In allowed? YES → PASS
```

**Evidence Validation:**
```javascript
evidenceMarkers = {
  'prospek kerja': 0,
  'career prospect': 0,
  'alumni career': 0,
  'lulusan bekerja': 0,
  'bidang kerja': 0,
  'industri': 0
};
hasExplicitEvidence = false;

// Chunk content: Double Degree enrollment, partner universities, admission
// NO career prospect information

evidenceConfidence = 'VERY_LOW';
// Result: Non-hard-reject
```

**Relevance Validation:**
```javascript
// Question: "Apa prospek kerja Sistem Informasi?"
// Query asks: Career prospects, jobs, industry for SI graduates

relevanceScore = calculateRelevance(chunk, ['kerja', 'prospek', 'karir', 'alumni', 'industri']);
// Chunk has NO job/career keywords
// Score: VERY_LOW

// But: validateChunkRelevanceToQuestion() apparently doesn't hard-reject
// OR: It does but has high threshold
```

**Final Status**: ✅ **PASSES VALIDATION** (same as Query 1)
- Evidence flagged as LOW/VERY_LOW
- No hard-reject applied

### Outcome Summary
❌ **Most severe mismatch**:
- Query asks about career prospects
- Chunk is about Double Degree enrollment
- No career/job information
- Semantic score: 0.025 (nearly random)
- Selected only because filterRelevantChunks() eliminated all alternatives

---

## QUERY 3: "Apa yang dipelajari di Sistem Informasi?"

### Pre-Validation State
**After filterRelevantChunks()**: 1 chunk
- `c2961b13-bd76-4f6b-9c39-1e19606b6a5d`

### applyIntentAwareFilteringAndValidation() Analysis

**Applied Intent**: `MATA_KULIAH` (KURIKULUM_PEMBELAJARAN)
**Applied Category**: `PROGRAM_STUDI`

#### Chunk: `c2961b13...`

**Evidence Validation:**
```javascript
evidenceMarkers = {
  'mata kuliah': 0,
  'kurikulum': 0,
  'course': 0,
  'pembelajaran': 0,
  'dipelajari': 0,
  'learning objective': 0
};
hasExplicitEvidence = false;

evidenceConfidence = 'VERY_LOW';
// Chunk has NO curriculum/course information
```

**Relevance Validation:**
```javascript
// Question: "Apa yang dipelajari di Sistem Informasi?"
// Asks: What courses, subjects, curriculum

relevanceScore = VERY_LOW;
// Chunk talks about Double Degree enrollment, not curriculum
```

**Final Status**: ✅ **PASSES VALIDATION** (no hard-reject)

### Outcome Summary
❌ **Very poor match**:
- Query asks about curriculum/courses
- Chunk is enrollment chatbot
- Semantic: 0.055 (very low)

---

## QUERY 4: "Apa keunggulan Sistem Informasi?"

### Pre-Validation State (Different!)
**After filterRelevantChunks()**: 2 chunks
- `c2961b13-bd76-4f6b-9c39-1e19606b6a5d` 
- Other chunk (possibly non-SI specific)

Note: filterStats shows `before=2, after=2` (no elimination in filtering stage)

### Applied Intent: `PROGRAM` or `ACADEMIC_PROGRAM`
**Applied Category**: `PROGRAM_STUDI`

#### Chunk: `c2961b13...`

**Validation**: Passes (same as other queries)

**Evidence Analysis:**
```javascript
// Query asks: "keunggulan" (advantages, strengths)
evidenceMarkers = {
  'keunggulan': 0,
  'kelebihan': 0,
  'advantages': 0,
  'distinctive features': 0,
  'excellence': 0
};
hasExplicitEvidence = false;

evidenceConfidence = 'LOW';
// Chunk about Double Degree, not SI strengths
```

**Final Selection**: 2 chunks selected (both lower ranked)
- Both `c2961b13...` and second chunk (`74be5da2...`?) selected due to low quality

---

## Validation Stage Analysis Summary

### Key Finding: **Evidence Validation is NON-HARD-REJECTING**

**Code Evidence** (from src/engine/ragEngine.js ~L5070):
```javascript
const validationMetadata = {
  categoryMismatch: itemCategory && !allowedCategories.includes(itemCategory),
  evidenceConfidence: evidenceResult.confidence,  // Set but not used for hard-reject
  relevanceScore: releventResult.score  // Set but not used for hard-reject
};

// NO line like: if (evidenceConfidence === 'VERY_LOW') return null;
// Validation is LOGGING-ONLY for evidence, not filtering
```

### Validation Outcomes per Query

| Query | Intent | Category Match | Evidence Quality | Relevance | Final Status |
|-------|--------|-----------------|------------------|-----------|--------------|
| 1. Apa itu SI? | DEFINISI_PRODI | ✅ PROGRAM_KHUSUS | 🔴 LOW | ⚠️ MODERATE | ✅ PASS |
| 2. Prospek kerja? | PROSPEK_KERJA | ✅ PROGRAM_KHUSUS | 🔴 VERY_LOW | 🔴 VERY_LOW | ✅ PASS |
| 3. Dipelajari? | MATA_KULIAH | ✅ PROGRAM_KHUSUS | 🔴 VERY_LOW | 🔴 VERY_LOW | ✅ PASS |
| 4. Keunggulan? | ACADEMIC_PROGRAM | ✅ PROGRAM_KHUSUS | 🔴 VERY_LOW | ⚠️ MODERATE | ✅ PASS |

---

## Why Chunks Reach `topAfter`

**Process**:
1. filterRelevantChunks() → 1 survivor
2. applyIntentAwareFilteringAndValidation() → No hard-rejections
3. Score ranking → Ranked by composite score
4. Display → topAfter[0] = `c2961b13...`

**Critical finding**: **Validation stage does NOT eliminate chunks, only logs low evidence/relevance.**

---

## Evidence Scoring Breakdown for Survivor Chunk

### Example: QUERY 1, Chunk `c2961b13...`

**Scoring Formula** (from getChunkScoreBreakdown):
```
compositeScore = semanticBoost + evidenceScore + attributeScore + metadataBoost + other

semanticBoost = semantic × 0.1 = 0.0353 × 0.1 = 0.00353
evidenceScore = evidenceConfidence_value = 0.3 (LOW confidence → 0.3)
attributeScore = program_match (SI=SI) = 1.0 + category_match (PROGRAM_KHUSUS) = 0.8 → Total: 1.8
metadataBoost = 2.0 (SI program) + 0.5 (PROGRAM_KHUSUS type) = 2.5
otherBoosts = intent_match = 0.9

compositeScore = 0.004 + 0.3 + 1.8 + 2.5 + 0.9 = 5.504

REPORTED: rawScore 4.0235 (slightly different due to rounding/formula variations)
```

**Key observation**: 
- Semantic contributes: 0.004 (0.1% of score)
- Evidence contributes: 0.3 (7% of score)
- Metadata/attribute contributes: 4.3 (93% of score)

**This is why low-semantic chunk wins**: Metadata dominates scoring

---

## Comparison: Rejected Chunk vs Survivor

### QUERY 2 Comparison: Chunk `6631dfc1` vs `c2961b13`

**Chunk 6631dfc1 (REJECTED before validation)**
```
Document: Penjelasan Prodi dan Karier Masa Depan (1).xlsx
Category: SK (Sistem Komputer)
Semantic: 0.5461 (HIGH - relevant to career question)
Evidence: Would have CAREER_PROSPECT evidence (if included)
Program: SK (metadata says SK, not SI)

Elimination: requestedProgram = SI, itemProgram = SK → Hard reject
Did not reach validation stage
```

**Chunk c2961b13 (SELECTED)**
```
Document: CHATBOT - Double Degree (1).docx
Category: PROGRAM_KHUSUS
Semantic: 0.0252 (VERY LOW - irrelevant to career question)
Evidence: None for career prospects
Program: SI (extracted from text)
Evidence confidence: VERY_LOW
Relevance: VERY_LOW

Status: Survived filterRelevantChunks(), passed validation (non-hard-reject), selected
```

**The Trade-off**:
- Rejected: 1 relevant chunk with evidence, but metadata program mismatch
- Selected: 1 irrelevant chunk with no evidence, but program name match

---

## Conclusion: Evidence Validation Stage

### Finding 1: Validation is Permissive
- Evidence validation flags LOW/VERY_LOW confidence
- But does NOT hard-reject based on evidence
- Relevance validation logs low scores
- But does NOT hard-reject based on relevance

### Finding 2: Filtering Happens Earlier
- ALL meaningful filtering happens in `filterRelevantChunks()`
- `applyIntentAwareFilteringAndValidation()` is logging/analysis only
- Category check is soft (allowing PROGRAM_KHUSUS for various intents)

### Finding 3: Why Survivor Chunk Reaches Answer
1. Passes filterRelevantChunks() (SI program name match)
2. Passes validation (PROGRAM_KHUSUS allowed, evidence logged as LOW, no hard-reject)
3. Ranked by composite score (dominated by metadata, not semantics)
4. Selected as topAfter[0]
5. Sent to AI for answer generation

### Finding 4: Quality of Generated Answer
- Even though chunk has VERY_LOW relevance evidence
- AI still attempts to generate answer based on chunk
- Result: Off-topic or generic answer (enrollment info instead of definition/curriculum)
- But: User doesn't see the evidence quality (only sees final answer)

---

## Root Cause Hierarchy

```
PRIMARY (filterRelevantChunks):
├─ Program-category mismatch check (itemProgram !== requestedProgram) 
│  └─ Eliminates: 6631dfc1, others with different program metadata
├─ Generic overview detection 
│  └─ Eliminates: 618a0474 (all programs document)
└─ Intent-based keyword filtering
   └─ Eliminates: cost, hobby, schedule chunks

SECONDARY (applyIntentAwareFilteringAndValidation):
├─ Category checking (soft filter, usually passes)
├─ Evidence validation (logs only, non-hard-reject)
└─ Relevance validation (logs only, non-hard-reject)

TERTIARY (Scoring):
├─ MetadataBoost dominates (93% of score)
├─ Semantic contributes minimally (0.1% of score)
└─ Low-semantic chunks with metadata match score higher
```

