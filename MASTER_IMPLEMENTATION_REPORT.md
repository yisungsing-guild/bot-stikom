# Master Implementation Report

Generated: 2026-08-19

## Current Status

Implementation status: **Phase 3 completed with documented debt**.

P0 remains approved with verdict `P0_COMPLETE_WITH_PREEXISTING_NONBLOCKING_DEBT`. Phase 2 was then implemented after approval. The system now has a canonical query-understanding layer and major P1 routes consume canonical meaning before generic retrieval.

Stopping point: Phase 3 validation completed. No deployment was performed. Performance/async work was not started.

## Phase Results

| Phase | Status | Notes |
|---|---|---|
| Phase 1 - P0 correctness and safety | COMPLETED | Temporal contract, location routing contract, evidence/preflight safety implemented and tested. |
| Phase 1B - Regression timeout root-cause investigation | COMPLETED | RAG/default suite timeout classified as pre-existing async/performance debt. |
| Phase 2 - Canonical query understanding | COMPLETED_WITH_DOCUMENTED_DEBT | Canonical object, centralized aliases, intent/domain separation, routing precedence for P1 clusters. |
| Phase 3 - Academic correctness / domain-aware retrieval boundary | COMPLETED_WITH_DOCUMENTED_DEBT | Academic thesis/page-count fallback now preserves supporting facts; source support verified; broad retrieval ranking deferred. |
| Phase 4 - Routing responsibility & precedence | PARTIAL | Major P1 precedence fixed; legacy raw reparsing remains. |
| Phase 5 - Domain-aware retrieval | NOT STARTED | Retrieval metadata/scoring still later-phase work. |
| Phase 6 - Answerability contract | NOT STARTED | Verifier was not weakened; answerability improvements deferred. |
| Phase 7 - Fee subtype metadata | PARTIAL | Canonical feeType now influences handler/source; full structured fee metadata deferred. |
| Phase 8 - Conversation resolution | NOT STARTED | Multi-turn canonical state remains later-phase. |
| Phase 9 - Performance/async | NOT STARTED | RC-016/RC-017 still open; some P1 route latency improved by avoiding generic retrieval. |
| Phase 10 - Observability contract | NOT STARTED | Canonical object exists, but debug exposure remains limited. |
| Phase 11 - Unseen query generalization | PARTIAL | P1 unseen set added and passed for implemented classes. |
| Phase 12 - Regression gate | PARTIAL | P0/evidence/P1/golden gates run; npm test and test:rag still timeout due pre-existing debt. |

## Root Causes Addressed

P0:

- RC-001: schedule explicit/relative/current reference date contract.
- RC-005: location routing contract.
- RC-003 / RC-004: evidence quality and preflight safety.

P1:

- RC-006 / RC-008 / RC-009 / RC-010 / RC-012: canonical query understanding, centralized program aliases, intent/domain separation, routing precedence before generic retrieval.
- Fee subtype route/source mismatch improved through canonical `feeType`.
- Program advice entity preservation improved through canonical program entity.
- Facility/career support drift improved through canonical domain route precedence.

## Files Changed In Phase 2

- `src/engine/queryUnderstanding.js`
- `src/engine/semanticRagEngine.js`
- `tests/queryUnderstanding.canonical.test.js`
- `tests/semanticRagEngine.p1CanonicalContracts.test.js`
- `PHASE_2_QUERY_UNDERSTANDING_AUDIT.md`
- `PHASE_2_CANONICAL_QUERY_IMPLEMENTATION.md`
- `PHASE_2_ROUTING_PRECEDENCE_MATRIX.md`
- `PHASE_2_UNSEEN_GENERALIZATION_REPORT.md`
- `PHASE_2_BEFORE_AFTER_MATRIX.md`
- `BEFORE_AFTER_ROOT_CAUSE_MATRIX.md`
- `MASTER_IMPLEMENTATION_REPORT.md`

Note: the worktree already contained unrelated modified/untracked files before this phase. They were not reverted.

## Validation

