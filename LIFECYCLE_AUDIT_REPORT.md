# Lifecycle Ownership Audit Report
**Date:** May 22, 2026  
**Status:** Read-Only Audit (No Code Changes)  
**Scope:** registrationLifecycle.js authority vs provider.js (src/routes/provider.js) coupling  

---

## Executive Summary

Successfully centralized 4 flows:
- `pendingProgramSelection` ✓
- `pendingAdmissionApplicantType` ✓
- `pendingMenuCost` ✓
- `pendingScheduleWave` ✓

**Found 8 critical remaining lifecycle ownership leaks** requiring migration.  
**Found 5 reset semantic drift patterns** causing stale-state hijacking risk.  
**Found 3 major dual-offer lifecycle coupling issues**.

---

## CATEGORIZED FINDINGS

### 🔴 HIGH SEVERITY: Write-Path Leaks

#### 1. **pendingFollowupChoice** — HEAVY MUTATION SCATTER
**Owner Leak:** provider.js (src/routes/provider.js)  
**Type:** Write-path leak (persisted inline 11+ locations)

| Line | Operation | Context | Risk |
|------|-----------|---------|------|
| 6494 | `delete clearedData.pendingFollowupChoice` | post_fee_options early-clear | ✓ Cleanup responsibility split |
| 7378 | `delete clearedData.pendingFollowupChoice` | scholarshipChoice handler | ✓ Cleanup responsibility split |
| 7417 | Set `pendingScholarshipChoice` | post_fee_options → beasiswa | ✓ Related state mutation |
| 7445 | Set `pendingFollowupChoice: {type: 'post_fee_options'}` | reprompt after unrecognized | ✓ Duplicate reset semantics |
| 7529 | Set `pendingFollowupChoice: {type: 'total_vs_discount'}` | post_fee deterministic | ✓ Coupled with pendingTotalCost |
| 8022 | `delete clearedData.pendingFollowupChoice` | deterministic_total cleanup | ✓ Cleanup responsibility split |
| 8037 | Set via spread after clear | post_fee_options flow | ✓ Inconsistent mutation pattern |
| 8085 | `delete clearedData.pendingFollowupChoice` | wave fallback cleanup | ✓ Cleanup responsibility split |
| 8120 | `delete clearedData.pendingFollowupChoice` | RAG total cost fallback | ✓ Cleanup responsibility split |
| 8167 | `delete clearedData.pendingFollowupChoice` | RAG cascade fallback | ✓ Cleanup responsibility split |

**Severity:** HIGH  
**Issue:** 11 separate write/delete operations scattered across different fee/schedule flows  
**Risk:** Stale `pendingFollowupChoice` can hijack unrelated "yes/no" responses for 10+ minutes (TTL at line 6487)  
**Coupled To:** `pendingTotalCost`, `pendingScheduleWave`, `pendingScholarshipChoice`

---

#### 2. **pendingTotalCost** — HEAVY MUTATION SCATTER  
**Owner Leak:** provider.js (src/routes/provider.js)  
**Type:** Write-path leak (persisted inline 10+ locations)

| Line | Operation | Context | Risk |
|------|-----------|---------|------|
| 7830 | Set `pendingTotalCost: {type: 's1_total', program}` | Need gelombang path | ✓ Inline mutation |
| 7837 | Mutate `sessionData.pendingTotalCost` directly | Same-request state sync | ✗ **CRITICAL: Direct sessionData mutation** |
| 7952 | Set `pendingTotalCost: {type: 's1_total', program}` | Need program path | ✓ Inline mutation |
| 7958 | Mutate `sessionData.pendingTotalCost` directly | Same-request state sync | ✗ **CRITICAL: Direct sessionData mutation** |
| 7975 | Set `pendingTotalCost: {type: 's1_total'}` | No program detected | ✓ Inline mutation |
| 8021 | `delete clearedData.pendingTotalCost` | Deterministic total cleanup | ✓ Cleanup responsibility split |
| 8037 | Set via spread after clear | post_fee_options context | ✓ Inconsistent mutation pattern |
| 8084 | `delete clearedData.pendingTotalCost` | Wave fallback cleanup | ✓ Cleanup responsibility split |
| 8119 | `delete clearedData.pendingTotalCost` | RAG total cost fallback | ✓ Cleanup responsibility split |
| 8167 | `delete clearedData.pendingTotalCost` | RAG cascade fallback | ✓ Cleanup responsibility split |

