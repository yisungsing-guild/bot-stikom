# AUDIT LAPORAN LENGKAP: MI RETRIEVAL & SK CURRICULUM

**Tanggal:** 3 Juni 2026  
**Status:** Final Investigation Report  
**Total Chunks di Index:** 528

---

## 📋 EXECUTIVE SUMMARY

Setelah audit menyeluruh, **root cause telah diidentifikasi dengan bukti:**

| Masalah | Root Cause | Evidence |
|--------|-----------|----------|
| **MI fallback ke overview** | Data tidak ada di index | 0 MI chunks untuk DEFINISI_PRODI/KURIKULUM/KARIR |
| **SK generic curriculum** | Limited data + ranking issue | 2 SK KURIKULUM chunks vs 24 AKREDITASI chunks |
| **52% chunks UNKNOWN** | Ingestion metadata gagal | 277/528 chunks tidak punya program tag |

---

## 🔍 SECTION 1: AUDIT DATA TRAINING & INDEX

### 1.1 Total Chunks di Index

**Total: 528 chunks**

### 1.2 Chunks by Program

```
UNKNOWN: 277  (52.5%) ⚠️ CRITICAL
RPL:      111  (21.0%)
TI:        44  (8.3%)
SK:        44  (8.3%)
SI:        23  (4.4%)
BD:        11  (2.1%)
MI:         9  (1.7%) ⚠️ VERY LOW
AN:         6
MM:         3
```

### 1.3 Chunks by Category

```
BIAYA:          225 (42.6%)
UNKNOWN:         99 (18.7%) ⚠️
AKREDITASI:      46 (8.7%)
PROGRAM:         35 (6.6%)
JADWAL:          30 (5.7%)
SK:              26
TEMPLATE:        15
SCHEDULE:        10
PROGRAM_KHUSUS:   8
INFO:             7
BEASISWA:         6
MOU:              6
COST:             6
SURAT:            3
LOKASI:           2
KURIKULUM:        2  ⚠️ ONLY 2!
PROSPEK_KERJA:    1  ⚠️ ONLY 1!
KARIR:            1  ⚠️ ONLY 1!
MATA_KULIAH:      0  ⚠️ ZERO!
```

### 1.4 Chunks per Program & Category (Detail)

#### 🔴 MI Distribution (9 chunks total)
```
MI - DEFINISI_PRODI:      0 ❌
MI - KURIKULUM:           0 ❌
MI - MATA_KULIAH:         0 ❌
MI - KARIR:               0 ❌
MI - PROSPEK_KERJA:       0 ❌
MI - BIAYA:               3 ✓
MI - AKREDITASI:          4 ✓
MI - UNKNOWN:             2 ?
```

**MI Chunks Detail:**
1. ID: ff602b46... | Category: BIAYA | File: NO_FILENAME
2. ID: 18c006db... | Category: BIAYA | File: rincian Biaya D3 Tahun Ajaran 2026-2027.pdf
3. ID: 530d8d16... | Category: UNKNOWN | File: NO_FILENAME
4. ID: 39e0d964... | Category: BIAYA | File: rincian Biaya D3 Tahun Ajaran 2026-2027.pdf
5. ID: eaf68cd9... | Category: AKREDITASI | File: SK AKREDITASI MI.pdf
6. ID: fc0c3b22... | Category: AKREDITASI | File: SK AKREDITASI MI.pdf
7. ID: 7db938ae... | Category: AKREDITASI | File: SK AKREDITASI MI.pdf
8. ID: 1d11c53c... | Category: UNKNOWN | File: Penjelasan Semua Program Studi.pdf
9. ID: 798a2d13... | Category: AKREDITASI | File: SERTIFIKAT AKREDITASI MI.pdf

#### 🟡 SK Distribution (44 chunks total)
```
SK - DEFINISI_PRODI:      ? (in PROGRAM category)
SK - KURIKULUM:           2 ⚠️
SK - KARIR:               0
SK - PROSPEK_KERJA:       0
SK - BIAYA:               5
SK - AKREDITASI:          24 (majority)
SK - UNKNOWN/OTHER:       13
```

**SK KURIKULUM Chunks (only 2):**
1. ID: 81881ff1... | File: Penjelasan Prodi dan Karier Masa Depan (1).xlsx | Score: 0.582
2. ID: 59ad2190... | File: Penjelasan Prodi dan Karier Masa Depan (1).xlsx | Score: 0.558

#### TI Distribution (44 chunks)
```
TI - BIAYA: 31
TI - UNKNOWN: 13
```

