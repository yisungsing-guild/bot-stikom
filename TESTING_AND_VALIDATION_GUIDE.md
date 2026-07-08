# Testing & Validation Guide

## Quick Test: Verify All Fixes Work

### Run Integration Tests (30 seconds)
```bash
npm test -- tests/integrationRuntime.test.js --runInBand
```

**Expected Output**:
```
PASS tests/integrationRuntime.test.js
  Integration Runtime Tests - E2E Pipeline Validation
    BUG 1: Program Studi Consistency
      ✓ berapa biaya TI - should show TI data consistently
    BUG 2: Scholarship Detail Explanation
      ✓ apa itu beasiswa KIP - should explain KIP, not list all scholarships
      ✓ apa itu beasiswa prestasi - should explain prestasi scholarship
    BUG 3: Career Guidance Intent Detection
      ✓ suka coding cocok jurusan apa - should classify as CAREER_GUIDANCE not SCHOLARSHIP
    BUG 4: Non-STIKOM Program Filtering
      ✓ should filter out non-STIKOM programs from recommendations
    Integration Test Suite - All 7 Scenarios
      ✓ Scenario 1: Berapa biaya TI?
      ✓ Scenario 2: Berapa biaya TI gelombang 3A?
      ✓ Scenario 3: Apa itu beasiswa KIP?
      ✓ Scenario 4: Apa itu beasiswa Prestasi?
      ✓ Scenario 5: Apa itu beasiswa Yayasan?
      ✓ Scenario 6: Saya suka coding cocok jurusan apa?
      ✓ Scenario 7: Kalau mau jadi Data Analyst cocok jurusan apa?

Test Suites: 1 passed, 1 total
Tests:      12 passed, 12 total ✓
```

---

## Manual Testing Checklist

### Test 1: BUG 1 - Program Consistency

**Setup**: Start bot in debug mode
```bash
DEBUG_TRACE=true npm start
```

**Test Case 1.1**: Simple cost query
```
Input:  User sends: "Berapa biaya TI?"
Check:  
  ✓ Bot logs show [TRACE_PROGRAM_QUERY] = "TI"
  ✓ Bot logs show [TRACE_PROGRAM_RAG] = "TEKNOLOGI_INFORMASI"
  ✓ Bot logs show [TRACE_PROGRAM_FINAL] = "MATCH"
  ✓ Response mentions only "Teknologi Informasi" (not MI)
  ✓ Response includes costs (DPP, registration, etc.)
```

**Test Case 1.2**: Wave-specific query
```
Input:  User sends: "Berapa biaya TI gelombang 3A?"
Check:
  ✓ Response mentions "Teknologi Informasi" consistently
  ✓ Response includes "Gelombang 3A" information
  ✓ No mention of other programs
```

**Test Case 1.3**: Different program
```
Input:  User sends: "Berapa biaya SI?"
Check:
  ✓ Bot logs show [TRACE_PROGRAM_QUERY] = "SI" (not TI!)
  ✓ Response mentions "Sistem Informasi" only
```

---

### Test 2: BUG 2 - Scholarship Detail vs List

**Test Case 2.1**: Specific scholarship (KIP)
```
Input:  User sends: "Apa itu beasiswa KIP?"
Check:
  ✓ Bot logs show [TRACE_SCHOLARSHIP_INTENT] = "SPECIFIC_SCHOLARSHIP_DETAIL"
  ✓ Response explains KIP (Kartu Indonesia Pintar)
  ✓ Response includes: eligibility, benefits, process
  ✗ Response should NOT include: "Ada beberapa jenis beasiswa..."
  ✗ Response should NOT list other scholarships (1K1S, Prestasi, etc.)
```

**Test Case 2.2**: Generic scholarship list
```
Input:  User sends: "Ada beasiswa apa saja di STIKOM?"
Check:
  ✓ Bot logs show [TRACE_SCHOLARSHIP_INTENT] = "SCHOLARSHIP_LIST"
  ✓ Response lists all available scholarships
  ✓ Response includes: KIP, 1K1S, Prestasi, Yayasan, etc.
```

**Test Case 2.3**: Another specific scholarship
```
Input:  User sends: "Berapa potongan beasiswa Prestasi?"
Check:
  ✓ Bot logs show [TRACE_SCHOLARSHIP_INTENT] = "SPECIFIC_SCHOLARSHIP_DETAIL"
  ✓ Response explains Prestasi scholarship specifically
  ✓ Response includes: discount percentage, requirements
```

---

### Test 3: BUG 3 - Career Guidance vs Scholarship

**Test Case 3.1**: Career guidance priority
```
Input:  User sends: "Saya suka coding cocok jurusan apa?"
Check:
  ✓ Bot logs show [TRACE_CAREER_INTENT] = "CAREER_GUIDANCE" (NOT SCHOLARSHIP!)
  ✓ Response recommends programs for coding
  ✓ Response includes: TI, SI, SK (programming-focused)
  ✗ Response should NOT mention: beasiswa, biaya pendaftaran, etc.
```

