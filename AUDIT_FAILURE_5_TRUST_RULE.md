# AUDIT: Failure #5 - Trust Rule Analysis

## Problem Statement
Test #5: `query('biaya prodi si gelombang 1A?')` expects:
- `res.success === true`
- Answer contains `Rp 250.000`

**Current Result**: FAIL - Answer is rejected with 'rag-answer-rejected'

---

## Root Investigation Path

### Stage 1: Numeric Parsing ✅
**Finding**: Numeric extraction and parsing are working correctly.

**Evidence**:
```
extractedValue: 'Rp 250.000,'
normalizedValue: '250000'
token: 'Rp.250.000,'
parsedAttempts[2]: 250000
matchedFoundIn-parse: SUCCESS
```

**Conclusion**: Value is correctly extracted and parsed. ✅

---

### Stage 2: Numeric Grounding Validation ❌
**Finding**: validateNumericGrounding() returns `valid: false` with reason `single_low_quality_source`

**Location**: `src/engine/ragEngine.js` lines 680-712

**Rule Logic**:
```javascript
// TRUST HIERARCHY: official docs > good OCR > multiple sources
const officialSources = foundIn.filter(f => f.isOfficial);

if (officialSources.length > 0) {
  return { valid: true, reason: 'found_in_official', sources: foundIn };
}

if (foundIn.length >= 2) {
  return { valid: true, reason: 'found_in_multiple', sources: foundIn };
}

// Single source: must have good OCR confidence
if (foundIn[0] && foundIn[0].ocrQuality >= 0.85) {
  return { valid: true, reason: 'found_with_good_ocr', sources: foundIn };
}

return { valid: false, reason: 'single_low_quality_source', sources: foundIn };
```

**Raw Runtime Values for 250000**:
```
foundInCount: 1
officialSourcesCount: 0
firstFoundInOcrQuality: undefined
firstFoundInIsOfficial: false
```

**Decision Path**:
1. ✓ foundIn.length > 0 (pass)
2. ✗ officialSources.length = 0 (fail)
3. ✗ foundIn.length >= 2 (fail, only 1)
4. ✗ foundIn[0].ocrQuality >= 0.85 (FAIL: undefined >= 0.85 = false)
5. → return { valid: false, reason: 'single_low_quality_source' }

**Conclusion**: Validation failed due to missing/invalid ocrQuality. ❌

---

### Stage 3: Root Cause - Missing ocrQualityScore in Validation Call ❌

**Location**: `src/engine/ragEngine.js` lines 4292-4307 (validateParsedFeeStruct)

**Code**:
```javascript
function validateParsedFeeStruct(feeStruct, chunkObj) {
  if (!feeStruct || !chunkObj) return false;
  const numericFields = ['registrationFee', 'dpp', 'dppDiscount', 'registrationDiscount', 'ukt', 'scholarship'];
  for (const field of numericFields) {
    if (feeStruct[field]) {
      const chunkText = chunkObj && typeof chunkObj === 'object' && chunkObj.chunk ? String(chunkObj.chunk) : (typeof chunkObj === 'string' ? chunkObj : '');
      const filename = chunkObj && typeof chunkObj === 'object' && chunkObj.filename ? String(chunkObj.filename) : 'parsed';
      
      // BUG: Only passes chunk + filename, NOT ocrQualityScore!
      const validation = validateNumericGrounding(feeStruct[field], [{ chunk: chunkText, filename }]);
      if (!validation.valid) return false;
    }
  }
  return true;
}
```

**Problem**: The sourceChunks array passed to validateNumericGrounding is missing `ocrQualityScore` property from the original `chunkObj`.

---

### Stage 4: Chunk Object Properties Analysis

**Raw Evidence**: VALIDATE_PARSED_FEE_STRUCT_INPUT logs from test #5:

**CHUNK_0** (smoke-test):
```javascript
chunkObjKeys: [
  'id', 'trainingId', 'chunk', 'chunkHash', 'sectionTitle', 'chunkType',
  'isSummary', 'lowConfidence', 'ocrQualityScore', 'embedding',
  'source', 'createdAt', 'divisionKey', 'filename', 'uploadedById',
  'program', 'programAliases', 'programName', 'docCategory', 'category'
],
chunkObjOcrQualityScore: 0,           // HAS ocrQualityScore = 0
chunkObjFilename: null,
chunkObjSource: 'smoke-test'
```

**CHUNK_1** (upload):
```javascript
chunkObjKeys: [
  'id', 'trainingId', 'chunk', 'embedding', 'source', 'createdAt',
  'program', 'programAliases', 'docCategory', 'category'
],
chunkObjOcrQualityScore: undefined,   // NO ocrQualityScore property
chunkObjFilename: undefined,
chunkObjSource: 'upload'
```

**CHUNK_2** (upload with fee data):
```javascript
chunkObjKeys: [
  'id', 'trainingId', 'chunk', 'chunkHash', 'embedding', 'source',
  'createdAt', 'divisionKey', 'filename', 'uploadedById', 'program',
  'programAliases', 'docCategory', 'category'
],
chunkObjOcrQualityScore: undefined,   // NO ocrQualityScore property
chunkObjFilename: 'CamScanner 12-02-2026 14.39 (1).pdf',
chunkObjSource: 'upload'
```