**Severity:** HIGH  
**Issue:** 10 separate mutations + 2 direct in-memory mutations at lines 7837, 7958  
**Risk:** Same-request state leakage — `sessionData.pendingTotalCost` mutations can escape upsert scope  
**Persisted/In-Memory Split:** UNSAFE — mutations at 7837 and 7958 are in-memory only, may not persist to DB

---

#### 3. **pendingFeeBreakdownOffer** — MUTATION SCATTER
**Owner Leak:** provider.js (src/routes/provider.js)  
**Type:** Write-path leak + same-request mutation pattern

| Line | Operation | Context | Risk |
|------|-----------|---------|------|
| 8717 | `delete clearedData.pendingFeeBreakdownOffer` | Fee breakdown Yes cleanup | ✓ Cleanup responsibility split |
| 8744 | `delete clearedData.pendingFeeBreakdownOffer` | Fee breakdown No cleanup | ✓ Cleanup responsibility split |
| 8796 | `delete clearedData.pendingFeeBreakdownOffer` | Fee breakdown dual-degree | ✓ Cleanup responsibility split |
| 8798 | Mutate `clearedData.lastProgramHint = String(programHint)` | **MIXED STATE MUTATION** | ✗ Dual-degree state leak |
| 8861 | `delete clearedData.pendingFeeBreakdownOffer` | Fee breakdown program select | ✓ Cleanup responsibility split |

**Severity:** HIGH  
**Issue:** 5 separate deletes + persistent program hint coupling at line 8798  
**Risk:** `lastProgramHint` is being written during `pendingFeeBreakdownOffer` cleanup — cross-lifecycle coupling  
**Dual-Offer Risk:** Lines 8796-8798 show fee breakdown handlers writing program state

---

#### 4. **pendingScholarshipChoice** — WRITE SCATTER
**Owner Leak:** provider.js (src/routes/provider.js)  
**Type:** Write-path leak

| Line | Operation | Context | Risk |
|------|-----------|---------|------|
| 7417 | Set `pendingScholarshipChoice: {ts}` | post_fee_options → beasiswa | ✓ Inline set |
| 7589 | `delete clearedData.pendingScholarshipChoice` | Scholarship selection cleanup | ✓ Cleanup split |

**Severity:** MEDIUM  
**Issue:** Set and cleanup scattered; coupling to `pendingFollowupChoice` at lines 7417-7420  
**Risk:** Scholarship flow state not isolated from fee-offering state

---

#### 5. **pendingWaveClarification** — DIRECT MUTATION
**Owner Leak:** provider.js (src/routes/provider.js)  
**Type:** Write-path leak (direct deletion without abstraction)

| Line | Operation | Context | Risk |
|------|-----------|---------|------|
| 8640 | `delete clearedData.pendingWaveClarification` | Wave clarification Yes | ✓ Direct delete |
| 8667 | `delete clearedData.pendingWaveClarification` | Wave clarification No | ✓ Direct delete |

**Severity:** MEDIUM  
**Issue:** Direct property deletion (not using `clearPendingWaveClarification()` from registrationLifecycle.js)  
**Risk:** If ever need to cascade cleanup, no central authority exists

---

#### 6. **pendingNonMarketingDeptContact** — DIRECT MUTATION
**Owner Leak:** provider.js (src/routes/provider.js)  
**Type:** Write-path leak (direct deletion + state mutation)

| Line | Operation | Context | Risk |
|------|-----------|---------|------|
| 8920 | `delete clearedData.pendingNonMarketingDeptContact` | Contact selection cleanup | ✓ Direct delete |
| 8936-8939 | Mutate multiple fields in single operation | Cleanup with selection tracking | ✗ **MIXED STATE MUTATION** |

**Severity:** MEDIUM  
**Issue:** Lines 8936-8939 clear `pendingNonMarketingDeptContact` AND `nonMarketingMenuActive` AND `nonMarketingMenuShownAt` while setting `lastNonMarketingMenuSelection` — multiple lifecycle concerns in one mutation  
**Risk:** State coupling between menu persistence and pending state

---

#### 7. **pendingPmbMenu** — READ-ONLY LEAK
**Owner Leak:** provider.js (src/routes/provider.js)  
**Type:** Read-path leak (no centralized accessor)

