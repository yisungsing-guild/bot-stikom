# CHUNK 6631DFC1 — METADATA vs ACTUAL CONTENT

## Side-by-Side Comparison

### What Metadata Claims:

```
┌────────────────────────────────────────┐
│ Category: SK (Sistem Komputer)         │
│                                        │
│ Profile:                               │
│ • Computer Science focused             │
│ • Hardware/Architecture                │
│ • Network Systems                      │
│ • IoT & Embedded Systems               │
│ • Robotics & Automation                │
└────────────────────────────────────────┘
```

### What Actual Content Says:

```
┌────────────────────────────────────────┐
│ Content About: Manajemen Informasi     │
│ (+ mentions of Sistem Informasi)       │
│                                        │
│ Profile:                               │
│ ✓ Database Management                  │
│ ✓ Information Administration            │
│ ✓ Data Processing                      │
│ ✓ Digital Archive Management           │
│ ✓ IT Administration                    │
│ ✓ Career: Data Admin, IT Admin        │
└────────────────────────────────────────┘
```

---

## Detailed Program Breakdown

### Expected SK Content (from Chunk 59ad2190 for comparison)
```
"Sistem Komputer | Program Studi Sistem Komputer menghasilkan lul[usan]"
"IoT Engineer | Hardware Engineer | Robotics Engineer | Network Engineer | 
 Automation Engineer | Embedded System Engineer"
```
→ Focus: Hardware, networks, IoT, robotics

### Actual Content in 6631dfc1
```
"Manajemen Informasi | Program studi ini merupakan pendidikan vokasi yang 
menanamkan kompetensi untuk siap kerja... Web Developer | Database Administrator 
| dan IT Entrepreneur... Pengelolaan database | arsip digital | 
administrasi sistem informasi | data processing | dokumentasi digital... 
Data Administrator | Database Staff | Information Management Staff | 
IT Administration | Document Controller | Digital Archive Staff"
```
→ Focus: Database, administration, information management, data

---

## Program Classification Matrix

### Based on Keywords Found:

```
┌──────────────────────────────────────────────────────────────┐
│ SI (Sistem Informasi)                                        │
│ ✓ "administrasi sistem informasi" mentioned                 │
│ ✓ IT roles (Web Dev, IT Entrepreneur) mentioned             │
│ ✓ System administration focus                                │
│ Score: 30-40% (secondary mentions)                           │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ MI (Manajemen Informasi)                                     │
│ ✓✓ "Manajemen Informasi" EXPLICITLY stated                  │
│ ✓✓ Database focus (7+ db-related keywords)                  │
│ ✓✓ Administration/Management roles                           │
│ ✓✓ Information management (archives, data, docs)            │
│ ✓✓ Perfect match with MI job titles                         │
│ Score: 80-90% (primary focus) ← BEST MATCH                  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ SK (Sistem Komputer)                                         │
│ ✗ Zero mentions of computer systems                         │
│ ✗ Zero mentions of hardware                                 │
│ ✗ Zero mentions of networks/IoT                             │
│ ✗ Opposite focus: admin/data not hardware/robotics          │
│ Score: 0% (no matches) ← WORST MATCH                        │
└──────────────────────────────────────────────────────────────┘
```

---

## Training Data Structure (Same File)

```
File: Penjelasan Prodi dan Karier Masa Depan (1).xlsx

Excel Row 1: Sistem Informasi
  └─ Chunk 81881ff1 → Category: KURIKULUM (talks about SI)

Excel Row 2: Sistem Komputer  
  └─ Chunk 59ad2190 → Category: KURIKULUM (talks about SK)

Excel Row 3: Bisnis Digital
  └─ Chunk 52b64e6e → Category: KARIR (talks about BD)

Excel Row 4 or 5?: Manajemen Informasi (or other program)
  └─ Chunk 6631dfc1 → Category: SK ❌ WRONG!
      (Actually talks about MI, not SK)
```

---

## Root Cause: Where Did SK Come From?

### Theory 1: File-Level Classification
**Status**: ❌ UNLIKELY
- If file was classified as SK, all chunks would be
- But sibling chunks have correct categories
- Each chunk has own category

### Theory 2: Row Header Extraction
**Status**: ✅ MOST LIKELY
- Excel row should have had "Manajemen Informasi" header
- SK might be from NEXT column or wrong cell
- Text extraction error during training
- Evidence: Text starts with truncated "ecialist" (should be full word)

### Theory 3: Entity Extraction Bug
**Status**: ⚠️ POSSIBLE
- getChunkEntities() might have reversed logic
- Assigned wrong program based on content
- Would explain why SK assigned to non-SK content

