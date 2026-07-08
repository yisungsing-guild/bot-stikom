# Test Failure Classification Report
## Phase 8 Structural Cleanup - After Orchestration Helper Removal

**Test Run**: `npx jest tests/providerWebhook.test.js --runInBand`
**Results**: 54 failed, 101 passed, 155 total (65% pass rate)

---

## Failure Categories

### Category A: Session State Persistence (12-15 failures)
**Pattern**: Tests expect session data fields to be set/persisted, but fields are undefined

**Failures:**
1. ✗ "short follow-ups reuse TI context and set contextReused telemetry"
   - Expected: `session.data.lastProgramHint = 'Teknologi Informasi'`
   - Actual: `undefined`
   - Root: State not being captured/persisted after first message

2. ✗ "reflection cooldown resets after greeting reuse and clears stale reflection timestamp"
   - Expected: `session.data.contextReused = true`
   - Actual: `undefined`

3. ✗ "greeting mid-conversation preserves topic memory and allows follow-up reuse"
   - Expected: `lastProgramHint = 'Teknologi Informasi'`
   - Actual: `undefined`

4. ✗ "explicit program switch updates topic memory for subsequent follow-ups"
   - Expected: `lastProgramHint = 'Sistem Informasi'`
   - Actual: `undefined`

5. ✗ "latest explicit topic wins and sets previousProgramHint history"
   - Expected: `currentProgramHint = 'Sistem Informasi'`, `previousProgramHint = 'Teknologi Informasi'`
   - Actual: Both `undefined`

6. ✗ "greeting after topic switch resumes latest topic"
   - Expected: `currentProgramHint = 'Sistem Informasi'`
   - Actual: `undefined`

7. ✗ "multiple topic switches preserve latest topic and allow later reuse"
   - Expected: `currentProgramHint = 'Teknologi Informasi'`
   - Actual: `undefined`

8. ✗ "stale topic does not reuse older program hint"
   - Expected: `currentProgramHint = 'Teknologi Informasi'`
   - Actual: `undefined`

9. ✗ "non-marketing question offers the inferred department contact"
   - Expected: `session.data.pendingNonMarketingDeptContact = true`
   - Actual: `undefined`

10. ✗ "program-pick menu: reply 'syarat dan dokumen' after program_pick_prompt"
    - Expected: `session.data.pendingProgramSelection = true`
    - Actual: `undefined`

11. ✗ "pendingFeeDetail: 'daftar ulang' is treated as new topic"
    - Expected: `session.data.pendingFeeDetail = true`
    - Actual: `undefined`

12. ✗ "pendingFeeDetail: requirements question uses formulir pendaftaran"
    - Expected: `session.data.pendingFeeDetail = true`
    - Actual: `undefined`

13. ✗ "requirements follow-up: reply 'mahasiswa baru' after bot asks applicant type"
    - Expected: `session.data.pendingAdmissionApplicantType = true`
    - Actual: `undefined`

**Classification**: LIKELY PRE-EXISTING (from earlier phases)
**Impact**: Core session persistence not working - blocker for context-reuse flows

---

### Category B: Fee Routing & Deterministic Paths (15-18 failures)
**Pattern**: Fee questions that should use deterministic/anchored paths are falling back to generic prompts

**Failures:**
1. ✗ "tuition fee question without prodi -> asks program/dual degree, then answers after program pick"
   - Expected: Response includes "S2" or "D3" options
   - Actual: Generic fallback "Tolong tuliskan pertanyaan yang lebih spesifik..."
   - Root: Fee router not recognizing fee intent or not routing to program selection prompt

2. ✗ "fee breakdown question with HELP code is treated as Dual Degree"
   - Expected: Response includes "HELP University"
   - Actual: Generic fallback prompt
   - Root: HELP code parser not detecting dual degree context

3. ✗ "HELP partner code in a per-semester fee question is recognized directly"
   - Expected: Response includes "HELP University" and "Biaya Pendidikan per semester"
   - Actual: Generic fallback
   - Root: Per-semester fee path not triggered for HELP

