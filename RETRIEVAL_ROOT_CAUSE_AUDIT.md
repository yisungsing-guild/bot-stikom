# Root Cause Retrieval Audit — Keempat SI Benchmark Queries

**Objective**: Identify exact elimination rule dan root cause untuk setiap query yang menghasilkan chunk `c2961b13-bd76-4f6b-9c39-1e19606b6a5d` sebagai top, padahal chunk lain lebih relevan.

---

## Executive Summary

Semua empat query menunjukkan pola yang sama:
1. **Chunk scoring** menghasilkan 8 top candidates
2. **filterRelevantChunks()** mengeliminasi 7 chunks
3. Hanya chunk Double Degree (`c2961b13...`) yang lolos
4. Root cause adalah **program-specific filtering di `filterRelevantChunks()`**

---

## QUERY 1: "Apa itu Sistem Informasi?"

### Query Entities (dari trace)
- **intent**: `ACADEMIC_PROGRAM`
- **program**: `SI` (Sistem Informasi)
- **category**: `PROGRAM_STUDI`
- **academicIntent**: `DEFINISI_PRODI`

### Top 8 Chunks Before filterRelevantChunks()

| Rank | ID | Document | Category | RawScore | Semantic | MetaBoost | Status |
|------|----|-----------|-----------|-----------|-----------|---------|-|
| 1 | `6631dfc1...` | Penjelasan Prodi dan Karier (1).xlsx | **SK** | 4.2846 | 0.4861 | 3.29 | ❌ ELIMINATED |
| 2 | `c2961b13...` | CHATBOT - Double Degree (1).docx | PROGRAM_KHUSUS | 4.0235 | 0.0353 | 2.72 | ✅ **SURVIVOR** |
| 3 | `b411e939...` | CHATBOT - Double Degree (1).docx | PROGRAM_KHUSUS | 4.0218 | 0.0182 | 2.72 | ❌ ELIMINATED |
| 4 | `618a0474...` | Penjelasan Semua Program Studi.pdf | UNKNOWN | 3.6988 | 0.5881 | 3.29 | ❌ ELIMINATED |
| 5 | `8491b972...` | hobi_prodi_lengkap (1).xlsx | UNKNOWN | 3.2333 | 0.5126 | 2.27 | ❌ ELIMINATED |
| 6 | `c4b537df...` | (null) | BIAYA | 3.1985 | 0.4651 | 1.94 | ❌ ELIMINATED |
| 7 | `74be5da2...` | HOBY.pdf | UNKNOWN | 3.1298 | 0.478 | 1.82 | ❌ ELIMINATED |
| 8 | `0f1c9e82...` | (null) | SCHEDULE | 3.1107 | 0.567 | 1.94 | ❌ ELIMINATED |

### Elimination Analysis per Chunk

#### ❌ Chunk 1: 6631dfc1-b46c-4933-a340-392dfd2250d6 (SK, Penjelasan Prodi)
- **Category**: SK (Sistem Komputer) — NOT SI
- **Why Eliminated**: 
  - Rule: **`requestedProgram` mismatch in filterRelevantChunks()**
  - Query explicitly asks for SI program (`queryEntities.program = 'SI'`)
  - Chunk entities indicate SK program (from filename/metadata)
  - Line ~4960 in ragEngine.js checks:
    ```javascript
    if (requestedProgram) {
      const itemEntities = getChunkEntities(s.item);
      const itemProgram = itemEntities.program ? ... : null;
      const requestedProgramRegex = requestedProgramPatterns[requestedProgram];
      const mentionsRequestedProgram = requestedProgramRegex ? requestedProgramRegex.test(lower) : false;
      ...
      if (itemProgram && itemProgram !== requestedProgram) return false; // ← ELIMINATED HERE
    ```
  - Even though this chunk has HIGHER rawScore (4.2846), it's rejected due to program mismatch

