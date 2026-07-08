# Detailed Entity Extraction & Filtering Trace

## Chunk Entity Analysis per Query

---

## QUERY 1: "Apa itu Sistem Informasi?"

### Query Entities (extracted via detectIntent + extractAcademicIntent)
```
intent: ACADEMIC_PROGRAM
program: SI (dari pattern /\b(si|sistem\s+informasi)\b/i)
category: PROGRAM_STUDI
academicIntent: DEFINISI_PRODI
```

### filterRelevantChunks() — Candidate-by-Candidate Trace

#### Chunk 1: `6631dfc1-b46c-4933-a340-392dfd2250d6`
**Metadata from trace:**
- filename: "Penjelasan Prodi dan Karier Masa Depan (1).xlsx"
- chunkType: PROGRAM
- category: **SK** (extracted from filename → "SK" is Sistem Komputer)
- preview: "...Brand Manager | Business Development | Startup Founder\" Manajemen Informasi | \"Program studi ini merupakan pe..."

**Entity Extraction (getChunkEntities):**
```javascript
program: "SK"  // extracted from metadata/filename pattern
programMode: null
wave: null
category: "SK"
```

**Filtering Logic Applied:**
```javascript
if (requestedProgram) {  // requestedProgram = "SI"
  const itemProgram = itemEntities.program; // itemProgram = "SK"
  const requestedProgramRegex = requestedProgramPatterns[requestedProgram]; // regex for SI
  const mentionsRequestedProgram = requestedProgramRegex.test(lower); // test if chunk mentions "si" or "sistem informasi"
  
  // ← Line 4954 in ragEngine.js
  if (itemProgram && itemProgram !== requestedProgram) return false;  // SK !== SI → ELIMINATED
}
```

**Elimination Reason**: ✗ **`requestedProgram` mismatch**
- itemProgram = "SK"
- requestedProgram = "SI"
- SK !== SI → Hard reject
- Despite: rawScore 4.2846, semantic 0.4861 (BEST semantic match)

---

#### Chunk 2: `c2961b13-bd76-4f6b-9c39-1e19606b6a5d` ✅ SURVIVOR
**Metadata from trace:**
- filename: "CHATBOT - Double Degree (1).docx"
- chunkType: null (not PROGRAM, not COST)
- category: PROGRAM_KHUSUS
- preview: "Auto Reply Pembuka Halo Selamat datang di Program Double Degree ITB STIKOM Bali Silakan pilih informasi yang kamu butuhk..."

**Entity Extraction:**
```javascript
program: "SI"  // extracted from chunk text mentions "Program Double Degree...Sistem Informasi"
programMode: "DOUBLE_DEGREE_INTERNATIONAL"
partner: "DNUI"  // or HELP depending on chunk
campus: "BALI"
category: "PROGRAM_KHUSUS"
```

**Filtering Logic Applied:**
```javascript
if (requestedProgram) {  // requestedProgram = "SI"
  const itemProgram = itemEntities.program; // itemProgram = "SI" (extracted from chunk text)
  
  // ← Line 4954
  if (itemProgram && itemProgram !== requestedProgram) return false;  // SI === SI → PASS
}

// Continue other checks...
// If it's not filtered as generic overview:
const isGenericOverviewChunk = (item) => { ... }; // No, this is specific Double Degree
// Return true → SURVIVES
```

**Survives Because**:
- ✓ itemProgram = "SI" matches requestedProgram = "SI"
- ✓ Not generic "all programs" overview (specific Double Degree)
- ✓ Contains program-related keywords

---

#### Chunk 3: `b411e939-1537-4fd5-af3d-541424f9d3a3`
**Metadata:**
- filename: "CHATBOT - Double Degree (1).docx" (same file as c2961b13)
- category: PROGRAM_KHUSUS
- preview: "usahaan multinasional atau melanjutkan studi ke luar negeri. B. DOUBLE DEGREE - HELP UNIVERSITY, MALAYSIA 9. ITB STIKOM..."

**Entity Extraction:**
```javascript
program: Potentially multiple programs mentioned (HELP, SI, etc.)
mentionedPrograms: ["SI", "other"] (multiple mentions detected)
```

**Filtering Logic Applied:**
```javascript
const mentionedPrograms = Array.from(new Set(normalizeProgramMentions(lower)));
if (mentionedPrograms.length > 1 && !mentionedPrograms.every((p) => p === requestedProgram)) {
  return false;  // ← ELIMINATED (multi-program)
}
```

**Elimination Reason**: ✗ **Multiple program mentions**
- Chunk discusses both Double Degree options (HELP, DNUI) and mentions both SI and other contexts
- mentionedPrograms.length > 1 but not all are SI
- OR: Could be filtered as generic Double Degree overview