- P1 canonical/runtime gate: PASS, 13/13 combined run after Phase 3 added one canonical academic assertion.
- P0 contract tests: PASS, 10/10.
- Evidence/preflight regression: PASS, 56/56 after Phase 3 added one preflight academic preservation test.
- Golden smoke after P1: 37 total, 33 PASS, 2 EXPECTED_FALLBACK, 1 PARTIAL, 1 WRONG, 0 TIMEOUT.
- Golden smoke after Phase 3: 37 total, 33 PASS, 3 EXPECTED_FALLBACK, 1 PARTIAL, 0 WRONG, 0 TIMEOUT, ok true.
- `npm test`: TIMEOUT at 240s, pre-existing RC-017 debt remains.
- `npm run test:rag`: TIMEOUT at 240s, pre-existing RC-017 debt remains.

## Golden Smoke Movement

P0 baseline:

- PASS: 24
- EXPECTED_FALLBACK: 2
- PARTIAL: 1
- WRONG: 10

After P1:

- PASS: 33
- EXPECTED_FALLBACK: 2
- PARTIAL: 1
- WRONG: 1

Remaining:

- `PERFORMANCE_BUDGET_EXCEEDED`: `pmb_still_open`.
- `REQUIRED_TOPIC_MISSING`: fixed for `academic_ta_pages`.

## Architectural Answers

1. Does one canonical query object now exist? **Yes**.
2. Do major routes consume it? **Yes for P1 routes**: schedule temporal, registration, fee subtype, curriculum, advice, facility, career, location/physical attribute.
3. Is alias normalization centralized? **Partially yes**: program aliases are centralized for canonical routes; legacy parsers remain.
4. Is temporal interpretation centralized/reused? **Partially yes**: canonical temporal exists and schedule consumes it; legacy temporal helpers remain for fallback compatibility.
5. Are intent and entity separated? **Yes in canonical object**.
6. Are unknown entities preserved as unknown? **Yes for canonical program matching; no arbitrary fuzzy mapping into programs**.
7. Are downstream modules still independently reparsing raw query? **Yes**. Deferred: fee internals, generic/fine intent helpers, campus support entity finder, deterministic fallbacks, multi-turn resolver, retrieval/generic FAQ.
8. Were exact golden-query hardcodes introduced? **No**.

## Recommendation Before Next Phase

Proceed only after review. Recommended next work:

- Migrate more downstream handlers to consume canonical meaning instead of raw reparsing.
- Address RC-017 async/open-handle/test timeout debt.
- Add structured fee metadata in Phase 7.
- Build conversation-resolution canonical state in Phase 8.
- Keep verifier strict; do not weaken it to increase pass rate.

## Phase 2 Verdict

P1_COMPLETE_WITH_DOCUMENTED_DEBT

## Phase 3 Verdict

PHASE_3_COMPLETE_WITH_DOCUMENTED_DEBT

## Performance & Async Remediation

Scope:

- pmb_still_open performance debt.
- RC-017 async/test timeout debt.

Implemented:

- Canonical PMB schedule preguard before document-first uploaded-training retrieval.
- Top-level deduplicateEvidence import to remove a late dynamic require in retrieval.
- Provider availability guard now follows getClient() for short ambiguous no-provider program amount questions.
- Added tests/semanticRagEngine.performanceAsyncContracts.test.js.

Validation:

- New performance/async contracts: PASS, 6/6.
- P0 contracts: PASS, 10/10.
- P1 canonical runtime contracts: PASS, 6/6.
- P1 canonical unit contracts: PASS, 7/7.
- Phase 3 academic contracts: PASS, 4/4.
- Evidence suite: PASS, 56/56.
- Golden smoke: PASS overall, 37 total, 34 PASS, 3 EXPECTED_FALLBACK, 0 WRONG; pmb_still_open 1094ms.
- Targeted missing-provider test: PASS.

Still open:

- npm run test:rag is not yet an accepted gate. Isolated semanticRagEngine.test.js and ragEngine.test.js complete naturally but fail many legacy assertions against current accepted P0-P3 behavior, and cumulative runtime remains very high.
- npm test timed out at the command evaluation boundary and remains unresolved.

Verdict:

PERFORMANCE_ASYNC_COMPLETE_WITH_DOCUMENTED_DEBT

## Final Regression & Legacy Test Reconciliation

Status: REGRESSION_GATE_BLOCKED_WITH_ROOT_CAUSE

A targeted production regression was fixed for short canonical program definitions. All accepted P0/P1/Phase 3/evidence/performance/golden gates remained passing after the fix. Legacy RAG suites remain blocked: ragEngine.test.js has 25 failures, semanticRagEngine.test.js has 48 failures, and npm test times out at 300s because integration/semantic workloads remain inside the unit suite. See FINAL_REGRESSION_ROOT_CAUSE_AUDIT.md, LEGACY_TEST_RECONCILIATION_MATRIX.md, and FINAL_REGRESSION_VALIDATION.md.