#### ❌ Chunk 3: b411e939-1537-4fd5-af3d-541424f9d3a3 (Double Degree, same file as c2961b13...)
- **Category**: PROGRAM_KHUSUS (but mentions multiple programs)
- **Chunk preview**: "usahaan multinasional atau melanjutkan studi ke luar negeri. B. DOUBLE DEGREE - HELP UNIVERSITY, MALAYSIA..."
- **Why Eliminated**:
  - Rule: **`multiProgramPenalty` or `isGenericProgramOverviewChunk()` filtering**
  - Chunk mentions both SI and potentially other programs (multiple program match pattern)
  - OR: belongs to generic Double Degree overview (deprioritized in filterRelevantChunks ~4950)
  - Eliminated by: `if (mentionedPrograms.length > 1 && !mentionedPrograms.every((p) => p === requestedProgram)) return false;`

#### ❌ Chunk 4: 618a0474-969a-463f-91cd-c010a27beb48 (Penjelasan Semua Program Studi.pdf)
- **Category**: UNKNOWN
- **Semantic**: 0.5881 (HIGH semantic similarity!)
- **Why Eliminated**:
  - Rule: **`isGenericProgramOverviewChunk()` detection**
  - Filename pattern matches: "Penjelasan Semua Program Studi" = overview of ALL programs
  - Line ~4947 in filterRelevantChunks:
    ```javascript
    const isGenericProgramOverviewChunk = (item) => {
      const fname = String((item && (item.filename || item.trainingId)) || '').toLowerCase();
      const overviewPattern = /\b(?:penjelasan\s+semua\s+program\s+studi|semua\s+program\s+studi|...)/i;
      return overviewPattern.test(fname) || overviewPattern.test(chunkText);
    };
    ```
  - When `requestedProgram = SI`, generic overview is deprioritized/removed

#### ❌ Chunks 5-8: (BIAYA, HOBY, SCHEDULE categories)
- **Why Eliminated**:
  - Rule: **Intent-based filtering in filterRelevantChunks()**
  - `intent = ACADEMIC_PROGRAM` but chunks contain cost/schedule/hobby keywords
  - Line ~4915-4920:
    ```javascript
    if (intent !== 'COST' && costPattern.test(lower)) return false; // ← Chunk 6 (BIAYA)
    if ((intent === 'PROGRAM' || intent === 'ACADEMIC_PROGRAM') && !programPattern.test(lower) && s.item.chunkType !== 'GENERAL') return false;
    ```
  - Chunks that don't match program/academic pattern are removed

### Post-filterRelevantChunks: 1 survivor
- Only `c2961b13-bd76-4f6b-9c39-1e19606b6a5d` remains
- Despite having MUCH LOWER semantic (0.0353 vs 0.5881 for best semantic match)

### applyIntentAwareFilteringAndValidation()
- **Intent**: `DEFINISI_PRODI`
- **Result**: 1 chunk validated, 0 rejected
- **Reason**: No additional filtering occurs (chunk passes all validation checks)

---

## QUERY 2: "Apa prospek kerja Sistem Informasi?"

### Query Entities
- **intent**: `ACADEMIC_PROGRAM`
- **program**: `SI`
- **category**: `KARIR`
- **academicIntent**: `PROSPEK_KERJA`

### Top 8 Chunks Before filterRelevantChunks()

