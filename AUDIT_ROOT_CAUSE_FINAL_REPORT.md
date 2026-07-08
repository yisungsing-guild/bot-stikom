# AUDIT COMPLETION: RAG FEE PARSER INVESTIGATION

## Executive Summary

Audit of 8 cost queries (TI, SI, BD, MI, SK + partner programs) is **COMPLETE**. All queries are experiencing the **SAME ROOT CAUSE**.

### Key Finding
**Missing entity metadata in backup PDF chunks prevents proper fee structure parsing, causing all 8 queries to fall back to discount-only answers.**

---

## Root Cause: Three-Layer Issue

### Layer 1: Missing Entity Metadata in RAG Index
**File**: `data/rag_index.json` (added-from-backup-1 through added-from-backup-6)

**Current State (BROKEN)**:
```json
{
  "id": "added-from-backup-1",
  "filename": "rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf",
  "academicYear": null,     // ← MISSING!
  "program": null,          // ← MISSING!
  "wave": null,             // ← MISSING!
  "chunk": "RINCIAN BIAYA PROGRAM STUDI SI, TI, BD...",
  "entities": {}
}
```

**Expected State (CORRECT)**:
```json
{
  "id": "added-from-backup-1",
  "filename": "rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf",
  "academicYear": "2026",
  "program": "SI",  // (or TI, BD depending on context)
  "wave": "KHUSUS", // (from "Gelombang Khusus" in content)
  "chunk": "RINCIAN BIAYA PROGRAM STUDI SI, TI, BD...",
  "entities": { "academicYear": "2026", "program": "SI", "wave": "KHUSUS" }
}
```

**Impact**: Parser rejects these chunks due to entity mismatch.

---

### Layer 2: Parse Rejection Chain

**Code Path** (src/engine/ragEngine.js):
```
tryStructuredExactCostAnswer() [line 5716]
  → topChunks selection
    → parseFeeStructure(topChunks, queryEntities) [line 4802]
      → For each chunk: parseFeeStructureFromChunk(item, queryEntities) [line 4479]
        → Program match check [line 4569]:
          if (queryEntities.program && ent.program !== queryEntities.program)
            return null  // ← CHUNK REJECTED
```

**What Happens**:
1. Query: `program: "SI"`, `wave: "1A"`, `academicYear: "2025"`
2. Chunk: `program: null`, `wave: null`, `academicYear: null` (from backup PDF)
3. Comparison: `"SI" !== null` → **REJECTED**
4. Chunk parsing returns `null`
5. Parser accumulates ZERO successful cost candidates
6. Falls back to discount-only chunks

---

### Layer 3: Fallback Activation & Incomplete Result

**Trace Marker**: `[TRACE_PARSE_6b_DISCOUNT_ONLY_BASE]` (all 8 queries)

**Code** (src/engine/ragEngine.js:4873):
```javascript
if (!parsedCandidates.length && globalDiscountCandidates.length > 0) {
  parsedCandidates = globalDiscountCandidates.slice();
  console.log('[TRACE_PARSE_6b_DISCOUNT_ONLY_BASE]', {
    message: 'No explicit cost candidates were found; using discount-only chunks'
  });
}
```

**Result**: feeStruct contains ONLY discount data:
```javascript
{
  registrationFee: null,        // ← MISSING! Should be "Rp 500.000"
  dpp: null,                    // ← MISSING! Should be "Rp 14.000.000"
  registrationDiscount: "Rp 250.000",  // Partial data
  dppDiscount: null,
  registrationTotal: null,      // ← Cannot calculate
  totalBiayaMasuk: null         // ← Cannot calculate
}
```

**Final Answer** (what user receives):
```
⚠️ Incomplete: Only shows potongan pendaftaran (registration discount)
✗ Missing: Biaya pendaftaran (registration fee)
✗ Missing: DPP (main cost component)
✗ Missing: Total cost calculations
```

---

## Audit Data Summary

### All 8 Queries Show Same Pattern