| Line | Operation | Context | Risk |
|------|-----------|---------|------|
| 3427 | `if (sd.pendingPmbMenu) return false;` | Guard check in registration flow | ✓ Read-only |
| **NO SET** | — | Likely set inline elsewhere | ? Unknown writer |

**Severity:** MEDIUM  
**Issue:** Read-path exists at line 3427 but no centralized setter in registrationLifecycle.js  
**Risk:** Orphaned state flag — no migration target exists yet

---

#### 8. **pendingFeeDetail** — WRITE LEAK + DEBUG SCATTER
**Owner Leak:** provider.js (src/routes/provider.js)  
**Type:** Read-path leak (read without centralized ownership)

| Line | Operation | Context | Risk |
|------|-----------|---------|------|
| 6394-6395 | Read `sessionData.pendingFeeDetail` | Debug logging only | ✓ Read check |
| 6425 | `const hasPendingFeeDetail = !!(sessionData && sessionData.pendingFeeDetail)` | Ephemeral cleanup guard | ✓ Condition check |
| 6457 | Check in follow-up shape preservation | Pending state hijack prevention | ✓ Condition check |
| **NO SET** | — | Set location unknown in audit scope | ? Unknown writer |

**Severity:** MEDIUM  
**Issue:** Reads scattered across 3 locations; setter location not found in this audit  
**Risk:** Orphaned state flag — cleanup path exists but no creation path visible

---

### 🟡 MEDIUM SEVERITY: Cleanup-Path Leaks

#### 9. **clearEphemeralSessionFlagsInPlace() — GENERIC RESET WITH SIDE EFFECTS**
**Location:** provider.js lines 57-117 (local function)  
**Type:** Generic reset with optional flags

**Issues:**
- Lines 64-77: Hardcoded list of ALL 14 pending keys (duplicates registrationLifecycle.js REGISTRATION_PENDING_KEYS)
- Lines 87-113: Multi-option clearing (resetRegistrationFlow, resetProgramHints, resetHandover, resetNumericMenuContext)
- Line 82: `nonMarketingMenuActive` and `nonMarketingMenuShownAt` cleared here BUT also in line 8936-8938

**Risk:** RESET SEMANTIC DRIFT
- Called at lines 6469 (ephemeral cleanup), 6563 (wrong answer), 6768 (out-of-scope)
- Different callers pass different option combinations → inconsistent cleanup semantics
- No TTL enforcement on stale pending states

---

#### 10. **Greeting/Menu Restart Lifecycle — FRAGMENTED RESET**
**Locations:** Lines 6820-6930, 7045-7075, 7156-7234  
**Type:** Multiple reset paths with inconsistent semantics

**Three Reset Patterns Found:**

**Pattern A: Hard Menu Reset (Line 6827-6930)**
```
isHardSessionResetCommand("menu"|"start"|"0")
  → clearEphemeralSessionFlagsInPlace(...all options...)
  → reset registrationFlow, programHints, handover, numericMenuContext
```
Upserts welcome_message or FSM menu or fallback prompt

**Pattern B: Pure Greeting Restart (Line 7156-7234)**
```
isPureGreetingRestart("halo"|"pagi"|"halo selamat pagi")
  → Delete registrationFlow, lastProgramHint, lastUnansweredText
  → Reset handoverOffered=false, unansweredCount=0
  → New welcome message + greeting
```
Uses different deletion pattern (explicit key deletes, not clearEphemeralSessionFlagsInPlace)

**Pattern C: Threshold Welcome (Line 7232-7297)**
```
needWelcome (first-time OR >24h threshold)
  → handoverOffered=false, unansweredCount=0
  → welcomeSent=true
  → Optional: numericMenuActive if welcome is numeric menu
```
Only clears handover + unanswer counts, NOT full ephemeral state

**Severity:** MEDIUM  
**Risk:** User greeting "halo" triggers Pattern B (aggressive reset), but user menu "menu" triggers Pattern A (same result via different code path) → unmaintainable redundancy

---

#### 11. **Generic Fallback Reset Behavior — SCATTERED ACROSS 5 LOCATIONS**
**Locations:**
- Line 6563 (wrong_answer_feedback): clears handover+numeric context only
- Line 6768 (out-of-scope technical): clears handover+numeric context
- Line 6772 (out-of-scope STIKOM): clears handover+unanswered count (different!)
- Line 7101 (handover decline): clears handover+unanswered (same as 6772)
- Line 7350 (handover decline): **same code copy-paste as 7101**