## Targeted Remaining Regression Root-Cause Triage

Status: REGRESSION_GATE_BLOCKED_TEST_INFRASTRUCTURE

No production behavior or legacy assertions were changed in this triage phase. Remaining failures were clustered across obsolete expectations, stale fixtures, test-boundary problems, performance test debt, nondeterministic greeting expectations, and real production regression candidates. Accepted gates remain stable: golden 0 WRONG and pmb_still_open about 1108ms. npm test remains blocked because semantic/integration workloads are included in the unit target; semanticRagRealUserPhrasing.test.js did not finish within 420s by itself.

## Test Infrastructure Remediation

Status: TEST_INFRASTRUCTURE_BLOCKED

No production behavior was changed in this remediation phase. The default regression gate was repaired by separating fast unit/contract tests from semantic, retrieval, document-safety, schedule, and legacy RAG suites. `npm test` now completes naturally: unit 36 suites/330 tests in 37.863s, contract 10 suites/94 tests in 108.843s. Evidence remains PASS 56/56, schedule remains PASS 12/12, and golden smoke remains 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG with `pmb_still_open` at 2050ms.

One legacy assertion was reconciled: `answerCategoryFunctions.test.js` now asserts the accepted safe fallback text instead of the obsolete `tidak mempunyai jawaban yang mencukupi` phrase. `genericEvidenceRetrieval.test.js` was removed from the fast unit target and kept in the explicit retrieval suite.

Remaining blocked explicit suites: `test:semantic`, `test:retrieval`, `test:document-safety`, and `test:rag:legacy` each timed out at 240s. These remain test-infrastructure/legacy/semantic debt and were not hidden by `forceExit`, skipping, or timeout inflation.

## Remaining Semantic/Retrieval Suite Root-Cause Remediation

Status: REMAINING_TEST_GATES_BLOCKED

This phase converted several blocked suites from timeout into natural completion. `test:semantic`, `test:retrieval`, and `test:document-safety` now finish naturally, but still expose assertion failures that require contract or production review. Production fixes were limited to proven root causes: early certification routing, `teknik informatika` answer-shape aliasing, registration data-correction precedence, and LLC language-practice surface forms. Accepted gates remained stable: npm test PASS, evidence 56/56 PASS, schedule 12/12 PASS, golden 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG, and pmb_still_open 1195ms.

The phase remains blocked because `npm run test:rag:legacy` still times out after 300s, and candidate production defects remain in UKT payment routing and generic unseen entity retrieval.

## Final Blocker Remediation Before Pre-Deployment Audit

Status: FINAL_BLOCKERS_REMAIN

The seven explicit assertion blockers in semantic, retrieval, and document-safety suites were traced and remediated at root-cause level. `test:semantic`, `test:retrieval`, and `test:document-safety` now finish naturally with 0 failures. Accepted gates remained stable: `npm test` PASS, evidence 56/56 PASS, schedule 12/12 PASS, golden 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG, and `pmb_still_open` 1164ms.

`test:rag:legacy` remains blocked. Small legacy files pass, `ragEngine.test.js` finishes with 25 failures, and `semanticRagEngine.test.js` still times out standalone above 260s. This was classified as legacy expectation/test-boundary/performance debt with possible candidate production debts that require a separately scoped phase. No deployment was performed.

## Legacy Final Classification Before Pre-Deployment Audit

Status: LEGACY_GATE_BLOCKED_REAL_PRODUCTION_DEFECT

No production code or tests were changed in this classification phase. Remaining legacy failures were classified against the accepted production gates. Most `ragEngine.test.js` failures are obsolete legacy source/format/helper-boundary expectations. `semanticRagEngine.test.js` remains a test-boundary and performance debt mega-suite, but it surfaced one proven production defect: supported Double Degree UTB reverse-mapping wording (`UTB diambil DKV`) falls to meaning mismatch while an equivalent paraphrase succeeds. Pre-deployment audit should wait until that defect is fixed and validated.

## Dual-Degree Unseen Phrasing Remediation - 2026-08-20