### Theory 4: Manual Labeling Error
**Status**: ❌ UNLIKELY
- Would need deliberate mistake
- Other chunks labeled correctly
- Suggests automated, not manual

**Conclusion**: Likely **row/cell extraction error** during training data processing

---

## Impact Timeline

### When Error Occurred
```
1. Source: Excel file "Penjelasan Prodi dan Karier Masa Depan (1).xlsx"
2. Training: During training data upload/parsing
3. Result: Wrong category assigned to chunk
4. Persistence: Now in RAG index
5. Effect: Chunk filtered incorrectly in queries
```

### Queries Affected
```
Query 1: "Apa itu Sistem Informasi?" 
  → Chunk rejected due to SK ≠ SI mismatch

Query 2: "Apa prospek kerja Sistem Informasi?"
  → Chunk rejected due to SK ≠ SI mismatch

Query 3: "Apa yang dipelajari Sistem Informasi?"
  → Chunk rejected due to SK ≠ SI mismatch

Query 4: "Apa keunggulan Sistem Informasi?"
  → Chunk may not be in top 8 (different query logic)
```

---

## Semantic vs Metadata Scores

### Query 1: "Apa itu Sistem Informasi?"

```
Chunk 6631dfc1 Scoring:
┌────────────────────────────────────────┐
│ Semantic Score:      0.4861 (HIGH)     │
│ ↑ Strong semantic match with query     │
│                                        │
│ MetadataBoost:       3.29              │
│ ↑ Program category bonus               │
│                                        │
│ RawScore:            4.2846            │
│ ↑ Rank 1 (before filtering)            │
│                                        │
│ After filterRelevantChunks():          │
│ ↓ ELIMINATED (SK ≠ SI)                │
│ ↓ High score doesn't matter           │
└────────────────────────────────────────┘
```

### Paradox
```
❓ Why is chunk ranked #1 by embedding if it's not SK?
   → Because semantic similarity ≠ program category

❓ Why does metadata say SK if content is MI?
   → Extraction/labeling error during training

❓ Why doesn't high semantic score save it?
   → Hard-reject filtering happens before scoring matters
```

---

## Correction Impact Scenarios

### Scenario A: Keep Current (No Change)
```
Status Quo:
  • Chunk: SK labeled, MI content
  • Query (SI): Chunk eliminated ✗
  • Query (MI): Not extracted for MI (no MI query yet)
  • Quality: Medium (chunk lost despite relevance)
  • Fix: None
```

### Scenario B: Fix Metadata to MI
```
After Correction:
  • Chunk: MI labeled, MI content ✓
  • Query (SI): Chunk still eliminated (MI ≠ SI) ✓
  • Query (MI): Chunk now available ✓✓
  • Quality: Higher (enables MI queries)
  • Fix: Update category field
```

### Scenario C: Fix Metadata to SI
```
After Correction:
  • Chunk: SI labeled, MI content (imperfect)
  • Query (SI): Chunk now available ✓
  • Query (MI): Not available unless SI treats as MI
  • Quality: Good for SI queries
  • Fix: Update category field
```

### Scenario D: Soften Filter + Keep SK
```
After Softening (Line 4956):
  • Chunk: SK labeled, MI content
  • Query (SI): Available if semantic > 0.5 ✓
  • Semantic: 0.4861 (borderline)
  • Quality: Medium (may not reach if others score higher)
  • Fix: Modify filtering logic
```

---

## Verdict Matrix

| Aspect | Current | Should Be | Confidence |
|--------|---------|-----------|------------|
| **Metadata Field** | SK | MI | 🔴 95% |
| **Content Focus** | N/A | Manajemen Informasi | 🔴 95% |
| **Program Mentions** | 0 SK | 1 MI, 1 SI | 🔴 100% |
| **Career Track** | Mismatch | Database/Admin | 🔴 95% |
| **Sibling Accuracy** | Compare | All correct | 🔴 100% |

---

## Conclusion

### Metadata Correctness: ❌ INCORRECT (95% confidence)

### What To Do:
1. **Primary**: Change `category` from `SK` → `MI` in training data
2. **Supporting**: Add text-based extraction fallback
3. **Optional**: Soften hard-reject rule for high-semantic chunks

### No Code Changes Needed?: 
- For filtering logic itself: ❌ Already works correctly (chunk was eliminated as intended)
- For data quality: ✅ Metadata needs fix (separate from filtering)

### Impact on Audit:
- ✅ Confirms that `filterRelevantChunks()` is the bottleneck
- ✅ Metadata accuracy is secondary issue
- ✅ Fixing metadata won't change Query 1-3 behavior (different programs)
- ✅ But fixing enables future MI/SI-related queries