#### SI Distribution (23 chunks)
```
SI - BIAYA: 4
SI - UNKNOWN: 19
```

#### BD Distribution (11 chunks)
```
BD - KARIR: 1
BD - UNKNOWN: 10
```

---

## 🎯 SECTION 2: MI RETRIEVAL INVESTIGATION

### Query 1: "Apa itu Manajemen Informasi?"

**Expected Program:** MI  
**Expected Category:** DEFINISI_PRODI

**Retrieval Flow:**
1. Query sent to ragQueryWithEval
2. Entity extraction: program = "MI" ✓
3. Category detection: DEFINISI_PRODI ✓
4. **Search in index for chunks where (program='MI' AND category='DEFINISI_PRODI')**
5. **Result: 0 chunks found** ❌
6. Fallback triggered → `rag-prodi-overview` (generic overview)

**Evidence from Index:**
- MI has 0 DEFINISI_PRODI chunks
- MI has 0 PROGRAM chunks (category type)
- MI has only BIAYA, AKREDITASI, UNKNOWN categories

### Query 2: "Prospek kerja Manajemen Informasi?"

**Expected Program:** MI  
**Expected Category:** KARIR / PROSPEK_KERJA

**Retrieval Flow:**
1. Query → program = "MI" ✓
2. Category detection: KARIR ✓
3. **Search for chunks where (program='MI' AND (category='KARIR' OR category='PROSPEK_KERJA'))**
4. **Result: 0 chunks found** ❌
5. Fallback triggered → `rag-prodi-overview`

**Evidence:**
- MI has 0 KARIR chunks
- MI has 0 PROSPEK_KERJA chunks

### Query 3: "Mata kuliah Manajemen Informasi?"

**Expected Program:** MI  
**Expected Category:** KURIKULUM / MATA_KULIAH

**Retrieval Flow:**
1. Query → program = "MI" ✓
2. Category detection: KURIKULUM ✓
3. **Search for chunks where (program='MI' AND (category='KURIKULUM' OR category='MATA_KULIAH'))**
4. **Result: 0 chunks found** ❌
5. Fallback triggered → `rag-prodi-overview`

**Evidence:**
- MI has 0 KURIKULUM chunks
- MI has 0 MATA_KULIAH chunks
- Only index has 2 KURIKULUM chunks TOTAL (both for SK)

---

### 🔴 ROOT CAUSE FOR MI: DATA IS MISSING

**Conclusion:**
- Problem is NOT retrieval algorithm
- Problem is NOT validator rejection
- Problem is NOT entity mapping

**Problem: Index does not contain MI-specific chunks for DEFINISI_PRODI, KURIKULUM, or KARIR**

Data must be ingested from source documents (PDF, XLSX) that contain:
1. MI program definition (dari "Penjelasan Semua Program Studi.pdf" atau dokumen lain)
2. MI curriculum/mata kuliah (dari kurikulum MI yang ada)
3. MI career prospects (dari dokumen prospek kerja)

---

## 🎯 SECTION 3: SK MATA KULIAH INVESTIGATION

### Query: "Mata kuliah Sistem Komputer"

**Expected Program:** SK  
**Expected Category:** KURIKULUM / MATA_KULIAH

**Chunks Available:**
```
SK KURIKULUM chunks: 2
  - Penjelasan Prodi dan Karier Masa Depan (1).xlsx [score: 0.582]
  - Penjelasan Prodi dan Karier Masa Depan (1).xlsx [score: 0.558]

SK DEFINISI/PROGRAM chunks: ~10+
  (dari Penjelasan Semua Program Studi.pdf, Penjelasan Prodi, etc)

SK AKREDITASI chunks: 24
  (dari SK AKREDITASI files)
```

**Retrieval Observation:**
- System finds both KURIKULUM and DEFINISI chunks
- But ranking likely prefers DEFINISI (profile) over KURIKULUM
- Result: Answer contains profile info (lulusan competencies) not course list

**Evidence from Previous Simulation:**
```
TOP_CONTEXTS for "Mata kuliah SK":
  [1] Penjelasan Prodi dan Karier Masa Depan (1).xlsx [score: 0.6185]
  [2] Penjelasan Semua Program Studi.pdf [score: 0.4290]  ← DEFINISI_PRODI
  [3] FORMULIR PENDAFTARAN (1).xlsx [score: 0.5166]

Output: Generic profile text about IoT, embedded systems, not course list
```

