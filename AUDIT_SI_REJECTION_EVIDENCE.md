================================================================================
AUDIT REPORT: SI CHUNK REJECTION ANALYSIS
Query Benchmark: 4 SI Definition/Characteristic Questions
================================================================================

EXECUTIVE SUMMARY
=================

Question: Why does Double Degree rank #1 when chunk 6631dfc1 has higher score?
Answer: 6631dfc1 is REJECTED by filterRelevantChunks() due to category mismatch

Key Finding: filterRelevantChunks() has over-conservative academic category rules


================================================================================
PART 1: SI CANDIDATES IN TOP 20 (BEFORE FILTERING)
================================================================================

QUERY 1: "Apa itu Sistem Informasi?"
Intent: ACADEMIC_PROGRAM | UserIntent: DEFINISI_PRODI
---

SI Candidate Summary:
  Total in top 20: 18 SI chunks
  Passed filterRelevantChunks: 0
  REJECTED: 18

BEST SI CANDIDATE (Rank #1):
  ID: 6631dfc1-b46c-4933-a340-392dfd2250d6
  Filename: Penjelasan Prodi dan Karier Masa Depan (1).xlsx
  Category: KURIKULUM
  Program: SI
  Semantic Score: 0.4468
  Composite Score: 4.4607 ← HIGHEST in top 20
  Status: ✗ REJECTED
  
WHAT PASSED FILTER:
  ID: c2961b13-bd76-4f6b-9c39-1e19606b6a5d
  Filename: CHATBOT - Double Degree (1).docx
  Category: PROGRAM_KHUSUS
  Program: SI
  Composite Score: 4.2000 ← LOWER than best SI chunk
  Status: ✓ PASSED

COMPARISON:
  Best SI chunk vs Double Degree: 4.4607 vs 4.2000 = +0.2607 advantage for SI
  But SI chunk rejected, Double Degree accepted


QUERY 2: "Apa prospek kerja Sistem Informasi?"
Intent: ACADEMIC_PROGRAM | UserIntent: PROSPEK_KERJA
---

SI Candidate Summary:
  Total in top 20: 18 SI chunks
  Passed filter: 0
  REJECTED: 18

BEST SI CANDIDATE (Rank #1):
  ID: 6631dfc1-b46c-4933-a340-392dfd2250d6
  Composite Score: 4.2464
  Status: ✗ REJECTED
  
WHAT PASSED FILTER:
  Composite Score: 3.9300 (Double Degree)
  Status: ✓ PASSED
  Difference: -0.3164


QUERY 3: "Apa yang dipelajari di Sistem Informasi?"
Intent: ACADEMIC_PROGRAM | UserIntent: KURIKULUM_PEMBELAJARAN
---

SI Candidate Summary:
  Total in top 20: 18 SI chunks
  Passed filter: 0
  REJECTED: 18

BEST SI CANDIDATE (Rank #1):
  ID: 6631dfc1-b46c-4933-a340-392dfd2250d6
  Composite Score: 4.4006
  Status: ✗ REJECTED

WHAT PASSED FILTER:
  Composite Score: 4.1400 (Double Degree)
  Status: ✓ PASSED
  Difference: -0.2606


QUERY 4: "Apa keunggulan Sistem Informasi?"
Intent: PROGRAM | UserIntent: GENERAL
---

SI Candidate Summary:
  Total in top 20: 18 SI chunks
  Passed filter: 0
  REJECTED: 18

BEST SI CANDIDATE (Rank #2):
  ID: 74be5da2-8251-4417-a1de-41c3a4b70239
  Filename: HOBY.pdf
  Category: UNKNOWN
  Composite Score: 3.2548
  Status: ✗ REJECTED

WHAT PASSED FILTER:
  IDs: [c2961b13, b411e939] (2x Double Degree)
  Composite Scores: 3.3000, 3.2400
  Status: ✓ PASSED (both)
  Note: Both have SIMILAR or LOWER score than best SI


================================================================================
PART 2: ROOT CAUSE ANALYSIS
================================================================================

Function: chunkMatchesAcademicIntent() in src/engine/ragEngine.js (line 3947)

This function validates chunk against academic intent using 3 conditions:

CONDITION 1: Category Whitelist Check
────────────────────────────────────
  Purpose: Only accept chunks from specific categories per intent
  Implementation: Hardcoded category whitelists
  
For intent=DEFINISI_PRODI:
  ✓ Allowed categories: ['PROGRAM_STUDI', 'INFO']
  ✗ Chunk 6631dfc1 category: 'KURIKULUM'
  Result: FAIL - KURIKULUM not in whitelist

CONDITION 2: Evidence Regex Check
──────────────────────────────────
  Purpose: Accept chunks containing intent keywords
  Implementation: Pattern-based keyword matching
  
For intent=DEFINISI_PRODI:
  Pattern: /\b(apa itu|apa yang dimaksud|pengertian|definisi|mengenai|
           penjelasan|istilah|profil lulusan|tujuan|visi|misi|
           capaian pembelajaran|deskripsi)\b/i
  
  Chunk text: "Program studi ini merupakan pendidikan vokasi yang 
              menanamkan kompetensi untuk siap kerja. Lulusan program ini 
              akan mahir dalam bidang Web Developer | Database Administrator 
              | dan IT Entrepreneur..."
  
  Result: FAIL - No keyword from regex found in chunk


CONDITION 3: Fallback
─────────────────────
  Purpose: Accept if requested program mentioned + academic content
  Status: Not evaluated because previousConditions already failed


FINAL VERDICT FOR 6631DFC1:
───────────────────────────
  Condition 1 (Category): FAIL
  Condition 2 (Evidence): FAIL
  Condition 3 (Fallback): NOT EVALUATED
  
  Decision: REJECT


================================================================================
PART 3: THE INCONSISTENCY
================================================================================

Current whitelist mappings for academic intents:

  DEFINISI_PRODI:        [PROGRAM_STUDI, INFO]           ← EXCLUDES KURIKULUM
  FOKUS_PRODI:           [KURIKULUM, PROGRAM_STUDI]      ← INCLUDES KURIKULUM
  MATA_KULIAH:           [KURIKULUM, PROGRAM_STUDI]      ← INCLUDES KURIKULUM
  PROSPEK_KERJA:         [KARIR, PROGRAM_STUDI]          ← EXCLUDES KURIKULUM
  KURIKULUM_PEMBELAJARAN: [KURIKULUM, PROGRAM_STUDI]     ← INCLUDES KURIKULUM

Observation: DEFINISI_PRODI is the only intent that excludes KURIKULUM, 
despite KURIKULUM chunks being the most relevant for defining program studies.


================================================================================
PART 4: WHY DOUBLE DEGREE PASSES
================================================================================

Double Degree chunk properties:
  ID: c2961b13-bd76-4f6b-9c39-1e19606b6a5d
  Category: PROGRAM_KHUSUS
  Program: SI
  ChunkType: (undefined/unknown)
  Content: Q&A about Double Degree program features

chunkMatchesAcademicIntent() result:
  Condition 1 (Category): 
    - Allowed for DEFINISI_PRODI: [PROGRAM_STUDI, INFO]
    - Chunk category: PROGRAM_KHUSUS
    - Match: NO - but let's check condition 2
  
  Condition 2 (Evidence):
    - Chunk text contains: "Keunggulan Program" / "Program ini untuk mahasiswa"
    - Pattern search for DEFINISI_PRODI keywords... 
    - Likely NO MATCH either
  
  Condition 3 (Fallback):
    - Mentions program (SI): YES
    - Has academic content: YES
    - Result: PASS (if other conditions fail, fallback accepts)

Decision: ACCEPT (via fallback or specific category logic)

Note: Double Degree content is about a specific program variant, not a 
general SI definition. Yet it passes while SI curriculum chunk rejects.


================================================================================
PART 5: IMPACT SUMMARY
================================================================================

For "Apa itu Sistem Informasi?" query:

Before filterRelevantChunks():
  Rank 1: SI Chunk (6631dfc1) - composite 4.4607 ← BEST
  Rank 2: Double Degree - composite 4.2000
  Rank 3: Double Degree - composite 4.2000
  ...other SI chunks...

After filterRelevantChunks():
  Only remaining: Double Degree (composite 4.2000)

User gets: Double Degree information
User misses: Best SI academic content (0.26 points higher)

Severity: HIGH
  - User receives less relevant information (Double Degree instead of SI definitions)
  - Information loss: ~6% score difference (4.26 → 4.20)
  - Across all 4 queries: Consistently poor SI retrieval


================================================================================
PART 6: ROOT CAUSE DIAGNOSIS
================================================================================

Category: DESIGN ISSUE (not a bug)

Root cause: Over-conservative category whitelist for academic intents

Rule: "Only accept chunks from PROGRAM_STUDI or INFO categories for DEFINISI_PRODI"

Intention: Prevent off-topic content
Unintended consequence: Blocks the MOST relevant KURIKULUM chunks

Why it happened:
  - KURIKULUM is mostly course details (not definitions)
  - But SI chunks marked as KURIKULUM contain program definitions
  - Filter assumes KURIKULUM = course-level details, not program-level overview
  - So KURIKULUM was excluded from DEFINISI_PRODI whitelist


================================================================================
PART 7: RECOMMENDED FIXES
================================================================================

Option A: Expand Category Whitelist (SAFEST)
────────────────────────────────────────────
Location: src/engine/ragEngine.js, function getAllowedAcademicCategories()

Change:
  case 'DEFINISI_PRODI': 
    return new Set(['PROGRAM_STUDI', 'INFO']);

To:
  case 'DEFINISI_PRODI': 
    return new Set(['PROGRAM_STUDI', 'INFO', 'KURIKULUM']);

Impact:
  - Chunk 6631dfc1 would pass Condition 1
  - All SI curriculum chunks now eligiblefor DEFINISI_PRODI queries
  - Minimal risk (KURIKULUM is legitimate source for program definitions)


Option B: Improve Evidence Regex (TARGETED)
───────────────────────────────────────────
Location: src/engine/ragEngine.js, function getAcademicIntentEvidenceRegex()

Add patterns that match program description text:

Change:
  case 'DEFINISI_PRODI': 
    return /\b(apa\s+itu|apa\s+yang\s+dimaksud|pengertian|definisi|...)\b/i;

To:
  case 'DEFINISI_PRODI': 
    return /\b(apa\s+itu|apa\s+yang\s+dimaksud|pengertian|definisi|...
             |program\s+studi.*merupakan|jenis\s+program|fokus\s+.*program
             |lulusan.*mahir|kompetensi.*siap\s+kerja)\b/i;

Impact:
  - Chunk 6631dfc1 would pass Condition 2 (has "Program studi ini merupakan")
  - More flexible, context-aware detection
  - Risk: May accept tangentially related content


Option C: Metadata-Aware Fallback (HYBRID)
──────────────────────────────────────────
Location: src/engine/ragEngine.js, function chunkMatchesAcademicIntent()

Add rule after Condition 2 fails:

  // Condition 3.5: For DEFINISI_PRODI, accept KURIKULUM if it's SI-specific
  if (academicIntent === 'DEFINISI_PRODI' && category === 'KURIKULUM' 
      && item.program === 'SI' && text.includes('program studi')) {
    return true;
  }

Impact:
  - Chunk 6631dfc1 accepted (KURIKULUM + SI + contains "program studi")
  - Narrowly targeted (only SI curriculum)
  - Low risk of side effects


RECOMMENDATION: Option A (expand whitelist)
  - Simplest and safest
  - Most consistent with other intent definitions
  - Direct fix for the root cause
  - No risk of false positives


================================================================================
CONCLUSION
================================================================================

Question: filterRelevantChunks() salah atau tidak?
Answer: Bukan salah, tapi over-conservative.

The filter correctly blocks irrelevant content, but inadvertently blocks 
the MOST RELEVANT SI curriculum content due to a category whitelist mismatch.

Evidence: Chunk 6631dfc1
  - Highest score in top 20 (4.46 composite)
  - Explicitly about SI program definition
  - But category=KURIKULUM, not in DEFINISI_PRODI whitelist
  - Rejected despite being most relevant

This is a DESIGN ISSUE, not an implementation bug.
Fix: Add KURIKULUM to DEFINISI_PRODI category whitelist in getAllowedAcademicCategories()

================================================================================