**Test Case 3.2**: Different career interest
```
Input:  User sends: "Saya ingin jadi designer cocok jurusan mana?"
Check:
  ✓ Bot logs show [TRACE_CAREER_INTENT] = "CAREER_GUIDANCE"
  ✓ Response recommends design-related programs
  ✓ Response includes: DKV, MM, AN, DG
```

**Test Case 3.3**: Cost question (NOT career)
```
Input:  User sends: "Berapa biaya per semester?"
Check:
  ✓ Bot logs show [TRACE_CAREER_INTENT] = "NOT_CAREER"
  ✓ Intent properly detected as COST (not CAREER_GUIDANCE)
  ✓ Response shows costs and payment info
```

---

### Test 4: BUG 4 - Non-STIKOM Program Filtering

**Test Case 4.1**: Check output doesn't include non-STIKOM
```
Input:  User sends: "Jurusan komputer apa yang bagus?"
Scan Output For Non-STIKOM Programs:
  ✗ Should NOT contain: "Teknik Informatika"
  ✗ Should NOT contain: "Ilmu Komputer"
  ✗ Should NOT contain: "Statistika"
  ✗ Should NOT contain: "Teknik Industri"
  ✓ Should ONLY contain: STIKOM programs (TI, SI, SK, BD, MI, DKV, TRPL, TK, MM, AN, DG)
```

**Test Case 4.2**: Verify STIKOM programs present
```
Input:  User sends: "Program apa di STIKOM yang fokus keamanan?"
Check Output Contains:
  ✓ Sistem Komputer
  ✓ Teknologi Informasi
  ✓ Sistem Informasi
  ✗ NO non-STIKOM programs listed
```

---

### Test 5: BUG 5 - Trace Logs Validation

**Test Case 5.1**: Check trace file generation
```bash
# Kill previous process
# Start fresh with tracing
DEBUG_TRACE=true npm start &

# Send test message through bot
# (use WhatsApp or webhook test)

# Check traces were created
ls -lah .traces/traces-*.json

# View latest trace
cat .traces/traces-*.json | tail -1 | jq '.'
```

**Expected trace structure**:
```json
{
  "TRACE_PROGRAM_QUERY": {
    "userQuery": "Berapa biaya TI?",
    "programExtracted": "TI",
    "confidence": "HIGH"
  },
  "TRACE_PROGRAM_RAG": {
    "userQuery": "Berapa biaya TI?",
    "programExtracted": "TEKNOLOGI_INFORMASI",
    "source": "rag_mock"
  },
  "TRACE_PROGRAM_FINAL": {
    "userQuery": "Berapa biaya TI?",
    "extractedProgram": "TI",
    "finalAnswer": "Biaya untuk Program Studi Teknologi Informasi...",
    "ragSource": "rag-match"
  },
  "TRACE_SCHOLARSHIP_INTENT": {
    "userQuery": "Apa itu beasiswa KIP?",
    "intent": "SPECIFIC_SCHOLARSHIP_DETAIL",
    "targetScholarship": "KIP"
  },
  "TRACE_CAREER_INTENT": {
    "userQuery": "Saya suka coding cocok jurusan apa?",
    "intent": "CAREER_GUIDANCE_RECOMMENDATION",
    "recommendedPrograms": ["TEKNOLOGI_INFORMASI", "SISTEM_INFORMASI", "SISTEM_KOMPUTER"]
  }
}
```

---

## Automated Test Suite

### Run Full Test Suite
```bash
npm test
```

### Run Specific Test File
```bash
npm test -- tests/integrationRuntime.test.js
```

### Run Specific Test Group
```bash
# Only BUG 1 tests
npm test -- tests/integrationRuntime.test.js --testNamePattern="Program Studi Consistency"

# Only BUG 2 tests
npm test -- tests/integrationRuntime.test.js --testNamePattern="Scholarship Detail"

# Only BUG 3 tests
npm test -- tests/integrationRuntime.test.js --testNamePattern="Career Guidance"

# Only integration scenarios
npm test -- tests/integrationRuntime.test.js --testNamePattern="Integration Test Suite"
```

### Run with Verbose Output
```bash
npm test -- tests/integrationRuntime.test.js --verbose
```

---

## Edge Cases to Test

### Edge Case 1: Program in Follow-up Message
```
Chat History:
  1. User: "Berapa biaya TI?"
     Bot: "Teknologi Informasi costs..."
  2. User: "Apa persyaratan masuknya?" (no program mentioned)
     Check: Bot should remember TI from context
```

### Edge Case 2: Multiple Programs Mentioned
```
Input: "Perbandingan biaya TI dan SI?"
Check:
  ✓ Should detect 2 programs
  ✓ Should compare their costs
  ✓ Should NOT mix program data
```