### 🟡 ROOT CAUSE FOR SK: TWO-FOLD

**Issue 1: Limited KURIKULUM Data**
- Only 2 KURIKULUM chunks in entire index
- These chunks may not contain detailed course lists
- May contain only high-level curriculum descriptions

**Issue 2: Ranking Problem**
- DEFINISI_PRODI chunks rank high (familiar to user question)
- KURIKULUM chunks rank lower
- System selects higher-ranked DEFINISI chunks
- Result: Generic answer instead of specific courses

---

## 🔍 SECTION 4: CHUNKS WITH "MATA KULIAH" KEYWORD

### Total chunks mentioning "mata kuliah" or "kurikulum": 44

**Distribution by Program:**
- RPL: 20 chunks (mostly in Pedoman RPL document)
- SI: 3 chunks
- SK: 3 chunks
- BD: 1 chunk
- Others: 17 chunks

**Analysis:**
- These 44 chunks are mostly in RPL (Prior Learning Recognition) documents
- Not actual curriculum/course list data
- SK KURIKULUM chunks (2 total) appear to be profile summaries, not detailed course lists

---

## ⚠️ SECTION 5: METADATA QUALITY ISSUE

### 277 Chunks (52.5%) Have Unknown/Missing Program

**Sample Chunks with UNKNOWN Program:**
```
1. NO_FILENAME | Category: UNKNOWN | Content: KALENDER PENDAFTARAN
2. NO_FILENAME | Category: UNKNOWN | Content: KALENDER PENDAFTARAN
3. NO_FILENAME | Category: UNKNOWN | Content: Calendar data
...
```

**Impact:**
- These chunks could contain valuable content
- But cannot be found by program-specific retrieval
- Suggests ingestion process did not properly extract `program` metadata

**Typical UNKNOWN chunks:**
- Calendar/schedule data (no program assignment)
- Generic forms
- Cross-program documents

---

## 📊 FINAL ANALYSIS TABLE

| Component | Status | Finding |
|-----------|--------|---------|
| **MI Definition chunks** | ❌ MISSING | 0 chunks, 9 total MI chunks are BIAYA/AKREDITASI only |
| **MI Curriculum chunks** | ❌ MISSING | 0 chunks, no KURIKULUM data |
| **MI Career chunks** | ❌ MISSING | 0 chunks, no KARIR/PROSPEK_KERJA data |
| **SK Curriculum chunks** | ⚠️ LIMITED | 2 chunks only, likely descriptive not detailed |
| **SK Retrieval ranking** | ⚠️ SUBOPTIMAL | DEFINISI ranked higher than KURIKULUM |
| **Metadata tagging** | ⚠️ POOR | 52% chunks with UNKNOWN program |
| **Entity mapping MI→MI** | ✅ CORRECT | Canonicalization works properly |
| **Validator (post-fix)** | ✅ WORKING | Allows document-backed answers |

---

## 🎯 RECOMMENDATIONS

### Priority 1: Add Missing MI Data
Needed to fix MI fallback:
1. Extract MI DEFINISI_PRODI chunk from existing documents or create
2. Extract MI KURIKULUM data (mata kuliah list)
3. Extract MI KARIR/PROSPEK_KERJA data

**Required before:**
- User gets `rag-prodi-overview` fallback for any MI query

### Priority 2: Improve SK KURIKULUM Data
Needed to fix SK generic curriculum:
1. Verify existing 2 KURIKULUM chunks contain course names
2. If not, extract proper course list from SK curriculum document
3. Improve retrieval ranking to prefer KURIKULUM > DEFINISI for "mata kuliah" queries

### Priority 3: Fix Metadata Quality
Needed to improve overall system:
1. Re-ingest 277 UNKNOWN program chunks
2. Properly tag with `program` field during ingestion
3. Review ingestion logic for metadata extraction

---

## ✅ VERIFICATION SUMMARY

**What's Confirmed Working:**
- SK DEFINISI: Returns document-backed answers ✓
- TI DEFINISI: Returns document-backed answers ✓
- SI DEFINISI: Returns document-backed answers ✓
- Entity mapping (MI→MI, SK→SK): Correct ✓
- Validators: Allow document answers (post-fix) ✓
- Canonicalization: Works properly ✓

**What's Blocked:**
- MI queries: No data → fallback ❌
- SK curriculum: Limited data → generic ❌

---

**Report Generated:** 2026-06-03  
**Investigation Method:** Direct index audit + data analysis  
**Confidence Level:** HIGH (based on chunk counts and metadata verification)