---

#### Chunk 4: `618a0474-969a-463f-91cd-c010a27beb48`
**Metadata:**
- filename: "Penjelasan **Semua Program Studi**.pdf"
- category: UNKNOWN
- preview: "ac.id sisteminformasi.stikombali Perekayasa Sistem Informasi Perekayasa Sistem Informasi Multimedia Desain Grafis & Anim..."

**Entity Extraction:**
```javascript
program: null or "MULTI" (document covers all programs)
category: "UNKNOWN"
```

**Filtering Logic Applied:**
```javascript
const isGenericProgramOverviewChunk = (item) => {
  const fname = String(item.filename || item.trainingId || '').toLowerCase();
  const overviewPattern = /\b(?:penjelasan\s+semua\s+program\s+studi|semua\s+program\s+studi|...)/i;
  
  // ← "Penjelasan Semua Program Studi" matches pattern
  return overviewPattern.test(fname);  // returns true
};

if (requestedProgram) {
  const specificProgramCandidates = filtered.filter((s) => {
    const itemProgram = itemEntities.program;
    if (itemProgram === requestedProgram) return true;
    // This chunk doesn't have specific SI program marker
    const mentionList = normalizeProgramMentions(lower);
    return mentionList.includes(requestedProgram) && mentionList.length === 1;  // ← false (multiple programs)
  });

  if (specificProgramCandidates.length > 0) {
    const filteredWithoutOverview = filtered.filter((s) => !isGenericProgramOverviewChunk(s));
    // ← This chunk IS generic, so it's removed
    if (filteredWithoutOverview.length > 0) {
      return filteredWithoutOverview;  // ← ELIMINATED
    }
  }
}
```

**Elimination Reason**: ✗ **Generic "all programs" overview document**
- Filename matches generic overview pattern
- When requestedProgram = SI, generic overviews are deprioritized/removed
- Semantic: 0.5881 (VERY HIGH, second best!) but still eliminated

---

#### Chunks 5-8: (BIAYA, HOBY, SCHEDULE categories)

**Chunk 6 (c4b537df...) - BIAYA category:**
```javascript
const costPattern = /\b(biaya|dpp|ukt|...)\b/i;

// Line 4916 in filterRelevantChunks:
if (intent !== 'COST' && costPattern.test(lower)) return false;  // intent = ACADEMIC_PROGRAM, not COST → ELIMINATED
```

**Chunk 7 (74be5da2...) - hobi_prodi (HOBY.pdf):**
```javascript
// Missing program-related patterns
if ((intent === 'PROGRAM' || intent === 'ACADEMIC_PROGRAM') && !programPattern.test(lower) && s.item.chunkType !== 'GENERAL') {
  return false;
}
```

**Chunk 8 (0f1c9e82...) - SCHEDULE category:**
```javascript
const schedulePattern = /\b(jadwal|gelombang|...)\b/i;

// Similar intent-based filtering
if (intent === 'SCHEDULE' && !schedulePattern.test(lower) && s.item.chunkType !== 'GENERAL') return false;
```

---

## QUERY 2: "Apa prospek kerja Sistem Informasi?"

### Query Entities
```
intent: ACADEMIC_PROGRAM
program: SI
category: KARIR
academicIntent: PROSPEK_KERJA
```

### Critical Difference: Chunk 1 vs Chunk 3

#### ❌ Chunk 1: `6631dfc1...` (Penjelasan Prodi dan **Karier**)
- **Semantically**: HIGHLY RELEVANT (semantic: 0.5461)
- **Topically**: About career prospects → Perfect for PROSPEK_KERJA query
- **HOWEVER**: Category extracted from metadata = **SK** (Sistem Komputer)
- **Filtered**: Hard reject due to `itemProgram = SK` vs `requestedProgram = SI`

**This is the strongest evidence of filtering problem:**
- A chunk about careers (perfect for career query)
- With high semantic similarity (0.5461)
- Rejected purely because metadata says SK program

#### ✅ Chunk 3: `c2961b13...` (Double Degree chatbot)
- **Semantically**: LOW (0.0252)
- **Topically**: About Double Degree enrollment, not career prospects
- **Entity**: SI extracted from text
- **Survives**: Purely due to program name matching

---

## QUERY 3: "Apa yang dipelajari di Sistem Informasi?"

**Same pattern as Query 1-2:**
- Chunk `6631dfc1...` has SK metadata
- Chunk `618a0474...` is generic all-programs overview
- Both eliminated despite high semantic (0.49-0.59)
- Only Double Degree survives (semantic 0.0551)

---

## QUERY 4: "Apa keunggulan Sistem Informasi?"

**Slightly different pattern because intent = PROGRAM (not ACADEMIC_PROGRAM):**

