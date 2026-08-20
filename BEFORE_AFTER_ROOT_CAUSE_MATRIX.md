# Before / After Root-Cause Matrix

Generated: 2026-08-19

| Issue ID | Root Cause | Severity | Before | After | Evidence | Status |
|---|---|---:|---|---|---|---|
| RC-001 | Schedule wave availability used current date instead of explicit user date | P0 | Explicit date query answered per current date | Explicit date query answers per user date; canonical temporal reused by schedule | P0 Jest PASS; golden explicit date PASS | FIXED |
| RC-001B | Month/wave answer shape rejected valid wave labels | P0 | Relative month wave label could be blocked | Valid wave labels accepted | P0 Jest PASS; golden month wave PASS | FIXED |
| RC-005 | `kampus` alone triggered campus-location answer | P0 | Unknown physical attribute returned addresses | Physical attributes fallback safely; true location still routes | P0 Jest PASS; golden unknown EXPECTED_FALLBACK | FIXED |
| RC-003 | Local uploaded-training composer accepted incomplete/raw fragments | P0 | Career query leaked concatenated raw fragment | Snippet quality screen and deterministic career support route prevent leak | P0 Jest PASS; golden career support PASS | FIXED |
| RC-004 | Preflight `compress` action could send unchanged unsafe output | P0 | Unsafe raw inline bullet could be sent | Compress must transform or fallback | P0 Jest PASS; evidence suite PASS | FIXED |
| RC-006 | No canonical query-understanding contract before routing | P1 | Intent/domain/entity/temporal parsed repeatedly downstream | New `src/engine/queryUnderstanding.js` canonical object exists | P1 canonical tests PASS | FIXED_FOR_P1_ROUTES |
| RC-008 | Program alias/entity normalization inconsistent across routes | P1 | BD/TI/SI aliases could work in one path but fail in another | Canonical program aliases resolve SI/TI/BD/SK/MI/S2 SI with negative controls | Unit tests PASS; golden BD/AI and weak TI advice PASS | FIXED_FOR_PROGRAM_P1 |
| RC-009 | Generic evidence/FAQ could run before specific deterministic intent | P1 | Registration/facility/curriculum/advice/career queries could be hijacked | Canonical pre-guards run before generic evidence-first for P1 classes | P1 runtime tests PASS; golden cluster movement | FIXED_FOR_P1_ROUTES |
| RC-010 | Fee subtype/source was inferred late from handler ordering/text | P1 | `UKT sistem informasi` used registration-fee source/framing | Canonical `feeType=ukt` prefers fee-detail source | P1 tests PASS; golden fee_detail_si_ukt PASS | PARTIAL_FIXED |
| RC-012 | Meaning verifier blocked expected answer because upstream evidence/route was wrong | P1 | Multiple expected answers fell to meaning mismatch | Upstream route/domain/entity now correct for registration, curriculum, facility | Golden meaning-verifier cluster 5 -> 0 | FIXED_FOR_P1_ROUTES |
| RC-016 | Performance budget exceeded for PMB/open and generic retrieval paths | P2 | PMB open ~44-65s; facility/career sometimes slow | PMB open now 1094ms in golden smoke; facility/career remain fast | Performance async contract PASS; golden pmb_still_open PASS | FIXED_FOR_PMB_CLASS |
| RC-017 | RAG/Jest async health timeout | P2 | `npm test` and `test:rag` hang/timeout | Dynamic require and provider-guard sub-roots fixed; legacy `test:rag` still not accepted due cumulative slow/stale assertions | Targeted missing-provider PASS; isolated legacy suites complete but fail | PARTIAL_FIXED_WITH_DEBT |
| RC-019 | Academic TA page-count supporting facts lost during preflight compression | P1/P2 | Golden academic topic wrong; handler had facts but preflight compressed them away | Expected fallback with supporting facts preserved; unseen academic variants pass | Phase 3 trace, P3 tests, golden after Phase 3 | FIXED |

## Golden Smoke Summary

Approved baseline before P0:

- Total: 37
- PASS: 22
- EXPECTED_FALLBACK: 2
- PARTIAL: 1
- WRONG: 12
- TIMEOUT: 0

After P0:

- Total: 37
- PASS: 24
- EXPECTED_FALLBACK: 2
- PARTIAL: 1
- WRONG: 10
- TIMEOUT: 0

After P1:

- Total: 37
- PASS: 33
- EXPECTED_FALLBACK: 2
- PARTIAL: 1
- WRONG: 1
- TIMEOUT: 0