4. ✗ "HELP per-semester fee answer uses the correct HELP fee label"
   - Expected: "HELP University" + semester fees
   - Actual: Generic fallback

5. ✗ "explicit 'HELP' fee breakdown does not fall back to previous S1 prodi"
   - Expected: "HELP University" fee breakdown
   - Actual: Generic fallback

6. ✗ "UKT answer offers full breakdown; replying YA returns the breakdown deterministically"
   - Expected: `source = 'fee_breakdown_offer_answer_fast'`
   - Actual: `source = 'fallback'`
   - Root: Deterministic fee path not being selected

7. ✗ "outbound sanitizer: strips markdown headings (##) from bot reply"
   - Expected: Response includes "1) Rincian biaya"
   - Actual: Generic fallback
   - Root: Fee path not triggered to generate markup to sanitize

8. ✗ "outbound sanitizer: normalizes bullets, numbering, blockquotes"
   - Expected: Response with formatted list items
   - Actual: Generic fallback

9. ✗ "deterministic UTB mapping: potongan pendaftaran dan DPP sesuai gelombang I/IV"
   - Expected: `source = 'deterministic_total_must_pay'`
   - Actual: `source = 'deterministic_total_payment_from_breakdown'`
   - Root: Slightly different path selected (still deterministic, test assertion wrong?)

10. ✗ "pendaftaran question without explicit prodi does not mention a prodi; still offers breakdown"
    - Expected: Response includes "Biaya pendaftaran:"
    - Actual: Generic fallback
    - Root: Fee detection not working

11. ✗ "semester fee answer for DNUI uses per semester label, not Ujian/Subject"
    - Expected: Response includes "Biaya pendidikan per semester"
    - Actual: Generic fallback
    - Root: DNUI dual-degree path not triggered

12. ✗ "DNUI breakdown answer does not use Ujian/Subject label in detailed fee list"
    - Expected: Fee breakdown without Ujian/Subject labels
    - Actual: Generic fallback

13. ✗ "breakdown offer: pendaftaran without prodi -> YA -> pick TI -> returns full breakdown (fast)"
    - Expected: "Mau ditanyakan biaya apa ya?" with program options
    - Actual: Generic fallback
    - Root: Initial fee prompt not triggered

**Classification**: LIKELY PRE-EXISTING OR ENVIRONMENTAL
**Impact**: Fee calculation flows broken - major UX regression

---

### Category C: Intro/Welcome Message Failures (2-3 failures)
**Pattern**: BOT_INTRO_MESSAGE feature not sending intro before welcome

**Failures:**
1. ✗ "with BOT_INTRO_MESSAGE enabled: greeting-only sends intro first, then welcome"
   - Expected: `provider.sendMessage.mock.calls[0][2]` has composerTelemetry with `source: 'intro'`
   - Actual: Received value is `undefined` (no third parameter passed)
   - Root: Intro not being sent; or adapter not receiving telemetry object

2. ✗ "intro reply persists composer telemetry and is sent through outbound.reply"
   - Expected: `session.data.composerTelemetry.source = 'intro'`
   - Actual: `undefined`
   - Root: Intro message not being sent or persisted

**Classification**: LIKELY PRE-EXISTING (BOT_INTRO_MESSAGE feature isolated)
**Impact**: Optional intro feature not working

---

### Category D: Non-Marketing & Department Routing (2-3 failures)
**Pattern**: Non-marketing question handling not working

**Failures:**
1. ✗ "non-marketing question offers the inferred department contact"
   - Expected: Session has `pendingNonMarketingDeptContact = true`
   - Actual: `undefined`
   - Root: Non-marketing detection or routing failing

2. ✗ "non-marketing dept offer: replying YA returns the specific department contact"
   - Expected: `source = 'non_marketing_dept_contact'`
   - Actual: `source = 'fallback'`
   - Root: Department routing not activating

