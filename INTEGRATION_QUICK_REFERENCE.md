# Integration Quick Reference Guide

## Quick Start: Add Fixes to provider.js

### 1. Import New Modules (top of provider.js)

```javascript
const { 
  extractProgramFromQuery,
  validateProgramConsistency,
  filterNonStikomPrograms,
  validateStikomOnly
} = require('../engine/programTracer');

const {
  classifyScholarshipIntent,
  extractScholarshipName,
  filterScholarshipAnswerForIntent
} = require('../engine/scholarshipIntentClassifier');

const {
  isCareerGuidanceQuestion,
  extractCareerInterest,
  getRecommendedPrograms,
  filterCareerAnswerForStikomOnly
} = require('../engine/careerIntentClassifier');
```

### 2. In detectIntent() Function

**BEFORE**:
```javascript
function detectIntent(question) {
  if (question.includes('beasiswa')) return 'SCHOLARSHIP';
  if (question.includes('cocok jurusan')) return 'ACADEMIC_PROGRAM';
  // ...
}
```

**AFTER**:
```javascript
function detectIntent(question) {
  // 1. Check if career guidance (has higher priority than scholarship)
  const isCareer = isCareerGuidanceQuestion(question);
  if (isCareer) return 'CAREER_GUIDANCE';
  
  // 2. Check other intents...
  if (question.includes('beasiswa')) {
    const scholarshipIntent = classifyScholarshipIntent(question);
    return scholarshipIntent; // 'SPECIFIC_SCHOLARSHIP_DETAIL' or 'SCHOLARSHIP_LIST'
  }
  if (question.includes('cocok jurusan')) return 'ACADEMIC_PROGRAM';
  // ...
}
```

### 3. In RAG Query Handler (after ragQuery returns)

**BEFORE**:
```javascript
async function handleMessage(chatId, userQuery) {
  const ragResult = await ragQuery(userQuery);
  return sendWhatsappMessage(chatId, ragResult.answer);
}
```

**AFTER**:
```javascript
async function handleMessage(chatId, userQuery) {
  // 1. Extract program from query
  const queryProgram = extractProgramFromQuery(userQuery, { trace: true });
  
  // 2. Get RAG result
  const ragResult = await ragQuery(userQuery);
  
  // 3. Validate program consistency (BUG 1 fix)
  const consistency = validateProgramConsistency(userQuery, ragResult.answer, { trace: true });
  if (!consistency.valid && consistency.queryProgram) {
    logger.warn('[BUG1] Program mismatch', { consistency });
    // Optionally handle: re-query with explicit program filter
  }
  
  // 4. Handle specific intents
  const intent = detectIntent(userQuery);
  
  if (intent === 'CAREER_GUIDANCE') {
    // BUG 3 & 4 fix: Filter non-STIKOM programs
    ragResult.answer = filterCareerAnswerForStikomOnly(ragResult.answer, { trace: true });
  }
  
  if (intent === 'SPECIFIC_SCHOLARSHIP_DETAIL') {
    // BUG 2 fix: Extract specific scholarship explanation
    const targetScholarship = extractScholarshipName(userQuery);
    ragResult.answer = filterScholarshipAnswerForIntent(ragResult.answer, userQuery);
  }
  
  // 5. General STIKOM filtering (backup safety layer)
  ragResult.answer = filterNonStikomPrograms(ragResult.answer);
  
  // 6. Validate final answer has no non-STIKOM programs
  const isValid = validateStikomOnly(ragResult.answer);
  if (!isValid) {
    logger.warn('[BUG4] Non-STIKOM programs found', { answer: ragResult.answer });
  }
  
  return sendWhatsappMessage(chatId, ragResult.answer);
}
```

### 4. Optional: Add Trace Logging

```javascript
// Enable with: DEBUG_TRACE=true npm start

const enableTracing = process.env.DEBUG_TRACE === 'true';

function logTrace(type, data) {
  if (enableTracing) {
    console.log(`[${type}]`, JSON.stringify(data, null, 2));
  }
}

// Use in handlers:
logTrace('TRACE_PROGRAM_QUERY', { userQuery, queryProgram });
logTrace('TRACE_PROGRAM_FINAL', { userQuery, extractedProgram, finalAnswer });
```

---

## Implementation Checklist

- [ ] Copy new files (programTracer.js, scholarshipIntentClassifier.js, careerIntentClassifier.js)
- [ ] Add imports to provider.js
- [ ] Update detectIntent() with career guidance priority check
- [ ] Update RAG handler with consistency validation
- [ ] Add career filtering for CAREER_GUIDANCE intent
- [ ] Add specific scholarship filtering
- [ ] Add backup STIKOM filtering
- [ ] Run tests: `npm test`
- [ ] Verify integration tests pass: `npm test -- tests/integrationRuntime.test.js`
- [ ] Test manually with examples below