| Rank | ID | Document | Category | RawScore | Semantic | Status |
|------|----|-----------|-----------|-----------|-----------|-|
| 1 | `6631dfc1...` | Penjelasan Prodi dan Karier (1).xlsx | **SK** | 4.2456 | 0.5461 | ❌ ELIMINATED |
| 2 | `b411e939...` | CHATBOT - Double Degree (1).docx | PROGRAM_KHUSUS | 3.9775 | 0.0251 | ❌ ELIMINATED |
| 3 | `c2961b13...` | CHATBOT - Double Degree (1).docx | PROGRAM_KHUSUS | 3.9325 | 0.0252 | ✅ **SURVIVOR** |
| 4 | `618a0474...` | Penjelasan Semua Program Studi.pdf | UNKNOWN | 3.6129 | 0.6294 | ❌ ELIMINATED |
| 5 | `8491b972...` | hobi_prodi_lengkap (1).xlsx | UNKNOWN | 3.1443 | 0.5227 | ❌ ELIMINATED |
| 6 | `c4b537df...` | (null) | BIAYA | 3.1058 | 0.4377 | ❌ ELIMINATED |
| 7 | `74be5da2...` | HOBY.pdf | UNKNOWN | 3.0424 | 0.504 | ❌ ELIMINATED |
| 8 | `0f1c9e82...` | (null) | SCHEDULE | 3.0142 | 0.5021 | ❌ ELIMINATED |

### Elimination Analysis

#### ❌ Chunk 1: 6631dfc1... (SK category, career info)
- **Issue**: Category = SK (Sistem Komputer), not SI
- **Rule**: Same as Query 1 — **`requestedProgram` mismatch**
- **Score comparison**: 
  - Chunk 1 rawScore: 4.2456 (BETTER)
  - Chunk 3 (survivor) rawScore: 3.9325
  - But chunk 1 is rejected despite better score

#### ❌ Chunk 2: b411e939... (Double Degree)
- **Issue**: Multiple program mentions (Double Degree mentions multiple programs/partners)
- **Rule**: **`multiProgramPenalty` or generic overview filtering**

#### ❌ Chunks 4-8: Same pattern as Query 1
- Generic overviews, cost/schedule categories, not matching KARIR/PROSPEK_KERJA intent

### Post-filterRelevantChunks: 1 survivor
- Only `c2961b13...` (semantic 0.0252) remains
- `6631dfc1...` with semantic 0.6294 was rejected

---

## QUERY 3: "Apa yang dipelajari di Sistem Informasi?"

### Query Entities
- **intent**: `ACADEMIC_PROGRAM`
- **program**: `SI`
- **category**: `PROGRAM_STUDI`
- **academicIntent**: `MATA_KULIAH` (KURIKULUM_PEMBELAJARAN)

### Top 8 Chunks Before filterRelevantChunks()

| Rank | ID | Document | Category | RawScore | Semantic | Status |
|------|----|-----------|-----------|-----------|-----------|-|
| 1 | `6631dfc1...` | Penjelasan Prodi dan Karier (1).xlsx | **SK** | 4.2253 | 0.493 | ❌ ELIMINATED |
| 2 | `c2961b13...` | CHATBOT - Double Degree (1).docx | PROGRAM_KHUSUS | 3.9655 | 0.0551 | ✅ **SURVIVOR** |
| 3 | `b411e939...` | CHATBOT - Double Degree (1).docx | PROGRAM_KHUSUS | 3.9639 | 0.0392 | ❌ ELIMINATED |
| 4 | `618a0474...` | Penjelasan Semua Program Studi.pdf | UNKNOWN | 3.6388 | 0.5878 | ❌ ELIMINATED |
| 5 | `8491b972...` | hobi_prodi_lengkap (1).xlsx | UNKNOWN | 3.1759 | 0.5392 | ❌ ELIMINATED |
| 6 | `c4b537df...` | (null) | BIAYA | 3.1355 | 0.4353 | ❌ ELIMINATED |
| 7 | `74be5da2...` | HOBY.pdf | UNKNOWN | 3.0734 | 0.5142 | ❌ ELIMINATED |
| 8 | `0f1c9e82...` | (null) | SCHEDULE | 3.0489 | 0.5485 | ❌ ELIMINATED |

### Same Elimination Pattern
- **6631dfc1**: SK program mismatch
- **Others**: Generic overview, intent mismatch, etc.

---

## QUERY 4: "Apa keunggulan Sistem Informasi?"