**Severity:** MEDIUM  
**Risk:** DUPLICATED RESET SEMANTICS — lines 7101 and 7350 are identical code (reset handover + unansweredCount) but called from different contexts

---

### 🟠 MEDIUM SEVERITY: Read-Path Leaks

#### 12. **pendingFollowupChoice TTL Check — INCONSISTENT WITH OTHER PENDING STATES**
**Location:** Lines 6487-6488 (10-minute TTL only)  
**Type:** Read-path leak (stale-state risk)

```javascript
const pendingTs = pending && pending.ts ? new Date(pending.ts) : null;
const pendingFresh = pendingTs && !Number.isNaN(pendingTs.getTime()) ? ((now - pendingTs) / (1000 * 60)) <= 10 : false;
```

**Issue:** Only `pendingFollowupChoice` has a 10-minute TTL check.  
Other pending states:
- `pendingTotalCost` — NO TTL check (can stale-hijack for indefinite time!)
- `pendingFeeBreakdownOffer` — NO TTL check
- `pendingScholarshipChoice` — NO TTL check
- `pendingWaveClarification` — NO TTL check

**Severity:** MEDIUM  
**Risk:** STALE PENDING-STATE HIJACK — if user delays >10 min after pendingFollowupChoice offer, state clears. But pendingTotalCost can hijack a "1" response weeks later.

---

#### 13. **Handover Offer TTL — FRAGMENTED VALIDATION**
**Location:** Lines 7273-7311 (complex stale-state check)  
**Type:** Read-path leak (complex stale-state logic not centralized)

**Issues:**
- Lines 7278-7288: Manual TTL calculation (24h default, configurable)
- Line 7289-7293: THREE separate validity checks (offeredAt timestamp, last bot message content, fallback lastSeenAt)
- Line 7295-7301: Only clears if "not valid" — stale offers suppress reprocessing

**Risk:** Handover flow has complex stale-state management but no other pending states have similar sophistication

---

#### 14. **Session Data Reads Occurring Outside registrationLifecycle.js**
**Locations:**
- outbound.js lines 68-73: Reads 6 pending states (pendingFollowupChoice, pendingFeeBreakdownOffer, pendingFeeDetail, pendingTotalCost, pendingWaveClarification)
- provider.js lines 3423-3427: Reads pendingNonMarketingDeptContact, pendingPmbMenu (registration flow guard)
- provider.js lines 6394-6460: Reads ALL 10 pending states for ephemeral cleanup conditions

**Risk:** Multiple uncontrolled read paths for pending state validation — no single source of truth

---

### 🔵 LOW-MEDIUM SEVERITY: Session Drift Patterns

#### 15. **Telemetry/Session Drift — Intro and Welcome Flags Scattered**
**Type:** Read-path + write-path leak

**Intro Flag:**
- Lines 6651-6682: introSentAt + introSent written during intro send
- Lines 6645: introSentAtRaw read from sessionData
- No centralized accessor

**Welcome Flag:**
- Lines 7045-7234: welcomeSentAt + welcomeSent written during welcome send
- Line 7045: welcomeAlreadySent read from sessionData
- No centralized accessor

**Severity:** LOW-MEDIUM  
**Risk:** If any new flow needs intro/welcome logic, must know to check/set these flags manually

---

#### 16. **lastProgramHint — Cross-Flow Mutation Coupling**
**Location:** Multiple scattered locations
- Line 7058: Set during fee breakdown dual-degree handling (line 8798)
- Line 8338: Set during menu cost selection
- Line 6521-6546: Written during early "program hint" persistence phase

**Severity:** LOW  
**Risk:** Program hint is both a READ hint (for fee/program/schedule queries) and a WRITE side-effect of cleanup (line 8798) — mixed responsibilities

---

## RESET SEMANTIC DRIFT PATTERNS

### Pattern 1: Ephemeral Cleanup vs Hard Reset
**Difference:**
- **Ephemeral cleanup** (line 6406-6470): Clears pending flags ONLY if incoming message looks unrelated to follow-up
- **Hard reset** (line 6820-6930): Clears ALL pending + registration flow + program hints if user says "menu"