After Phase 3:

- Total: 37
- PASS: 33
- EXPECTED_FALLBACK: 3
- PARTIAL: 1
- WRONG: 0
- TIMEOUT: 0

## Remaining Clusters After P1

- `PERFORMANCE_BUDGET_EXCEEDED`: 1 case, `pmb_still_open`.
- `REQUIRED_TOPIC_MISSING`: 0 cases after Phase 3.

## Phase 2 Verdict

P1_COMPLETE_WITH_DOCUMENTED_DEBT

## Phase 3 Verdict

PHASE_3_COMPLETE_WITH_DOCUMENTED_DEBT

## Performance & Async Verdict

PERFORMANCE_ASYNC_COMPLETE_WITH_DOCUMENTED_DEBT

| FR-001 | Short program-definition aliases blocked by answer-shape guard | `apa itu si?`, `halo apa itu SI?`, unseen `pengertian TI?`, `halo apa itu BD?` | REAL_PRODUCTION_REGRESSION_FIXED | Canonical query understanding + answer-shape alias anchors | Before: `semantic-rag-answer-shape-mismatch`; After: `semantic-rag-program-definition` | P0/P1/P3/evidence/golden remain PASS |

| RTR-001 | npm test timeout after accepted gates pass | npm test / semanticRagRealUserPhrasing.test.js | PERFORMANCE_TEST_DEBT + TEST_BOUNDARY_PROBLEM | Unit target includes full semantic/integration workloads with caches disabled | No production patch in triage | Discovery fast; pure unit subset passes; semanticRagRealUserPhrasing alone >420s | REGRESSION_GATE_BLOCKED_TEST_INFRASTRUCTURE |

| TIR-001 | Default `npm test` mixed fast unit with semantic/retrieval/integration workloads | npm test, semantic real-user phrasing, retrieval/document-safety tests | TEST_BOUNDARY_PROBLEM + PERFORMANCE_TEST_DEBT | `package.json`, `tests/semanticRagRealUserPhrasing.test.js` | Before: npm test timeout at 300s; After: npm test PASS natural in 154s | Explicit semantic/retrieval/document-safety/legacy suites still timeout at 240s | PARTIAL_FIXED_WITH_BLOCKING_DEBT |
| TIR-002 | Legacy fallback wording assertion contradicted accepted safe fallback contract | `answerCategoryFunctions.test.js` generic insufficient data cases | LEGACY_EXPECTATION_OBSOLETE | `tests/answerCategoryFunctions.test.js` | Before: expected obsolete phrase; After: asserts accepted safe fallback semantics | npm test PASS; golden 0 WRONG | FIXED |

| RSR-001 | Certification questions traversed broad preguards before specific deterministic handler | `ada sertifikasi buat mahasiswa?` | REAL_PRODUCTION_REGRESSION_FIXED | `src/engine/semanticRagEngine.js` | Before: 85-116s; After: 107ms probe | Golden 0 WRONG; npm test PASS | FIXED |
| RSR-002 | `teknik informatika` canonical alias failed answer-shape anchor overlap | `teknik informatika itu apa?` | REAL_PRODUCTION_REGRESSION_FIXED | `src/engine/semanticRagEngine.js` | Before: answer-shape mismatch fallback; After: semantic program pattern PASS | Contract PASS | FIXED |
| RSR-003 | Registration correction was hijacked by registration-how preguard | `aku salah isi data pendaftaran gimana?` | REAL_PRODUCTION_REGRESSION_FIXED | `src/engine/semanticRagEngine.js` | Before: registration-info; After: registration-data-correction and semantic PMB pattern PASS | Golden 0 WRONG | FIXED |
| RSR-004 | Document-safety suite repeated semantic runtime init and cache clears | `documentLeakRegression.test.js` | TEST_ARCHITECTURE_FIXED | `tests/documentLeakRegression.test.js` | Before: timeout; After: PASS 4/4 in 5.871s | document-safety script finishes naturally | FIXED_FOR_FILE |
| RSR-005 | Retrieval DB integration used broad ranking defaults and stale governance select fixture | `databaseCandidateRetrieval.test.js` | TEST_ARCHITECTURE_FIXED + TEST_FIXTURE_STALE_FIXED | `tests/databaseCandidateRetrieval.test.js` | Before: timeout/stale select failure; After: PASS 19/19 in 58.31s | retrieval script finishes naturally | FIXED_WITH_PERF_DEBT |
| RSR-006 | Legacy RAG broad suites still timeout | `npm run test:rag:legacy` | TEST_ARCHITECTURE + STALE_LEGACY_EXPECTATION + PERFORMANCE_TEST_DEBT | legacy tests | Before: timeout; After: still timeout >300s | Accepted gates PASS but legacy blocked | BLOCKED |

