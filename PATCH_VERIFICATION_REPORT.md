# RUNTIME PATCH VERIFICATION REPORT

## Query
```
Berapa biaya TI gelombang 2C?
```

## Expected Behavior
- User asks about **cost** (biaya) for **TI** program with **gelombang 2C**
- Provider sends high-confidence **COST** intent
- RAG returns biaya-focused answer with explicit "Program Studi Teknologi Informasi"
- Parser should NOT misdetect as jadwal_pendaftaran despite query mention of "gelombang"
- Program should resolve to Teknologi Informasi (not SI from list context)

---

## BEFORE PATCH (Buggy Behavior)

### Issue 1: Intent Override (candidateIntent bug)
```
Query:                   "Berapa biaya TI gelombang 2C?"
queryIntent:             jadwal_pendaftaran  ← ❌ WRONG
answerIntent:            biaya
detectIntentFromAnswer() logic (OLD):
  → queryIntent !== 'general' → return queryIntent immediately
  → Result: candidateIntent = jadwal_pendaftaran  ← ❌ BUG

Symptom: Humanizer selected jadwal_pendaftaran template instead of biaya
```

### Issue 2: Program Override (answerProgram bug)
```
Query:          "Berapa biaya TI gelombang 2C?"
queryProgram:   Teknologi Informasi

Answer:         "Untuk Program Studi Teknologi Informasi, rincian biaya pendaftaran gelombang 2C:
                 Biaya SI, TI dan BD tersedia..."

mapProgramAlias() logic (OLD):
  → First check: /\b(si|sistem informasi)\b/ matches "SI" in list
  → Result: byAlias = 'Sistem Informasi'  ← ❌ FALSE POSITIVE (should ignore list context)

extractProgramFromText() logic (OLD):
  → Order: byAlias || regexProgram || null
  → byAlias = 'Sistem Informasi'
  → Result: answerProgram = 'Sistem Informasi'  ← ❌ BUG

programFinal logic:
  → answerProgram || queryProgram || sessionProgram
  → answerProgram = 'Sistem Informasi' (overrides queryProgram)
  → Result: programFinal = 'Sistem Informasi'  ← ❌ WRONG

Symptom: Bot template changed from TI (user query) to SI (false answer parse)
```

---

## AFTER PATCH (Fixed Behavior)

### Fix 1: Intent Detection (detectIntentFromAnswer)
```
Query:                   "Berapa biaya TI gelombang 2C?"
queryIntent:             jadwal_pendaftaran
answerIntent:            biaya

detectIntentFromAnswer() logic (NEW):
  Step 1: Check answerIntent = detectIntentFromAnswerFromText(mainAnswer)
          → Detects Rp, "rincian biaya", "dana pendidikan pokok" → answerIntent = 'biaya'
  Step 2: If answerIntent === 'biaya' → RETURN 'biaya' immediately
  Step 3: Skip queryIntent evaluation (only used as fallback if answerIntent != 'biaya')
  → Result: candidateIntent = 'biaya'  ✓ CORRECT

✓ FIX: Strong answer signal ('biaya' with fee markers) now takes priority over query keyword ('gelombang')
```

### Fix 2: Program Parsing (mapProgramAlias + extractProgramFromText)
```
Query:          "Berapa biaya TI gelombang 2C?"
queryProgram:   Teknologi Informasi

Answer:         "Untuk Program Studi Teknologi Informasi, rincian biaya pendaftaran gelombang 2C:
                 Biaya SI, TI dan BD tersedia..."

mapProgramAlias() logic (NEW):
  Step 1: Check if text contains ambiguous program list
          → isAmbiguousProgramList() detects multiple program mentions (SI, TI, BD) with separators
          → Context is flagged as AMBIGUOUS_LIST
  Step 2: If ambiguous → Return null (do not map)
  Step 3: If NOT ambiguous → Proceed with normal alias matching
  → Result: byAlias = null  ✓ CORRECT (list context ignored)

Note: When answerProgram parses just "Program Studi Teknologi Informasi" alone (not in list),
it will correctly return 'Teknologi Informasi'

extractProgramFromText() logic (NEW):
  Step 1: byAlias = mapProgramAlias(text) → null (due to list detection)
  Step 2: regexProgram = /Program Studi\s+([A-Za-z\s]+?).../ match
          → Matches "Program Studi Teknologi Informasi"
          → regexProgram = 'Teknologi Informasi'
  Step 3: Order (NEW): regexProgram || byAlias || null
          → regexProgram = 'Teknologi Informasi' (explicit match preferred)
          → Result: answerProgram = 'Teknologi Informasi'  ✓ CORRECT

programFinal logic (unchanged):
  → answerProgram || queryProgram || sessionProgram
  → answerProgram = 'Teknologi Informasi' (explicit declaration in answer)
  → queryProgram = 'Teknologi Informasi' (from query "TI")
  → Result: programFinal = 'Teknologi Informasi'  ✓ CORRECT

✓ FIX: Parser now detects list context and prefers explicit regex over heuristic alias
```