Status: DUAL_DEGREE_PRODUCTION_DEFECT_FIXED

Fixed LFD-001 without query-specific hardcode. Root cause was route precedence: a supported UTB/DKV reverse-pair question could be answered by `tryDualDegreeAnswer`, but document-first uploaded-training retrieval ran first for the unseen wording and ended in `semantic-rag-meaning-mismatch`. The fix places unsupported partner guard and DNUI/HELP international topic handling before the general dual-degree pair handler, then runs the general dual-degree pair handler before document-first retrieval.

Reports created:

- `DUAL_DEGREE_ROOT_CAUSE_TRACE.md`
- `DUAL_DEGREE_GENERALIZATION_TEST.md`
- `DUAL_DEGREE_REMEDIATION_REPORT.md`
- `DUAL_DEGREE_BEFORE_AFTER_MATRIX.md`

Validation:

- dual-degree generalization test: 4/4 PASS
- npm test: PASS natural, unit 330/330 and contract 94/94
- semantic: 13/13 PASS
- retrieval: 110/110 PASS
- document-safety: 6/6 PASS
- evidence: 56/56 PASS
- schedule: 12/12 PASS
- golden smoke: 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG
- pmb_still_open: 1043ms in final smoke

No deployment performed.

## LFD-002 Student Exchange Remediation - 2026-08-20

Status: LFD_002_PRODUCTION_DEFECT_FIXED

Fixed Student Exchange benefit/subtopic routing without query-specific hardcode. Source support was verified in the existing international topic composer and Student Exchange FAQ fixtures. Root cause was route precedence: broad campus-support entity fallback ran before international-topic composer and returned an alur/cara insufficient-data answer for supported benefit questions. The fix moves international subtopic handling before generic support entity routing and extends benefit vocabulary generally (`manfaatnya`, `keuntungan`, `benefit`, `dapat apa`) with guarded shorthand `exchange` handling.

Report created:

- `LFD_002_STUDENT_EXCHANGE_REMEDIATION_REPORT.md`

Validation:

- focused LFD-002 test: 4/4 PASS
- dual-degree focused regression: 4/4 PASS
- npm test: PASS natural, unit 330/330 and contract 94/94
- semantic: 13/13 PASS
- retrieval: 110/110 PASS
- document-safety: 6/6 PASS
- evidence: 56/56 PASS
- schedule: 12/12 PASS
- golden smoke: 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG
- pmb_still_open: 1034ms in final smoke

No deployment performed.

## Final Pre-Deployment Generalization Audit - 2026-08-20

Status: PRE_DEPLOYMENT_GO_WITH_NONBLOCKING_DEBT

The final audit exercised 40 unseen/adversarial production queries across PMB, schedule/date, registration, fees, programs, comparison, curriculum, advice, accreditation, scholarship, facilities, support services, UKM, academic, foreign-student admin, Double Degree, Student Exchange, Hi-Think, location, small talk, unknown/out-of-domain, and cross-domain negative controls.

Root-cause fixes were applied only for proven production defects discovered by the audit:

- registration-fee subtype recognition for `biaya daftar` class
- shorthand program-list canonicalization and contextual program-list framing
- informal/reordered program-comparison routing
- possessive campus physical-attribute fallback
- unknown-program fee out-of-domain guard before fee routing
- unsupported Double Degree partner detection
- explicit-date wave membership request-type handling

Reports created:

- `FINAL_PRE_DEPLOYMENT_GENERALIZATION_AUDIT.md`
- `UNSEEN_QUERY_COVERAGE_MATRIX.md`
- `ROUTING_PRECEDENCE_COLLISION_AUDIT.md`
- `SOURCE_ANSWERABILITY_COVERAGE.md`
- `CROSS_DOMAIN_NEGATIVE_CONTROL_REPORT.md`
- `FINAL_PRODUCTION_DEFECT_MATRIX.md`
- `PRE_DEPLOYMENT_GO_NO_GO_REPORT.md`

Validation:

- final unseen/adversarial probe: 40/40 PASS
- final focused generalization test: 6/6 PASS
- npm test: PASS natural, unit 330/330 and contract 94/94
- semantic: 13/13 PASS
- retrieval: 110/110 PASS
- document-safety: 6/6 PASS
- evidence: 56/56 PASS
- schedule: 12/12 PASS
- P0/P1/P3/performance focused contracts: 33/33 PASS
- LFD-001/LFD-002/final focused tests: 14/14 PASS
- golden smoke: 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG
- pmb_still_open: 1042ms in golden smoke, 1752ms direct no-cache probe