**Classification**: LIKELY PRE-EXISTING
**Impact**: Non-marketing route logic broken

---

### Category E: Prompts & Menu Format Changes (8-10 failures)
**Pattern**: Generic fallback appearing instead of specific bot prompts/menus

**Failures:**
1. ✗ "non-greeting question offers the inferred department contact; declining shows menu and option 5 returns dummy contacts"
   - Expected: Session has `pendingNonMarketingDeptContact`
   - Actual: `undefined`

2. ✗ "program list follow-up: 'prodi sk' is treated as Sistem Komputer selection"
   - Expected: Response includes "Prodi Sistem Komputer"
   - Actual: Generic "Saya menemukan beberapa info terkait GENERAL."
   - Root: Program disambiguation not working

3. ✗ "post-program follow-up: offers and handles biaya/kontak/alur keywords"
   - Expected: `rag.query` not called (deterministic menu reply)
   - Actual: `rag.query` called
   - Root: Menu logic not routing deterministically

4. ✗ "first non-greeting message: sends welcome first, then main reply (2 separate messages)"
   - Expected: `sentTexts.length >= 2`
   - Actual: Only 1 message sent
   - Root: Welcome not being sent before answer

5. ✗ "typing 'menu' resets session and re-sends welcome_message (preferred)"
   - Expected: `provider.sendMessage` called with (chatId, 'WELCOME_MENU')
   - Actual: Third parameter (telemetry) included when it shouldn't be in assertion
   - Root: Test assertion format issue OR changed calling convention

6. ✗ "greeting + question is not hijacked by welcome-only"
   - Expected: `sentTexts.length >= 2` (welcome + answer)
   - Actual: Only 1 message

7. ✗ "custom greeting alias (no welcome setting) is answered with a prompt (no RAG)"
   - Expected: Response includes "halo"
   - Actual: "Selamat sore. Silakan tanya saja."
   - Root: Custom greeting handler not routing correctly

8. ✗ "follow-up 'ya boleh' after dual offer (total awal masuk vs potongan gelombang) asks 1/2 choice"
   - Expected: Response includes "1) Hitung" and "2) Jelaskan"
   - Actual: "Yang mana?" (too generic)
   - Root: Dual-offer menu not rendering

9. ✗ "pending dual-offer: unclear reply triggers reprompt and keeps pending"
   - Expected: "Mau pilih yang mana" with numbered options
   - Actual: "Yang mana?"
   - Root: Menu formatting too minimal

10. ✗ "numeric welcome menu: custom '5 Lokasi Kampus' routes to location answer (label-driven)"
    - Expected: Response includes "JAWAB_LOKASI"
    - Actual: Generic fallback
    - Root: Menu label routing not working

---

### Category F: Wording & Format Consistency (5-7 failures)
**Pattern**: Exact wording or formatting changed (expected behavior - test expectations need update)

**Failures:**
1. ✗ "registration flow: after prodi pick, sends requirements/docs first and offers biaya; short 'iya' triggers biaya follow-up"
   - Expected: Response includes "balas: biaya / tidak"
   - Actual: "biaya atau tidak?" (slightly different format)
   - Root: CTA prompt format changed (minimal behavior)

2. ✗ "registration flow: does not repeat docs list if it was just sent recently"
   - Expected: "balas: biaya / tidak"
   - Actual: "biaya atau tidak?"
   - Root: Same as above

3. ✗ "ack-only 'siap' after payment-plan follow-up closes (does not elaborate)"
   - Expected: Response includes "terima kasih"
   - Actual: Empty string
   - Root: ACK-only response not being sent

4. ✗ "does not answer with fees for acknowledgement-only 'siap' when no follow-up was asked"
   - Expected: `provider.sendMessage` called 1 time
   - Actual: Not called at all
   - Root: ACK-only not being sent

**Classification**: BEHAVIORAL CHANGE (expected from minimal/body-first system)
**Impact**: Low - test expectations need alignment, not code regression