**Risk:** A user can trigger Pattern 1 accidentally with unrelated question, losing pending state. But if they say "menu", Pattern 2 triggers (expected reset).

### Pattern 2: Registration Flow Reset + Program Hints Reset
**Issue:** `resetRegistrationFlow` and `resetProgramHints` are separate options in clearEphemeralSessionFlagsInPlace, but should they always clear together?

Currently:
- Menu reset: clears BOTH (line 6836-6839 options all=true)
- Pure greeting restart: clears BOTH manually (line 7156 deletes both keys)
- Handover decline: clears NEITHER

**Risk:** Inconsistent semantics — when should registration flow and program hints clear together?

---

## DUAL-OFFER FOLLOW-UP LIFECYCLE — 3 CRITICAL COUPLINGS

### Coupling 1: pendingFollowupChoice ↔ pendingScholarshipChoice ↔ pendingFeeBreakdownOffer
**Flow Sequence:**
1. Fee breakdown shown → set `pendingFeeBreakdownOffer` (implicit, not found in registrationLifecycle)
2. User replies → check pendingFeeBreakdownOffer conditions (lines 6458)
3. If matches → clear pending, set `pendingFollowupChoice: {type: 'post_fee_options'}`
4. User replies → check pendingFollowupChoice conditions (line 7371)
5. If "scholarship" → set `pendingScholarshipChoice`
6. User replies → handle scholarship selection, clear both pendingScholarshipChoice + pendingFollowupChoice

**Risk:** MISSING WRITER — `pendingFeeBreakdownOffer` is read at line 6458 and 8716 but has NO setter in registrationLifecycle.js. Where is it written initially?

### Coupling 2: pendingTotalCost ↔ pendingFollowupChoice Cascade
**Flow Sequence:**
1. Fee question → set `pendingTotalCost` (lines 7830, 7952, 7975)
2. Inbound → check pendingTotalCost conditions (line 6456)
3. If matches gelombang → clear, set `pendingFollowupChoice: {type: 'post_fee_options'}` (line 7920)
4. User replies → handle post_fee_options choice

**Risk:** Same-request IN-MEMORY mutations (lines 7837, 7958) may not persist correctly if upsert fails

### Coupling 3: Non-Marketing Department Flow Isolation
**Location:** Lines 8889-8944  
**Issue:** `pendingNonMarketingDeptContact` lifecycle is tightly coupled to:
- `nonMarketingMenuActive` (cleared line 8937)
- `nonMarketingMenuShownAt` (cleared line 8938)
- `lastNonMarketingMenuSelection` (set line 8939)

All 4 state items are modified in single operation → no isolation possible.

---

## STALE PENDING-STATE EXPIRATION SEMANTICS

**Current State:**
- Only `pendingFollowupChoice` has TTL: 10 minutes (line 6487)
- Only `handoverOffered` has TTL: 24 hours configurable (line 7278-7288)
- All other pending states: NO TTL (can stale-hijack indefinitely)

**Risk Severity:** HIGH  
**Examples:**
1. User asks fee question → `pendingTotalCost` set
2. User returns 3 days later, types "1" for unrelated question
3. Bot interprets as wave selection (pendingTotalCost never cleared)
4. Wrong fee response sent

**Recommended TTL Model:**
- `pendingTotalCost`: 30 minutes (user expects quick gelombang response)
- `pendingFollowupChoice`: 30 minutes (current 10m too short)
- `pendingFeeBreakdownOffer`: 30 minutes (post-fee context)
- `pendingScholarshipChoice`: 15 minutes (one-time selection)
- `pendingWaveClarification`: 30 minutes (follow-up clarification)
- `pendingFeeDetail`: 15 minutes (fee detail selection)
- `pendingProgramInfoMenu`: 30 minutes (info browsing)

---

## RECOMMENDED MIGRATION ORDER

### 🎯 **Safest Next Step: pendingFollowupChoice**

**Why First:**
1. Already has some lifecycle isolation (post_fee_options type checking, 10-min TTL)
2. Highest write-scatter (11 locations) — consolidating it will yield immediate code reduction
3. Central to dual-offer flow — migrating it unblocks pendingFeeBreakdownOffer and pendingScholarshipChoice migrations
4. Only 1 test file covers it (providerWebhook.test.js) — lower regression risk than multi-flow states