No high-confidence production correctness or safety defect remains open. Nonblocking debt remains for a slow typo-heavy foreign/admin query path, one non-fatal verifier-blocked stream log, and already documented legacy expectation debt.

No deployment performed.

## Final Deployment Readiness Check - 2026-08-20

Status: DEPLOYMENT_BLOCKED

No deployment was performed and no production behavior was changed. Runtime readiness checks passed: `npm run build` exit 0, production dependency tree audit exit 0, production-equivalent startup on local port 4577 returned HTTP 200 and was stopped cleanly, production-mode RAG health returned `ok: true`, and golden smoke remained 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG with `pmb_still_open` at 1055ms.

The phase is blocked by artifact integrity, not bot correctness. `src/engine/queryUnderstanding.js` is still untracked, and several production files remain modified in the working tree. If deployment builds from git/remote, the deployed artifact may miss the canonical query layer and other remediation changes that passed validation. In addition, `src/data/rag_index.json` is ignored by git while the validated runtime uses that local index by default; deployment must either include the validated index artifact or rebuild/sync the RAG index before traffic.

Reports created:

- `FINAL_DEPLOYMENT_READINESS_REPORT.md`
- `PRODUCTION_CONFIG_PARITY_AUDIT.md`
- `PRODUCTION_RAG_SOURCE_READINESS.md`
- `DEPLOYMENT_AND_ROLLBACK_PLAN.md`
- `POST_DEPLOYMENT_SMOKE_PLAN.md`

No high-confidence production correctness or safety defect was found. Required before deployment: commit/include exact production code state, decide RAG index artifact strategy, rerun minimal golden/RAG health/startup gates, then execute the deployment plan only after explicit approval.

## Final Artifact Integrity Remediation - 2026-08-20

Status: READY_FOR_DEPLOYMENT_WITH_NONBLOCKING_DEBT

No deployment was performed and no production routing/retrieval behavior was changed. The previous deployment blocker was resolved by defining the release candidate as the current validated Docker/workspace build context, not a remote git-only checkout. This artifact strategy includes untracked-but-required production code such as `src/engine/queryUnderstanding.js` and includes the validated `src/data/rag_index.json` RAG index. `.dockerignore` was updated as packaging-only remediation to exclude tests, tmp, audit reports, logs, and local artifact folders while continuing to exclude `.env` files and `node_modules`.

RAG index strategy: include the validated local RAG index in the deployable artifact for this release. If a future deployment must use remote git-only source, the exact code state must be committed and the RAG index must either be included or rebuilt/synced before traffic.

Reports created:

- `FINAL_ARTIFACT_INTEGRITY_REPORT.md`
- `DEPLOYABLE_FILE_MANIFEST.md`
- `RAG_INDEX_DEPLOYMENT_STRATEGY.md`
- `FINAL_RELEASE_CANDIDATE_VALIDATION.md`

Final validation after artifact strategy:

- `npm run build`: PASS
- production-equivalent startup on local port 4579: PASS, HTTP 200, process stopped
- `NODE_ENV=production npm run rag:health:json`: PASS, `ok: true`
- golden smoke: 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG
- `pmb_still_open`: 1121ms

Nonblocking debt: remote git-only deployment still requires commit/include parity, RAG index has documented source hygiene debt, and Procfile uses `npm start` with 2048 MB heap while Docker uses `npm run start:prod` with 4096 MB heap. Recommended runner for this release candidate is Docker/start:prod.

No deployment performed.

## Controlled Production Deployment Attempt - 2026-08-20

Status: DEPLOYMENT_BLOCKED_BY_AUTH

No deployment was performed and no rollback was needed. Pre-deploy artifact checks passed: `src/data/rag_index.json` exists and matches SHA256 `FA21B6D8ECC7B1F352DE34E28E77D757F77F808DBE0A9707E6466E27281DC0B9`, required production files from the manifest exist, `.dockerignore` excludes env secrets and local test/debug artifacts, and Docker/start:prod remains the preferred runner.

Railway CLI is installed, but `railway status` returned `Unauthorized. Please run railway login again.` Because the production target could not be authenticated, the deployment and post-deployment production validation were not executed. Report created: `POST_DEPLOYMENT_VALIDATION_REPORT.md`.