### Edge Case 3: Typo/Abbreviation
```
Input: "Berapa harga T.I?"  (with dot)
Input: "Berapa harga Tek Informatika?"  (abbreviation)
Check:
  ✓ Should still normalize to "Teknologi Informasi"
  ✓ Should fetch correct data
```

### Edge Case 4: Scholarship + Program
```
Input: "Apa beasiswa untuk TI?"
Check:
  ✓ Should recognize both scholarship intent AND program
  ✓ Should filter scholarship data by TI program
```

### Edge Case 5: Career + Scholarship Mention
```
Input: "Saya suka coding, berapa biaya dengan beasiswa?"
Check:
  ✓ Should prioritize career guidance (from classifier)
  ✓ Should recommend programs (not list scholarships)
  ✓ Should NOT confuse with scholarship query
```

---

## Performance Testing

### Check Response Time
```bash
# Time a single request
time curl -X POST http://localhost:3000/webhook/provider \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test","text":"Berapa biaya TI?"}'
```

**Expected**: < 1 second (with RAG latency)

### Load Test (Optional)
```bash
npm test -- --testNamePattern="Integration Test Suite" --detectOpenHandles
```

---

## Debugging Tips

### If tests fail:

1. **Check logs**
   ```bash
   DEBUG_TRACE=true npm test -- tests/integrationRuntime.test.js 2>&1 | grep ERROR
   ```

2. **Check trace files**
   ```bash
   cat .traces/traces-*.json | jq '.' | grep -A5 "ERROR"
   ```

3. **Check specific trace type**
   ```bash
   cat .traces/traces-*.json | jq '.TRACE_PROGRAM_FINAL'
   ```

4. **Verify module imports**
   ```javascript
   // In node console:
   node
   > const tracer = require('./src/engine/programTracer.js')
   > console.log(Object.keys(tracer))
   ```

5. **Run individual test**
   ```bash
   npm test -- tests/integrationRuntime.test.js --testNamePattern="Scenario 1"
   ```

---

## Success Criteria

✅ **Integration Tests**: All 12/12 PASS  
✅ **Program Consistency**: No header/content mismatch  
✅ **Scholarship Specific**: Returns detail, not list  
✅ **Career Intent**: Recognized separately from scholarship  
✅ **STIKOM Only**: No non-STIKOM programs in output  
✅ **Trace Logs**: 5 trace types generated per request  
✅ **Performance**: No noticeable slowdown (< 1ms overhead)  

---

## Validation Script

Create `validate-fixes.sh` to run all tests:

```bash
#!/bin/bash

echo "🧪 Running Integration Tests..."
npm test -- tests/integrationRuntime.test.js --runInBand

if [ $? -eq 0 ]; then
  echo "✅ All integration tests PASSED"
  echo ""
  echo "📊 Trace Statistics:"
  TRACE_COUNT=$(find .traces -name "*.json" | wc -l)
  echo "  Total trace files: $TRACE_COUNT"
  
  LAST_TRACE=$(ls -t .traces/traces-*.json 2>/dev/null | head -1)
  if [ ! -z "$LAST_TRACE" ]; then
    echo "  Latest trace: $LAST_TRACE"
    echo "  Trace content sample:"
    jq '.TRACE_PROGRAM_FINAL' "$LAST_TRACE"
  fi
else
  echo "❌ Integration tests FAILED"
  exit 1
fi
```

---

## Post-Integration Testing (After Adding to provider.js)

### Sanity Checks
```
1. npm test  # All existing tests pass
2. npm test -- tests/integrationRuntime.test.js  # New tests pass
3. npm run dev  # Server starts without errors
4. Manual test: "Berapa biaya TI?"  # Works correctly
5. Manual test: "Apa itu KIP?"  # Specific scholarship
6. Manual test: "Suka coding cocok apa?"  # Career guidance
```

### Integration Test Commands
```bash
# Check all tests
npm test

# Check only integration
npm test -- tests/integrationRuntime.test.js

# Check only provider (if exists)
npm test -- tests/provider.test.js

# Check for regressions
npm test -- --coverage
```

---

## When Tests Fail

| Failure | Check | Fix |
|---------|-------|-----|
| "Cannot find module" | Import paths in provider.js | Check file exists and path is correct |
| "undefined function" | Exports in new modules | Verify `module.exports = { func1, func2, ... }` |
| "Trace not found" | Enable DEBUG_TRACE | Set `DEBUG_TRACE=true` when running |
| "Program mismatch" | Consistency check logic | Verify normalizeProgramName() working |
| "Scholarship list returned" | Intent classifier | Check KNOWN_SCHOLARSHIPS contains the name |

---

## Success - You're Done! 🎉

When all tests pass:
```
✅ 12/12 Integration Tests PASS
✅ No errors in logs
✅ Trace logs generated
✅ Ready for production

Next: Deploy to staging → Monitor → Production
```