**Expected Changes:**
- Create `setPendingFollowupChoice(sessionData, {type, ...}, opts)` in registrationLifecycle.js
- Create `clearPendingFollowupChoice(sessionData, opts)` in registrationLifecycle.js
- Add TTL extension: change 10 minutes → 30 minutes (configurable via env)
- Replace 11 inline mutations with function calls

**Regression Validation:**
- Run: `npx jest tests/providerWebhook.test.js --runInBand --testNamePattern="pendingFollowupChoice|post_fee"`
- Run: `npx jest tests/providerWebhook.test.js --runInBand --testNamePattern="scholarship"`
- Ensure pendingFollowupChoice reprompts still work at lines 7445
- Ensure same-request state merging works (post_fee_options → beasiswa transition)

**Estimated Scope:** ~15 edits, 1 file (registrationLifecycle.js), 2-3 test runs

---

### Priority Queue (After pendingFollowupChoice):

2. **pendingFeeBreakdownOffer** (HIGH) — Write-path leak with lastProgramHint coupling
3. **pendingTotalCost** (HIGH) — Direct sessionData mutations (lines 7837, 7958) + 10 write locations
4. **pendingWaveClarification** (MEDIUM) — Direct deletion, no central authority
5. **Greeting/Menu Restart Lifecycle** (MEDIUM) — Dual reset patterns (Pattern A vs B)
6. **pendingScholarshipChoice** (MEDIUM) — Coupled to dual-offer flow
7. **Generic Fallback Reset** (LOW) — De-duplicate lines 7101 and 7350
8. **pendingPmbMenu** (LOW) — Orphaned read-only state, no setter found

---

## VALIDATION CHECKLIST (For Each Migration)

✅ **Before Migration:**
- [ ] Read registrationLifecycle.js to understand existing patterns
- [ ] Identify all read/write/delete locations for target pending key
- [ ] Check for TTL patterns and timestamp fields
- [ ] Document any cross-flow couplings

✅ **During Migration:**
- [ ] Create setter function (if write-path exists)
- [ ] Create clearer function (if cleanup-path exists)
- [ ] Add preserveKeys option if cascading cleanup needed
- [ ] Test same-request state merging (if pendingX.ts exists)
- [ ] Update direct mutations to use new functions
- [ ] Do NOT modify provider.js beyond function call replacements

✅ **After Migration:**
- [ ] Run parser validation: `npx jest tests/composer.test.js --runInBand`
- [ ] Run provider webhook tests (narrow to relevant flows only)
- [ ] Verify no new pending-state reads in provider.js
- [ ] Verify no direct `delete sessionData.pendingX` remains
- [ ] Verify no direct `sessionData.pendingX = {...}` mutations remain
- [ ] Check outbound.js still reads cleanly (via sessionData pass-through)

---

## ARCHITECTURE NOTES

**Current Authority in registrationLifecycle.js:**
- 14 pending keys defined as REGISTRATION_PENDING_KEYS
- 4 flows migrated with full write+cleanup+preserve semantics
- Pattern: `setPendingX()` creates with `ts` timestamp
- Pattern: `clearPendingX()` clears target key + enables preserve for others

**Missing in registrationLifecycle.js:**
- pendingFollowupChoice setter/clearer
- pendingFeeBreakdownOffer setter/clearer
- pendingTotalCost setter/clearer
- pendingFeeDetail setter/clearer
- pendingScholarshipChoice setter/clearer
- pendingWaveClarification setter/clearer
- pendingPmbMenu setter/clearer
- pendingNonMarketingDeptContact setter/clearer
- TTL enforcement functions
- Session intro/welcome flag management

**Recommendation:**
Once all 8 flows migrated → registrationLifecycle.js becomes single source of truth for ALL session pending state, NOT just registration-specific flows.

---

## CONCLUSION

**Safe to proceed with pendingFollowupChoice migration next.**

After migration:
- Reduce provider.js lines by ~30 (11 mutations consolidate to 1 function call pattern)
- Gain single cleanup authority for post-fee dual-offer flow
- Enable pendingFeeBreakdownOffer migration (currently blocked by pendingFollowupChoice coupling)
- Establish TTL pattern for stale-state expiration (currently only partial)

**No parser corruption risk** — pendingFollowupChoice is isolated to provider.js, not touching fileParser or FSM state machine.

---

**Next Action:** Await user confirmation to begin pendingFollowupChoice migration following these audit findings.