**CHUNK_3** (upload):
```javascript
chunkObjKeys: [
  'id', 'trainingId', 'chunk', 'embedding', 'source', 'createdAt',
  'docCategory', 'category'
],
chunkObjOcrQualityScore: undefined,   // NO ocrQualityScore property
chunkObjFilename: undefined,
chunkObjSource: 'upload'
```

**Summary**:
- Some chunks have `ocrQualityScore` property, some don't
- Values are: 0, undefined, undefined, undefined
- **None meet threshold >= 0.85**
- **All chunks fail OCR quality validation**

---

## Trust Rule Analysis

### Rule Definition
The trust hierarchy in validateNumericGrounding is:
1. **Tier 1**: Found in official documents (filename matches `/PMB|BIAYA|RINCIAN|OFFICIAL|REGULASI|RESMI/i`)
2. **Tier 2**: Found in multiple sources (foundIn.length >= 2)
3. **Tier 3**: Found in single source with good OCR quality (ocrQuality >= 0.85)
4. **Tier 4**: REJECTION - Single source with low/missing OCR quality

### Question 1: Is the threshold too strict?

**Threshold**: >= 0.85 (85% OCR confidence)

**Evidence from test #5 chunks**:
- CHUNK_0: ocrQualityScore = 0 (0%)
- CHUNK_1: undefined
- CHUNK_2: undefined (filename from PDF)
- CHUNK_3: undefined

**Assessment**: Even the chunk with explicit ocrQualityScore (0) is far below threshold.

### Question 2: Does the business rule make sense?

**Business Logic**: 
- A single source for numeric values should be trusted only if OCR quality is high (>= 85%)
- This prevents accepting obviously low-quality OCR as source of truth for financial values
- Financial data (fees) requires higher confidence threshold

**Rationale**: Makes sense to be conservative with single-source numeric values.

### Question 3: Is the problem in the rule or the test fixture?

**Evidence**:
1. The `chunkObj` parameter to `validateParsedFeeStruct()` **has** `ocrQualityScore` (seen in CHUNK_0)
2. But `validateNumericGrounding()` **doesn't receive** it - only gets `{ chunk, filename }`
3. This is a **data loss issue**, not a rule problem

**Issue**: The pass-through from `validateParsedFeeStruct()` is missing the ocrQualityScore field.

---

## Test Expectation Analysis

**Test #5** (line 212-217 in ragEngine.test.js):
```javascript
test('query returns enrollment discount output with requested wave formatting for 1A', async () => {
  const res = await query('biaya prodi si gelombang 1A?');
  expect(res && res.success).toBe(true);
  expect(String(res.answer || '')).toMatch(/Gelombang\s*1A/i);
  expect(String(res.answer || '')).toMatch(/Rp\s*250\.000/i);
});
```

**Test Expectation**: SUCCESS with Rp 250.000 in answer

**Data Source**: Real persisted RAG index with smoke-test and uploaded PDF chunks

**OCR Status**: 
- Some chunks have ocrQualityScore = 0
- Most have undefined ocrQualityScore
- None meet the >= 0.85 threshold

---

## Summary

### What's Broken
1. **Location**: validateParsedFeeStruct() in ragEngine.js:4301
2. **Issue**: Not passing `ocrQualityScore` from `chunkObj` to validateNumericGrounding()
3. **Result**: validateNumericGrounding receives sourceChunks[0].ocrQualityScore = undefined
4. **Decision**: Fails trust rule 'single_low_quality_source'

### Two Possible Fixes

**Option A - Fix the pass-through**:
```javascript
// Line 4301: Add ocrQualityScore to the passed object
const validation = validateNumericGrounding(feeStruct[field], [{ 
  chunk: chunkText, 
  filename,
  ocrQualityScore: chunkObj && chunkObj.ocrQualityScore
}]);
```

**Option B - Relax the trust rule**:
```javascript
// Line 704: Lower threshold or accept undefined
if (foundIn[0] && (foundIn[0].ocrQuality === undefined || foundIn[0].ocrQuality >= 0.85))
```

### Evidence Chain
1. ✅ Numeric extraction: 'Rp 250.000,' → 250000
2. ✅ Token parsing: found 'Rp.250.000,' in alternatives
3. ✅ Match found: parsedAttempts[2] = 250000 matches normalizedValue
4. ❌ Trust validation: ocrQuality = undefined (not >= 0.85)
5. ❌ Result: validation.valid = false, reason = 'single_low_quality_source'
6. ❌ Consequence: parseF eeStructure returns null, tryStructuredExactCostAnswer returns 'rag-answer-rejected'

---

## Recommendations (Without Patch)

**Before patching, confirm**:
1. Does test fixture expect trust validation to pass for this data?
2. Should ocrQualityScore be mandatory for index chunks?
3. Is 0.85 threshold correct for persisted index data?