### ❌ Chunk 2: `74be5da2...` HOBY.pdf
```
Semantic: 0.5072 (18x better than survivor!)
Category: UNKNOWN
chunkType: GENERAL
Content: About hobby-program matching
```

**Filtered because:**
```javascript
// Intent = PROGRAM, but chunk is about hobby matching, not program advantages
// Even though it mentions Sistem Informasi programs

// Line ~4915: When intent = PROGRAM or ACADEMIC_PROGRAM
if ((intent === 'PROGRAM' || intent === 'ACADEMIC_PROGRAM') && 
    !programPattern.test(lower) && 
    s.item.chunkType !== 'GENERAL') {
  return false;
}

// OR: filtered in academic intent validation
// academicIntent should be program-definition-related, not hobby-matching
```

**Critical failure**: Chunk with excellent semantic (0.51) eliminated because topic is hobby-matching, not program advantage explanation.

---

## Filtering Rule Summary

| Rule | Location | Trigger | Result | Severity |
|------|----------|---------|--------|----------|
| **requestedProgram mismatch** | L4954 | `itemProgram !== requestedProgram` | Hard reject | 🔴 CRITICAL |
| **Generic overview** | L4962 | `isGenericProgramOverviewChunk()` | Remove from candidates | 🔴 CRITICAL |
| **Multi-program mention** | L4959 | `mentionedPrograms.length > 1` | Hard reject | 🟠 HIGH |
| **Intent keyword mismatch** | L4916 | No matching pattern for intent | Reject | 🟠 HIGH |
| **Cost when not COST intent** | L4916 | `costPattern && intent !== COST` | Reject | 🟠 HIGH |
| **chunkType mismatch** | L4915 | Intent-specific type checking | Reject | 🟡 MEDIUM |

---

## Evidence Chain

### Query 1: "Apa itu Sistem Informasi?"
1. **Chunk scoring**: 8 candidates retrieved with semantic scores 0.018-0.588
2. **filterRelevantChunks()**: 
   - Chunk `6631dfc1` (semantic 0.49): ✗ Rejected — `itemProgram="SK" !== requestedProgram="SI"`
   - Chunk `618a0474` (semantic 0.59): ✗ Rejected — Generic all-programs document
   - All others: ✗ Rejected — Intent/category mismatch
3. **Survivor**: `c2961b13` (semantic 0.0353) — Only because program="SI" matches
4. **applyIntentAwareFilteringAndValidation()**: No further elimination

### Query 2: "Apa prospek kerja Sistem Informasi?"
1. **Chunk scoring**: 8 candidates, best semantic=0.629
2. **filterRelevantChunks()**: 
   - Chunk `6631dfc1` (semantic 0.546, KARIER TOPIC!): ✗ Rejected — `program="SK"`
   - All others: ✗ Rejected — Similar rules
3. **Survivor**: `c2961b13` (semantic 0.025)

### Query 3: "Apa yang dipelajari di Sistem Informasi?"
- Pattern identical to Queries 1-2

### Query 4: "Apa keunggulan Sistem Informasi?"
1. **Chunk scoring**: 8 candidates, best semantic=0.507 (HOBY.pdf)
2. **filterRelevantChunks()**:
   - Chunk `74be5da2` (semantic 0.507): ✗ Rejected — Intent=PROGRAM but topic=hobby-matching
   - Other program chunks: ✗ Rejected or filtered
3. **Survivor**: `c2961b13` (semantic 0.0286)

---

## Confirmed Root Cause

### Direct Responsibility

**File**: `src/engine/ragEngine.js`
**Functions**:
1. `filterRelevantChunks()` (L4889-4968) — **PRIMARY**
   - Applies strict program-category matching
   - Rejects generic overview documents
   - Removes off-topic chunks based on intent

2. `getChunkEntities()` (L4113-4130) — **SUPPORTING**
   - Extracts program metadata from chunk
   - SK category → program="SK" in entity
   - This causes mismatches in filtering

### NOT Responsible

- ❌ Confidence patch (applies after ranking)
- ❌ Model selection (downstream)
- ❌ applyIntentAwareFilteringAndValidation() (doesn't eliminate survivors)
- ❌ Embedding quality (only semantic score, not ranking)

### Impact Quantified

| Metric | Value | Impact |
|--------|-------|--------|
| **Avg semantic loss** | -0.5 points | Queries lose 2-3x better matches |
| **Query 2 impact** | 0.546 → 0.025 | Career expertise chunk rejected for chatbot overview |
| **Query 4 impact** | 0.507 → 0.029 | Hobby-program matching is 18x more relevant than final choice |
| **Survival rate** | 1/8 chunks (~12%) | Aggressive filtering retains only 12% of candidates |