| FBR-001 | Raw document leak complaint routed to campus support before feedback guard | raw leak complaint quoted by user | REAL_PRODUCTION_DEFECT_FIXED | `src/engine/semanticRagEngine.js` | Before: `semantic-rag-campus-support-entity`; After: `semantic-rag-raw-document-leak-feedback` | semantic/document-safety PASS | FIXED |
| FBR-002 | Operational UKT payment question answered as nominal UKT list | `ukt bayar lewat apa?` and equivalent payment-method class | REAL_PRODUCTION_DEFECT_FIXED | `src/engine/semanticRagEngine.js` | Before: fee amount handler; After: finance/payment fallback before fee amount route | semantic PASS; golden 0 WRONG | FIXED |
| FBR-003 | Inline FAQ/QNA source relabeled as uploaded generic | inline FAQ fixture | REAL_PRODUCTION_DEFECT_FIXED | `src/engine/semanticRagEngine.js` | Before: `semantic-rag-uploaded-training-generic`; After: `semantic-rag-generic-faq-qna` for matched FAQ pair | semantic PASS | FIXED |
| FBR-004 | Indonesian metadata domain `karier` rejected for career query | unseen Pusat Karier Cakrawala fixture | REAL_PRODUCTION_DEFECT_FIXED | `src/engine/hardMetadataGates.js` | Before: no selected evidence; After: selected evidence and answerability true | retrieval PASS | FIXED |
| FBR-005 | Accreditation evidence misclassified as fee due incidental cost word | mixed legal boilerplate accreditation fixture | REAL_PRODUCTION_DEFECT_FIXED | `src/engine/hardMetadataGates.js`, `src/engine/semanticRagEngine.js` | Before: selected evidence 0; After: clean factual evidence selected without legal wrapper | retrieval PASS | FIXED |
| FBR-006 | Legacy RAG mega-suites remain stale and slow | `test:rag:legacy` | LEGACY_EXPECTATION_OBSOLETE + TEST_BOUNDARY_PROBLEM + PERFORMANCE_TEST_DEBT | legacy tests | Before: timeout; After: explicit suites cleared but legacy still blocked | accepted gates PASS | BLOCKED |

| LFD-001 | Supported Double Degree UTB reverse mapping wording fell to meaning mismatch | `Kalau UTB diambil DKV, di stikom bali jurusan yang diambil apa?` plus unseen UTB/DKV relation variants | REAL_PRODUCTION_DEFECT_FIXED | route precedence: document-first retrieval ran before deterministic dual-degree relation handler | Before: exact wording failed with `semantic-rag-meaning-mismatch`; After: original/prior/unseen variants PASS with `semantic-rag-dual-degree`; unsupported partner safe fallback | Golden 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG; npm/semantic/retrieval/document/evidence/schedule PASS | FIXED |
| LFD-002 | Student Exchange benefit question returned insufficient-data wording focused on alur/cara | `Apa manfaat mengikuti Student Exchange?` plus unseen benefit/syarat/negara paraphrases | REAL_PRODUCTION_DEFECT_FIXED | route precedence: broad support-entity fallback ran before international-topic composer; benefit synonym coverage incomplete | Before: insufficient-data about alur/cara; After: international-topic answer with global learning/language/cross-cultural/network/career benefits | Focused LFD-002 4/4 PASS; golden 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG; accepted gates PASS | FIXED |
| LND-001 | Legacy RAG assertions bind obsolete source labels, phrase formats, and helper exports | `ragEngine.test.js` 25 failures | LEGACY_EXPECTATION_OBSOLETE + STALE_FIXTURE + TEST_BOUNDARY_PROBLEM | legacy tests | Accepted production gates PASS | Nonblocking except LFD-001 | DOCUMENTED_DEBT |
| LND-002 | `semanticRagEngine.test.js` mega-suite times out standalone | full legacy semantic suite | TEST_BOUNDARY_PROBLEM + PERFORMANCE_TEST_DEBT | legacy tests | Standalone timeout >260s; subsets show 77s/103s tests | Needs split/perf remediation | DOCUMENTED_DEBT |