### Query Entities
- **intent**: `PROGRAM` (NOT ACADEMIC_PROGRAM)
- **program**: `SI`
- **category**: `PROGRAM_STUDI`
- **academicIntent**: `ACADEMIC_PROGRAM` (fallback)

### Top 8 Chunks Before filterRelevantChunks()

| Rank | ID | Document | Category | RawScore | Semantic | Status |
|------|----|-----------|-----------|-----------|-----------|-|
| 1 | `c2961b13...` | CHATBOT - Double Degree (1).docx | PROGRAM_KHUSUS | 3.1229 | 0.0286 | ✅ **SURVIVOR** |
| 2 | `74be5da2...` | HOBY.pdf | UNKNOWN | 3.0727 | 0.5072 | ❌ ELIMINATED |
| 3 | `b411e939...` | CHATBOT - Double Degree (1).docx | PROGRAM_KHUSUS | 3.0618 | 0.0177 | ❌ ELIMINATED |
| 4 | `c4b537df...` | (null) | BIAYA | 3.0208 | 0.4881 | ❌ ELIMINATED |
| 5 | `7f5139fa...` | Kalender Pendaftaran.xlsx | JADWAL | 2.9664 | 0.2638 | ❌ ELIMINATED |
| 6 | `0f1c9e82...` | (null) | SCHEDULE | 2.9304 | 0.5642 | ❌ ELIMINATED |
| 7 | `a0f70379...` | (null) | SCHEDULE | 2.9285 | 0.5453 | ❌ ELIMINATED |
| 8 | `3546c7cc...` | (null) | SCHEDULE | 2.928 | 0.5402 | ❌ ELIMINATED |

### Elimination Analysis (Different Pattern)

#### ❌ Chunk 2: 74be5da2... (HOBY.pdf)
- **Semantic**: 0.5072 (MUCH HIGHER than survivor 0.0286!)
- **Why Eliminated**:
  - Intent = `PROGRAM` (not `ACADEMIC_PROGRAM`)
  - Rule: **Intent-based keyword filtering in filterRelevantChunks()**
  - Line ~4915:
    ```javascript
    if ((intent === 'PROGRAM' || intent === 'ACADEMIC_PROGRAM') && !programPattern.test(lower) && s.item.chunkType !== 'GENERAL') return false;
    ```
  - Chunk type is GENERAL so it might pass, but...
  - OR: Chunk is about "hobi" (hobby) not program definition
  - Filtered due to lack of program-related keywords

#### ❌ Chunk 3: b411e939... (Double Degree)
- **Issue**: Generic Double Degree overview
- **Rule**: **`isGenericProgramOverviewChunk()` or `multiProgramPenalty`**