Next required action: authenticate Railway or provide an authenticated deployment target, then deploy the validated Docker/workspace artifact and run the post-deployment smoke plan.

## Railway Deployment Parity Attempt - 2026-08-20

Status: DEPLOYMENT_VALIDATION_BLOCKED_BY_SMOKE_ACCESS

The public GitHub release candidate was corrected to exclude `src/data/rag_index.json`. Commit `798cc08611c6c8d517428e8cc1c9283a21365546` was pushed and Railway deployed it successfully as deployment `2f38cb91-adbc-4307-99e0-b645086a9cec`. Required production code files are present in the Git commit, while the validated RAG index remains outside public Git and was uploaded privately to Railway volume `/data/rag_index.json`.

Runtime parity evidence: Railway logs show Docker/start:prod (`node --max-old-space-size=4096 src/index.js`), HTTP root and Fonnte webhook health returned 200, production env presence was verified without printing secrets, and semantic RAG prewarm changed from `indexSize=0` before upload to `indexSize=835` after volume upload/restart. The local validated index SHA remains `FA21B6D8ECC7B1F352DE34E28E77D757F77F808DBE0A9707E6466E27281DC0B9`.

Accepted release-candidate gates remained PASS after deployment parity work: `npm test`, semantic, retrieval, document-safety, evidence, schedule, focused LFD-001/LFD-002, final unseen/adversarial focused test, and golden smoke 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG with `pmb_still_open` at 1039ms.

Direct semantic smoke against the running Railway container was not completed because `railway ssh` command execution timed out repeatedly, and live webhook smoke was not sent because it would trigger outbound WhatsApp provider sends. Report updated: `POST_DEPLOYMENT_VALIDATION_REPORT.md`. No rollback was performed because no artifact/startup/health/gate failure was observed, but full production semantic validation remains gated on a safe non-sending runtime smoke path.

## Final Production Semantic Smoke - 2026-08-20

Status: DEPLOYED_VALIDATED

A protected non-sending endpoint was added and deployed at commit `18f8df4f857347bf28cb8c7b2703b0fecb0848aa` to call the live Railway container's `querySemanticRag` path directly without WhatsApp/Fonnte outbound sending. It was temporarily enabled with `SEMANTIC_SMOKE_TOKEN`, used for smoke, then disabled by setting the token to `disabled`; the endpoint now returns HTTP 404.

Production semantic smoke covered PMB current status, explicit-date schedule, registration how-to, registration fee, UKT, program list, SI/TI comparison, BD curriculum, academic SKS, facility, Career Center, Student Exchange benefit, UTB/DKV Double Degree, unsupported Double Degree partner, unknown program fee, physical-attribute fallback, raw-document leak complaint, and small talk. Validator result: 21/21 PASS, 0 WRONG, no raw evidence leak, no unsupported entity substitution, explicit date preserved, RAG index loaded (`indexSize=835`), PMB current status 1723ms.

Final active Railway deployment after disabling smoke token: `4195a08c-49fb-4b98-9659-2666bd3e4302`, commit `18f8df4f857347bf28cb8c7b2703b0fecb0848aa`, Dockerfile builder, volume `/data`, `start:prod`, and RAG prewarm `indexSize=835`. Report updated: `POST_DEPLOYMENT_VALIDATION_REPORT.md`.

## Live Production Root-Cause Remediation - 2026-08-20

Fixed three live production semantic defects without query hardcodes: S2 curriculum precedence, ORMAWA/UKM count requestType, and UKM profile fragment cleanup. Added focused unseen/negative contract coverage in `tests/semanticRagEngine.liveProductionRootCauseContracts.test.js`. Local gates remain PASS: golden 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG, semantic 13/13, retrieval 110/110, document-safety 6/6, evidence 56/56, schedule 12/12, npm test natural PASS.

### Production Smoke Follow-Up Safety Patch

Initial production smoke of `1480ddf` found two remaining safety/output issues in the same raw-leak/profile-cleanup class. Added general short raw-leak complaint marker detection and stricter UKM profile dangling-fragment filtering. Local gates after patch remain PASS: focused root-cause/raw-leak 6/6, golden 0 WRONG, semantic 13/13, retrieval 110/110, document-safety 6/6, evidence 56/56, npm test natural PASS.