---

## VERIFICATION RESULTS

### Runtime Test Output

| Trace Value | Expected | Actual | Status |
|---|---|---|---|
| **incomingIntent** | COST | COST | ✓ PASS |
| **candidateIntent** | biaya | biaya | ✓ PASS |
| **finalIntent** | biaya | biaya | ✓ PASS |
| **queryProgram** | Teknologi Informasi | Teknologi Informasi | ✓ PASS |
| **answerProgram** | Teknologi Informasi | Teknologi Informasi | ✓ PASS |
| **programFinal** | Teknologi Informasi | Teknologi Informasi | ✓ PASS |
| **selectedTemplate** | biaya | biaya | ✓ PASS |

### Unit Test Coverage

All 29 tests pass including:
- `mapProgramAlias returns null when alias appears in list context (SI, TI dan BD)`
- `mapProgramAlias returns program when single alias found`
- `extractProgramFromText prefers explicit "Program Studi ..." regex over alias`
- `extractProgramFromText returns null when answer contains list of programs`
- `extractProgramFromText falls back to alias when regex not present`
- `BUG 1: detailed - fee response for TI should contain Teknologi Informasi header and consistent program`

---

## Root Causes Addressed

1. **candidateIntent = jadwal_pendaftaran instead of biaya**
   - Root cause: `detectIntentFromAnswer` prioritized queryIntent over answerIntent
   - Fix: Check answerIntent first; only use queryIntent as fallback if answer intent is 'general'
   - File: `src/utils/whatsappFormatter.js` (lines ~717-731)

2. **answerProgram = Sistem Informasi instead of Teknologi Informasi**
   - Root cause A: `mapProgramAlias` did not detect list context, applied first-match alias
   - Fix A: Add `isAmbiguousProgramList()` helper to skip mapping when multiple programs present
   - File: `src/utils/whatsappFormatter.js` (lines ~7-32)
   
   - Root cause B: `extractProgramFromText` prioritized byAlias over regexProgram
   - Fix B: Reverse order to `regexProgram || byAlias || null` so explicit "Program Studi ..." text preferred
   - File: `src/utils/whatsappFormatter.js` (lines ~475-490)

---

## Changes Summary

### Files Modified
1. **src/utils/whatsappFormatter.js**
   - Added `isAmbiguousProgramList()` helper function
   - Updated `mapProgramAlias()` to check for ambiguous list context
   - Updated `detectIntentFromAnswer()` to prioritize answer 'biaya' signal
   - Updated `extractProgramFromText()` to prefer regex over alias
   - Exported `detectIntentFromQuery` and `detectIntentFromAnswerFromText` for testing

2. **tests/whatsappFormatter.test.js**
   - Added 7 new unit tests for "Program Parser Improvements"
   - All 29 tests passing

### Files NOT Modified (Per Request)
- `src/routes/provider.js` - No change to `detectResponseIntent()` or `programFinal` logic
- `src/engine/ragEngine.js` - No change
- `src/engine/humanizer.js` - No change

---

## Conclusion

✓ **Both root causes fixed with minimal invasive changes**
✓ **All patches localized to parser functions (mapProgramAlias, extractProgramFromText, detectIntentFromAnswer)**
✓ **No impact on provider routing or humanizer logic**
✓ **All unit tests pass**
✓ **Runtime verification confirms correct behavior for target query**

**Status: READY FOR DEPLOYMENT**