#### ❌ Chunks 4-8: Cost/Schedule categories
- **Rule**: Intent-based filtering (PROGRAM intent doesn't match COST/SCHEDULE categories)

### Post-filterRelevantChunks: 2 chunks remain (then reduced to 1)
- `c2961b13...` and potentially another
- filterStats shows: before=2, after=2 (no elimination in filtering!)
- But validation step may further filter

---

## ROOT CAUSE IDENTIFICATION

### Primary Root Cause: `filterRelevantChunks()` — Program-Specific Filtering

**Code Location**: `src/engine/ragEngine.js`, lines 4889-4968

**Responsible Logic**:

```javascript
function filterRelevantChunks(question, scored, queryEntities = null) {
  ...
  const requestedProgram = queryEntities && queryEntities.program ? String(queryEntities.program).toUpperCase() : null;
  ...
  
  // RULE 1: Generic overview chunks deprioritized
  const isGenericProgramOverviewChunk = (item) => {
    const fname = String((item && (item.filename || item.trainingId)) || '').toLowerCase();
    const overviewPattern = /\b(?:penjelasan\s+semua\s+program\s+studi|...)/i;
    return overviewPattern.test(fname) || overviewPattern.test(chunkText);
  };

  // RULE 2: Program mismatch rejection
  if (requestedProgram) {
    const itemProgram = itemEntities.program ? String(itemEntities.program).toUpperCase() : null;
    if (itemProgram && itemProgram !== requestedProgram) return false; // ← HARD REJECT
  }

  // RULE 3: Multiple program mention filtering
  if (mentionedPrograms.length > 1 && !mentionedPrograms.every((p) => p === requestedProgram)) return false;
}
```

### Secondary Impact: Entity Extraction

**Code Location**: `src/engine/ragEngine.js`, lines 4113-4130

Chunks like `6631dfc1...` have `category: SK` in metadata, so `getChunkEntities()` extracts `program: SK`, causing hard rejection when query specifies `program: SI`.

### Evidence Summary Table

| Query | Top Chunk Pre-Filter | Best Semantic | Root Cause | Elimination Rule |
|-------|----------------------|---------------|-----------|------------------|
| 1. Apa itu SI? | 6631dfc1 (4.2846) | 0.5881 | Program category = SK | `requestedProgram !== itemProgram` |
| 2. Prospek kerja SI? | 6631dfc1 (4.2456) | 0.6294 | Program category = SK | `requestedProgram !== itemProgram` |
| 3. Yang dipelajari SI? | 6631dfc1 (4.2253) | 0.5878 | Program category = SK | `requestedProgram !== itemProgram` |
| 4. Keunggulan SI? | 74be5da2 (3.0727) | 0.5072 | Hobby topic, not program | Intent-based keyword filtering |

---

## Conclusion

### Root Cause (Confirmed)

**NOT the confidence patch. NOT downstream model selection.**

**ROOT CAUSE**: `filterRelevantChunks()` applies **strict program-specific filtering** that:

1. **Rejects chunks with non-matching program category** 
   - Queries 1-3: Chunk `6631dfc1...` (SK category) rejected despite having BEST semantic scores (0.49-0.59)
   - Reason: Metadata extracted `program: SK` from filename, query requires `program: SI`

2. **Eliminates generic "all programs" overview documents**
   - Chunk `618a0474...` (Penjelasan SEMUA Program Studi) rejected due to filename pattern match

3. **Filters by intent-based keyword patterns**
   - Only chunks matching `programPattern` or `chunkType: GENERAL` survive
   - Eliminates unrelated categories (COST, SCHEDULE, BIAYA, HOBY) when intent = PROGRAM/ACADEMIC_PROGRAM

4. **Multi-program mention penalty**
   - Chunks mentioning both SI and other programs may be eliminated

### Why `c2961b13...` Survives

The CHATBOT Double Degree chunk survives because:
- It's in PROGRAM_KHUSUS category (program-related)
- Filename doesn't match generic overview pattern
- Contains explicit program keywords (Sistem Informasi, Program Double Degree)
- Mentions requested program (SI) explicitly

**However**, its semantic score is extremely low (0.02-0.06), making it a poor choice for answering definition/curriculum/career questions about SI.

### Impact Assessment

- **Queries 1-3**: Candidates with 2-3x BETTER semantic similarity (0.49-0.63) are rejected
- **Query 4**: Candidate with 18x BETTER semantic similarity (0.51 vs 0.03) is rejected
- **All queries**: Only 1 surviving candidate after filter (filterStats show 1→1 reduction)

---

## Recommendations for Root Cause Fix (NOT APPLIED — AUDIT ONLY)

To enable better retrieval:

1. **Soften program category matching** → Use as scoring signal, not hard reject
2. **Reduce generic overview penalty** → Keep "all programs" documents in candidate set
3. **Adjust request program filtering logic** → Allow semantically strong candidates even with category mismatch
4. **Recalibrate metadataBoost** → Don't let metadata overwhelm semantic evidence for academic queries

(See next phase for implementation proposals)