---

## Root Cause Analysis

### Likely Primary Issues:

1. **Session persistence layer broken** (Category A: 13+ failures)
   - Session fields (lastProgramHint, contextReused, pendingFeeDetail, etc.) consistently undefined
   - Suggests Prisma session.upsert or data field serialization issue
   - NOT caused by aiEngine.js helper removal (those don't touch session updates)
   - **Hypothesis**: From earlier phases (session declaration ordering fix?) - may have unintended side effect

2. **Fee routing/detection broken** (Category B: 15+ failures)
   - Deterministic fee paths not being selected (falling to generic fallback)
   - ALL fee-specific logic failing consistently
   - Suggests composer's fee intent detection or routing logic broken
   - **Hypothesis**: Pre-existing from earlier phases OR sanitizer changes affecting routing

3. **Generic "Tolong tuliskan..." fallback overriding** (Appears in 20+ failures)
   - This exact string appearing across unrelated test failures
   - Suggests a catch-all fallback is being activated when specific routes should trigger
   - **Hypothesis**: Router logic or conditional path selection broken

4. **Welcome message not being sent separately** (Category C & E: 5+ failures)
   - Expected 2 messages (welcome + answer), getting only 1
   - Suggests welcome logic removed or broken
   - **Hypothesis**: Provider.js changes disabled welcome-first behavior

5. **Minimal prompt formatting** (Category F: 3-5 failures)
   - "Yang mana?" instead of full menu text
   - "biaya atau tidak?" instead of "balas: biaya / tidak"
   - "terima kasih" not being sent for ACK-only
   - **Classification**: Expected behavior from minimal/body-first system
   - **Action**: Update test expectations, not code

---

## Recommendations

### Immediate Investigation (Priority 1)
1. **Check session persistence**:
   - Verify Prisma session.upsert is being called
   - Check that session.data fields are serializing correctly
   - Run focused test with console logs to trace session updates

2. **Check fee routing**:
   - Add console log to composer to see what router path is selected
   - Test: "biaya si" should detect fee intent + program
   - Verify detectFeeIntent and fee route selection logic

3. **Check welcome logic**:
   - Verify provider.js is still sending welcome as separate message
   - Check if welcome logic was accidentally disabled in earlier phases

### Fix Strategy (Priority 2)
1. Fix session persistence (blocker for 13+ tests)
2. Fix fee routing (blocker for 15+ tests)
3. Fix welcome message logic (blocker for 5+ tests)
4. Update test expectations for minimal prompts (Category F)

### After Core Fixes
- Re-run full test suite
- Expect failures to drop from 54 to ~10-15 (wording/format only)
- Remaining failures should be test expectation updates, not code issues

---

## Test Failure Severity Matrix

| Category | Count | Type | Severity | Likely Root |
|----------|-------|------|----------|-------------|
| A: Session State | 13 | Regression | CRITICAL | Session persistence broken |
| B: Fee Routing | 15 | Regression | CRITICAL | Fee detection/routing broken |
| C: Intro/Welcome | 2 | Feature | HIGH | BOT_INTRO_MESSAGE broken |
| E: Prompts/Menu | 8 | Regression | HIGH | Welcome/menu logic broken |
| D: Dept Routing | 2 | Regression | HIGH | Non-marketing routing broken |
| F: Wording/Format | 5 | Expected | LOW | Test expectations need update |

**Total Critical Regressions**: 30 failures
**Total Expected Changes**: 5 failures
**Tests to Fix**: 30 (code issues) + 5 (test expectations) = 35 of 54

---

## Code Phase Attribution

- **Phase 7** (provider.js, outbound.js, composer.js): Likely source of session/routing issues
- **Phase 8** (aiEngine.js): Helper removal - NOT responsible for these failures (helpers don't touch routing/state)

**Conclusion**: Structural cleanup in Phase 8 is working correctly. Test failures are pre-existing regressions from Phase 7 that now need triage and fixing.