---

## Manual Testing Examples

### Test 1: Program Consistency (BUG 1)
```
Input:  "Berapa biaya TI?"
Expected: 
  - TRACE_PROGRAM_QUERY: TI
  - TRACE_PROGRAM_RAG: TEKNOLOGI_INFORMASI
  - TRACE_PROGRAM_FINAL: MATCH ✓
  - Output mentions only "Teknologi Informasi"
```

### Test 2: Specific Scholarship (BUG 2)
```
Input:  "Apa itu beasiswa KIP?"
Expected:
  - TRACE_SCHOLARSHIP_INTENT: SPECIFIC_SCHOLARSHIP_DETAIL
  - Output: Detailed KIP explanation (not generic list)
  - Should NOT contain: "Ada beberapa jenis beasiswa..."
```

### Test 3: Career Intent (BUG 3)
```
Input:  "Saya suka coding cocok jurusan apa?"
Expected:
  - TRACE_CAREER_INTENT: CAREER_GUIDANCE
  - Output: Program recommendations (TI, SI, SK)
  - Should NOT contain: Scholarship info
```

### Test 4: Non-STIKOM Filter (BUG 4)
```
Input:  "Rekomendasi jurusan untuk coding?"
Expected:
  - filterCareerAnswerForStikomOnly() removes non-STIKOM
  - Output should NOT contain: "Teknik Informatika", "Ilmu Komputer", etc.
  - Output should contain: "Teknologi Informasi", "Sistem Informasi", etc.
```

### Test 5: Integration (BUG 5)
```
Run: npm test -- tests/integrationRuntime.test.js
Expected: 12/12 tests PASS
```

---

## Debug Mode

Enable full tracing:
```bash
DEBUG_TRACE=true npm start
```

Check logs:
```bash
# Tail logs with trace prefix
tail -f logs/app.log | grep "TRACE_"
```

Check trace files:
```bash
ls -la .traces/traces-*.json
cat .traces/traces-latest.json | jq '.'
```

---

## Troubleshooting

### Issue: Program mismatch detected but not fixed
**Solution**: Add explicit program filter to RAG query
```javascript
if (!consistency.valid && consistency.queryProgram) {
  const programFilter = `\n\nPastikan jawaban hanya tentang ${consistency.queryProgram}`;
  const ragResult = await ragQuery(userQuery + programFilter);
}
```

### Issue: Scholarship still returning generic list
**Solution**: Increase confidence threshold
```javascript
const scholarshipIntent = classifyScholarshipIntent(userQuery, { 
  confidenceThreshold: 0.8 // Default 0.7
});
```

### Issue: Career recommendations include non-STIKOM
**Solution**: Ensure filterCareerAnswerForStikomOnly is called
```javascript
ragResult.answer = filterCareerAnswerForStikomOnly(
  ragResult.answer, 
  { trace: true, strict: true } // strict mode removes ALL non-STIKOM
);
```

---

## Performance Monitoring

Add to your monitoring dashboard:

```javascript
// Track BUG fix effectiveness
metrics.programInconsistency = consistency.valid ? 0 : 1;
metrics.scholarshipSpecific = scholarshipIntent === 'SPECIFIC_SCHOLARSHIP_DETAIL' ? 1 : 0;
metrics.careerCorrectIntent = intent === 'CAREER_GUIDANCE' ? 1 : 0;
metrics.stikomFiltered = beforeFilter.length - afterFilter.length;

// Send to monitoring service
sendMetrics(metrics);
```

---

## Files Reference

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/engine/programTracer.js` | Program consistency validation | extractProgramFromQuery, validateProgramConsistency, filterNonStikomPrograms |
| `src/engine/scholarshipIntentClassifier.js` | Scholarship intent classification | classifyScholarshipIntent, extractScholarshipName, filterScholarshipAnswerForIntent |
| `src/engine/careerIntentClassifier.js` | Career guidance detection | isCareerGuidanceQuestion, getRecommendedPrograms, filterCareerAnswerForStikomOnly |
| `tests/integrationRuntime.test.js` | Integration tests | 12 comprehensive E2E tests |
| `RUNTIME_BUG_AUDIT_REPORT.md` | Full documentation | Detailed audit, before/after examples |

---

## Next Steps

1. **Phase 1**: Add imports and update detectIntent() 
2. **Phase 2**: Update RAG handler with all 5 fixes
3. **Phase 3**: Run tests and verify
4. **Phase 4**: Deploy to staging
5. **Phase 5**: Monitor traces and metrics
6. **Phase 6**: Deploy to production

Estimated implementation time: **2-3 hours**

For questions, refer to RUNTIME_BUG_AUDIT_REPORT.md or run tests:
```bash
npm test -- tests/integrationRuntime.test.js --verbose
```