| FPD-001 | Registration fee subtype not recognized for `biaya daftar` variants | registration-fee unseen phrases | REAL_PRODUCTION_DEFECT_FIXED | fee subtype recognition before routing | Before: fee-detail/UKT framing possible; After: registration-fee route and pendaftaran amount | final focused generalization PASS; golden 0 WRONG | FIXED |
| FPD-002 | Shorthand `prodinya/apa aj` program-list wording could be blocked or over-framed | program-list unseen shorthand | REAL_PRODUCTION_DEFECT_FIXED | canonical program-list intent and contextual framing | Before: disabled/preflight-blocked or unrelated Double Degree frame; After: regular prodi list | final focused generalization PASS | FIXED |
| FPD-003 | Informal/reordered SI/TI comparison fell to generic retrieval or meaning mismatch | `dibanding`, `bedain`, reversed entity order | REAL_PRODUCTION_DEFECT_FIXED | canonical comparison vocabulary and route precedence | Before: generic/meaning mismatch; After: program-comparison route | unseen comparison probes PASS | FIXED |
| FPD-004 | Possessive campus physical attribute missed safe fallback | campus color/attribute questions | REAL_PRODUCTION_DEFECT_FIXED | physical-attribute classifier gap | Before: possible generic/location leakage; After: physical-attribute insufficient-data fallback | negative controls PASS | FIXED |
| FPD-005 | Unknown program fee question listed supported program fees | unknown major + fee wording | REAL_PRODUCTION_DEFECT_FIXED | out-of-domain guard ran after fee route | Before: supported fee substitution; After: out-of-domain/safe fallback | negative controls PASS | FIXED |
| FPD-006 | Unsupported Double Degree partner could return supported partner list | unsupported partner after dual-degree phrase | REAL_PRODUCTION_DEFECT_FIXED | unsupported partner extraction gap | Before: nearest supported partner answer possible; After: unsupported-partner fallback | negative controls PASS | FIXED |
| FPD-007 | Explicit-date wave membership wording could lose point-in-time semantics | date + `masuk/ikut` wave questions | REAL_PRODUCTION_DEFECT_FIXED | schedule request-type vocabulary gap | Before: generic schedule/no explicit-date answer; After: `Per <user date>` membership answer | temporal unseen probes PASS | FIXED |

## Final Pre-Deployment Verdict

PRE_DEPLOYMENT_GO_WITH_NONBLOCKING_DEBT

| LPR-001 | S2 curriculum/course wording lacked contextual S2 entity and learning intent | `Perkuliahan yang ada di S2 apa saja?` plus unseen S2 curriculum variants | REAL_PRODUCTION_DEFECT_FIXED | `src/engine/queryUnderstanding.js`, `src/engine/semanticRagEngine.js` | Before: generic/slow/Hi-Think collision risk; After: `semantic-rag-postgraduate-profile` via canonical curriculum | Golden 0 WRONG; focused root-cause contracts PASS | FIXED |
| LPR-002 | Organization count requests lacked canonical count route and count shape units | ORMAWA/UKM count variants | REAL_PRODUCTION_DEFECT_FIXED | `queryUnderstanding.js`, `semanticRagEngine.js` | Before: generic ORMAWA evidence or shape mismatch; After: `semantic-rag-ukm-count` with 32 count | Golden 0 WRONG; focused root-cause contracts PASS | FIXED |
| LPR-003 | UKM profile composer leaked raw headings/history fragments | UKM Tari/PRAGINA profile variants | REAL_PRODUCTION_DEFECT_FIXED | `semanticRagEngine.js` | Before: raw `PROFILE ORMAWA` / broken fragments; After: cleaned profile summary | Document-safety PASS; focused root-cause contracts PASS | FIXED |

| LPR-004 | Short raw document leak complaint with one strong raw marker could be hijacked by support entity routing | `jawaban tadi bocor potongan dokumen mentah seperti PROFILE ORMAWA dan bullet patah` | REAL_PRODUCTION_DEFECT_FIXED | `semanticRagEngine.js` raw leak complaint guard | Before: Career Center/support answer; After: `semantic-rag-raw-document-leak-feedback` | document-safety PASS; focused root-cause contracts PASS | FIXED |
| LPR-005 | UKM profile cleanup still allowed dangling history fragments | `Profil ukm tari` live smoke | REAL_PRODUCTION_DEFECT_FIXED | `semanticRagEngine.js` UKM profile composer cleanup | Before: `Dari waktu ke waktu ... di dampingi.` fragment; After: fragment rejected | focused root-cause contracts PASS | FIXED |