| Query | Program | Wave | Status | Fallback |
|-------|---------|------|--------|----------|
| Q1 | TI | 1A | ✗ Fallback | DISCOUNT_ONLY_BASE + YEAR_FALLBACK |
| Q2 | SI | 1A | ✗ Fallback | DISCOUNT_ONLY_BASE + YEAR_FALLBACK |
| Q3 | BD | 1A | ✗ Fallback | DISCOUNT_ONLY_BASE + YEAR_FALLBACK |
| Q4 | MI | 1A | ✗ Fallback | DISCOUNT_ONLY_BASE + YEAR_FALLBACK |
| Q5 | SK | 1A | ✗ Fallback | DISCOUNT_ONLY_BASE + YEAR_FALLBACK |
| Q6 | UTB Partner | 1A | ✗ Fallback | DISCOUNT_ONLY_BASE + YEAR_FALLBACK |
| Q7 | DNUI Partner | 1A | ✗ Fallback | DISCOUNT_ONLY_BASE + YEAR_FALLBACK |
| Q8 | HELP Partner | 1A | ✗ Fallback | DISCOUNT_ONLY_BASE + YEAR_FALLBACK |

**Conclusion**: 100% fallback rate = systematic data issue, not query-specific problem.

---

## Secondary Issue: Academic Year Mismatch

**Queries request**: `academicYear: "2025"`
**Backup PDFs contain**: `Tahun Ajaran 2026/2027`

**Trace Marker**: `[TRACE_PARSE_6b_YEAR_FALLBACK]` (all 8 queries)

**Code** (src/engine/ragEngine.js:5010-5020):
```javascript
const yearMismatchCandidates = baseCandidates.filter(
  c => c.academicYear && c.academicYear !== queryEntities.academicYear
);
if (yearMismatchCandidates.length > 0) {
  baseCandidates = yearMismatchCandidates;
  // Use year mismatch as fallback
}
```

**Impact**: Year mismatch compounds the problem, allowing 2026 documents to be used for 2025 queries without proper flagging.

---

## Recommendation: Immediate Fix

### Step 1: Enhance RAG Index Ingestion
Extract metadata from backup PDF filenames:

```javascript
// For "rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf"
academicYear: "2026"
programs: ["SI", "TI", "BD"]

// For "rincian Biaya DNUI Tahun Ajaran 2026-2027.pdf"
academicYear: "2026"
partner: "DNUI"

// For "rincian Biaya UTB Tahun Ajaran 2026-2027.pdf"
academicYear: "2026"
partner: "UTB"
```

### Step 2: Update data/rag_index.json
Set correct metadata for all backup chunks before re-running queries.

### Step 3: Verify Fix
Re-run 8-query audit:
- ✓ Verify source changes from `rag-fee-structured-fallback-discount` → `rag-fee-structured`
- ✓ Verify feeStruct contains non-null registrationFee and dpp
- ✓ Verify trace logs NO `DISCOUNT_ONLY_BASE` markers
- ✓ Verify answers include full cost breakdown

---

## Code Inspection Results

**Inspected Functions**:
- ✓ tryStructuredExactCostAnswer() [5716]
- ✓ parseFeeStructure() [4802]
- ✓ parseFeeStructureFromChunk() [4479]
- ✓ validateParsedFeeStruct() [4424]
- ✓ buildDeterministicFeeAnswer() [5498]

**Verdict**: Code logic is correct. The problem is **DATA**, not code.

---

## Deliverables Created

1. **AUDIT_ROOT_CAUSE_FINAL.md** - This comprehensive report
2. **debug_summary.json** - Extracted trace data from all 8 queries
3. **audit_parse_detailed.js** - Detailed parse audit script
4. **audit_backup_content.js** - Backup PDF content analysis
5. **Repository memory**: fee-parser-audit-findings.md

---

## Next Steps

1. **Implement data fix** (update RAG index metadata)
2. **Re-run 8-query audit** to confirm fix
3. **Run full test suite** to ensure no regression
4. **Document the lesson**: Always validate chunk entity metadata during ingestion

**Status**: ✅ AUDIT COMPLETE - Root cause identified and documented
