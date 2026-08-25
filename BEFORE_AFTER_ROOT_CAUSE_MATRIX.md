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
| LPR-006 | Provider/LLM meaning verifier falsely rejected trusted deterministic schedule-window answers | explicit-date schedule smoke variants | REAL_PRODUCTION_DEFECT_FIXED | `semanticRagEngine.js` final verifier guard | Before: live provider path returned `semantic-rag-meaning-verifier-blocked`; After: deterministic schedule-window answers with concrete date/period are protected without weakening generic verifier | focused live/P0 PASS; golden 0 WRONG | FIXED |

| SCG-001 | Canonical program-definition aliases were not trusted by production verifier | `informatika itu jurusan apa?`, `jurusan informatika ada?`, recognized program definition/existence/profile variants | REAL_PRODUCTION_DEFECT_FIXED | `src/engine/semanticRagEngine.js` | Before: deterministic `semantic-rag-program-definition` could be blocked by LLM verifier; After: structured-safe verifier trusts canonical alias equivalence for safe program-definition answers | Focused 14/14, 44 unseen PASS, golden 0 WRONG, live smoke 30/30 PASS | FIXED |
| SCG-002 | System-wide semantic/output contracts were inconsistently propagated across production paths | program definition, comparison, relation pairing, institution profile, temporal point, UKM count/profile, generic RAG safety | SYSTEMIC_CONTRACT_FIXED | `queryUnderstanding`, `semanticRagEngine`, deterministic composers/verifier/preflight contracts | Before: broad/generic routes or verifier could beat supported specific meanings; After: specific requestTypes and structured-safe output contracts validated across supported domains | SYSTEM_WIDE_CONTRACT_CONSISTENCY_AUDIT.md; live smoke 30/30 | FIXED |

| KCR-001 | Source-to-answer knowledge coverage remains incomplete for several source-present classes | Student Exchange definition, institution history, FORM IKU, S2 SKS, remedial, yudisium | PARTIAL_REMEDIATION_WITH_GAPS | queryUnderstanding, feeComparisonEngine, semanticRagEngine | Entity role and alias protection improved; broad route/source retrieval gaps remain | Golden 0 WRONG; evidence/document-safety/focused contracts PASS | OPEN |
| KCR-002 | Organization/profile entity role protection | Unknown UKM and UKM Tari profile classes | PARTIAL_FIXED | queryUnderstanding, semanticRagEngine | Unknown organization no longer substitutes unrelated entity; UKM Tari primary evidence is PRAGINA | Focused probes | PARTIAL_FIXED |
| KCR-003 | D3 Manajemen Informatika fee alias collision | D3 MI fee questions | FIXED | feeComparisonEngine, queryUnderstanding | MI/D3 alias wins before broad informatika/TI alias | Focused probe | FIXED |


| KCR-004 | Student Exchange definition/profile was hijacked by generic Double Degree route | Student Exchange definition/profile variants | FIXED | semanticRagEngine route precedence | Before: semantic-rag-dual-degree; After: existing semantic-rag-known-faq-qna preguard before Double Degree | Golden 0 WRONG; focused contracts PASS | FIXED |
| KCR-005 | Partner-only DKV short definition preempted UTB/DKV relation-pairing | UTB/DKV/STIKOM relation variants and regular DKV negative | FIXED | semanticRagEngine short-definition gating | Relation-pairing now outranks DKV definition; regular STIKOM DKV existence does not answer as regular program | Dual-degree focused contracts PASS | FIXED |
| KCR-006 | Remaining source-present knowledge gaps require broader source-to-answer contracts | FORM IKU, institution history, S2/remedial/yudisium, DNUI sequence, accreditation validity, unsupported policy negative | OPEN | canonical/requestType, retrieval/evidence, composer/preflight | Source-present facts are found in several cases but not safely summarized/preserved | Source-derived probe saved in tmp/kcr_remaining_probe_output.jsonl | OPEN |


| KCR-007 | System-wide source-derived generalization still exposes broad source-to-answer contract gaps | 39 source-derived cases across fee, institution, academic, international, organization, facility, cross-domain, negative, short/ambiguous | OPEN | canonical/requestType, entity guards, generic RAG, composer/preflight | 23 PASS heuristic; non-pass gaps include unknown program fee, FORM IKU, history, S2/remedial/yudisium, unknown UKM, INBIS, academic-vs-PMB schedule, unsupported policy raw leak | Accepted gates remain PASS | OPEN |

| KCR-008 | Context-sensitive program alias disambiguation for legal/document contexts | `SK`, surat keputusan, izin operasional, nomor SK vs valid `prodi SK`/`Sistem Komputer` | FIXED | `src/engine/queryUnderstanding.js` | Short alias `SK` is suppressed in strong legal/document contexts unless explicit program context exists | Focused root-contract tests PASS; full gates PASS | FIXED |
| KCR-009 | Institution history/legal-document requests could be hijacked by broad program/schedule routes | founding date, SK/legal establishment, FORM IKU/document definition | FIXED | `src/engine/queryUnderstanding.js`, `src/engine/semanticRagEngine.js` | Canonical institution/document/history classes outrank broad PMB schedule/program interpretations | KCR probe PASS; source-derived 39 PASS heuristic/safe | FIXED |
| KCR-010 | Academic requested fields were not consistently routed through source-compatible academic retrieval | bibliography standard, page limit, thesis submission, yudisium, remedial calendar | FIXED | `queryUnderstanding.js`, `semanticRagEngine.js`, `tests/semanticRagEngine.performanceAsyncContracts.test.js` | `domain -> academicTopic -> requestedFields` preserved before generic fallback; obsolete test route-label assertion reconciled to accepted academic-source contract | Focused tests 27/27; contract 94/94; semantic/retrieval PASS | FIXED |
| KCR-011 | Unsupported/low-confidence entity-relation queries could enter expensive or unsafe generic paths | unsupported S3/programs, local dorm/facility, unsupported policy, external relation | FIXED | `semanticRagEngine.js`, `answerPreflightEvaluator.js` | Safe early containment when no compatible supporting proposition exists; structured bullets remain allowed while raw/OCR leak guard stays active | Blind #1 25/25; Blind #2 regression 30/30; source-derived negatives safe | FIXED |
| KCR-012 | International relation/requested-field classes could collide within same broad domain | Double Degree sequence, degree outcome, fee follow-up, partner relation | FIXED | `queryUnderstanding.js`, `semanticRagEngine.js` | Sequence/study-location, fee, degree outcome, relation pairing are separated in canonical routing before generic international answers | DNUI sequence, fee follow-up, partner relation probes PASS | FIXED |
| KCR-013 | Final clean blind validation still pending after remediation | Blind Holdout #2 is regression evidence, not clean blind proof | OPEN_NONBLOCKING_FOR_THIS_PHASE | process/freeze validation | Code now passes regression gates, but final clean holdout requires frozen code + Blind Holdout #3 | Verdict set to pending blind validation, not deployment readiness | OPEN |

| KCR-014 | International-program contrast has canonical support but no universal source-grounded comparison composer | Student Exchange vs Double Degree contrast/negation variants | OPEN | queryUnderstanding.js, semanticRagEngine.js | Before: degree-outcome wrong fact risk; After: canonical contrast recognized and safe fallback returned, but source-present comparison still not answered | Focused 27/27, golden 0 WRONG, contract 94/94 after canonical patch | OPEN |

| KCR-015 | Pre-Blind old 44-probe exposed release-impacting UKM/organization source-to-answer gaps | `ukm_count`, `ukm_profile` | REAL_PRODUCTION_DEFECT_FIXED | evidence compatibility, COUNT request routing, UKM/profile composer safety | Before: old 44-probe returned 40/44 with two valid production risks; After: old 44-probe 44/44 and UKM/organization focused contracts 11/11 | `PRE_BLIND_BLOCKER_REMEDIATION_REPORT.md`; Blind #3 still not executed | FIXED |
| KCR-016 | Old 44-probe contains stale nonblocking expectations after accepted architecture changes | `dual_degree_prior`, `unknown_program_fee` | NONBLOCKING_TEST_EVALUATOR_DEBT | old auxiliary probe evaluator | Runtime behavior is safe/source-grounded, but old probe expects obsolete source label or wording | `BLIND_HOLDOUT_3_RESULTS.md` | DOCUMENTED_DEBT |


| PBB-001 | Organization/UKM COUNT requests could select wrong-domain evidence or generic source routes | ORMAWA/UKM count and subset-count classes | REAL_PRODUCTION_DEFECT_FIXED | queryUnderstanding.js, semanticRagEngine.js | Before: COUNT could be satisfied by Hi-Think/international/generic evidence; After: count requires organization-family compatibility and uses validated UKM/ORMAWA collection evidence | focused 11/11; old 44 44/44; Blind #1 25/25; Blind #2 30/30 | FIXED |
| PBB-002 | UKM/organization PROFILE composer could emit raw/incomplete OCR/header fragments | UKM Tari/Tabuh/RADE/Teater profile class | REAL_PRODUCTION_DEFECT_FIXED | semanticRagEngine.js | Before: exact entity family could still leak raw profile headers/fragments; After: exact profile evidence is converted into clean descriptive propositions before common preflight | focused profile contracts; document-safety 6/6; Blind #2 profile cases PASS | FIXED |
| PBB-003 | Unsupported/open-world UKM entities could fall through to generic UKM list | UKM diving/paralayang/astronot negative controls | REAL_PRODUCTION_DEFECT_FIXED | queryUnderstanding.js, semanticRagEngine.js | Before: unsupported specific UKM could receive known-UKM list answer; After: unknown specific organization entity gets safe fallback without nearest-entity substitution | Blind #1/#2 negative controls PASS; fresh/source-derived probes PASS | FIXED |
| PBB-004 | HIMAPRODI/student-association questions could be handled by UKM-specific composer | HIMAPRODI SI/BD profile and vision classes | REAL_PRODUCTION_DEFECT_FIXED | semanticRagEngine.js | Before: student-association profile/vision could select unrelated UKM evidence; After: student associations use source-grounded entity evidence, not UKM profile composer | source-derived 39 PASS heuristic/safe; focused probes PASS | FIXED |
| PBB-005 | Full legacy provider webhook parity suite remains stale/async-heavy outside this remediation contract | 	ests/providerWebhook.test.js, 	ests/providerRouteRealFlow.test.js | TEST_BOUNDARY/PARITY_DEBT | provider test harness | Broad provider suite still fails on legacy greeting/menu/session expectations and async post-test logging; no failure traced to UKM COUNT/PROFILE production contracts | 
pm test PASS natural; production semantic/retrieval gates PASS; dedicated provider parity remains unresolved | OPEN_DEBT |


| PPR-001 | Provider reply-deadline fallback referenced undefined `meta` | Provider route real-flow timeout/fallback path | REAL_PRODUCTION_DEFECT_FIXED | `src/routes/provider.js` | Before: fallback send path could throw `meta is not defined`; After: explicit safe fallback metadata is passed to outbound send | Provider release parity PASS; full npm test unit 361/361 + contract 94/94 PASS | FIXED |
| PPR-002 | Short canonical program follow-up under fee context could be hijacked by UKM/HIMAPRODI route | Provider multi-turn: fee question followed by `kalau TI?` style replacement | REAL_PRODUCTION_DEFECT_FIXED | `src/engine/semanticRagEngine.js` | Before: canonical program-only follow-up could return organization/profile evidence; After: UKM route respects canonical organization intent and fee context resolves program replacement through fee route | Provider release parity PASS; golden 0 WRONG; blind/source regressions PASS | FIXED |
| PPR-003 | Legacy provider mega-suites assert stale implementation details | `providerWebhook.test.js`, `providerRouteRealFlow.test.js` | STALE_EXPECTATION + TEST_BOUNDARY_DEBT + ASYNC_CLEANUP_DEBT | tests only / documented | Legacy failures cluster around source labels, old session telemetry, menu/greeting wording, helper call counts, and monolithic runtime behavior | Compact release-gating provider parity suite created and PASS | DOCUMENTED_NONBLOCKING_DEBT |

| BH3-001 | Frozen provider-equivalent Blind Holdout #3 exposed unresolved source-to-answer generalization gaps | 30 fresh cases across fee, schedule, academic, profile, count, relation, comparison, history, validity, sequence, institution document, international, unsupported, cross-domain, slang, multi-turn | BLIND_HOLDOUT_GAPS_FOUND | source-present false fallback, composer field preservation, evidence compatibility, provider-path performance | PASS 16/30: 11 grounded + 5 safe fallback; non-pass: 8 false fallback, 3 incomplete, 2 wrong fact, 1 timeout | BLIND_HOLDOUT_3_RESULTS.md; raw tmp/blind_holdout_3_results.json | OPEN |


| B3R-001 | Legal document/history requests could be blocked by PMB-style answer-shape requirements | `izin operasional`, SK/legal establishment, institution history/document classes | REAL_PRODUCTION_DEFECT_FIXED | `semanticRagEngine` answer-shape + institution-history route preservation | Before: institution legal query could false fallback; After: supported SK/izin evidence is returned | Blind #3 regression case fixed; golden 0 WRONG; evidence/document/schedule/semantic/retrieval/npm/provider PASS | FIXED |
| B3R-002 | Informal degree-outcome wording was not consistently preserved to supported program degree evidence | degree/titel/ijazah outcome variants | REAL_PRODUCTION_DEFECT_FIXED | `queryUnderstanding`, `semanticRagEngine` degree evidence extraction | Before: informal BD degree wording could sanitize/fallback to wrong artifact; After: isolated provider path returns `Sarjana Bisnis (S.Bns)` | Focused provider probe PASS; accepted gates PASS | FIXED |
| B3R-003 | Specific location subset could be broadened into all-campus answer after canonical expansion | typo/reordered campus location variants | REAL_PRODUCTION_DEFECT_FIXED | `semanticRagEngine` location route input/answer focusing | Before: Jimbaran query could include Renon; After: explicit Jimbaran subset preserved while generic location still lists all campuses | Blind #3 regression case fixed; accepted gates PASS | FIXED |
| B3R-004 | External partner/relation questions could use generic same-domain evidence without supporting proposition | unsupported external partnership/recruitment relation variants | REAL_PRODUCTION_DEFECT_FIXED | `queryUnderstanding` externalRelation constraint; `semanticRagEngine` supporting-proposition guard | Before: absence of relation support could be over-answered; After: safe cannot-confirm unless evidence supports subject-relation-object | Negative/support controls PASS; accepted gates PASS | FIXED_WITH_EVALUATOR_DEBT |
| B3R-005 | Blind #3 evaluator still flags cautious grounded/safe wording as fallback or unsupported claim | Blind #3 regression evaluator | TEST/EVALUATOR_DEBT | `tmp/blind_holdout_3_runner.js` evaluator behavior, not production engine | Before/After production gates PASS but Blind #3 regression summary has 6 FALSE_FALLBACK + 1 UNSUPPORTED_CLAIM + 1 INCOMPLETE_ANSWER | Requires evaluator/test-isolation reconciliation before freeze and Blind #4 | OPEN |


| KFR-001 | Organization profile/function wording was misclassified as entity-type comparison when a program alias appeared inside organization name | HIMAPRODI function/profile questions with embedded SI/BD/TI/SK aliases | REAL_PRODUCTION_DEFECT_FIXED | src/engine/queryUnderstanding.js | Before: ask_entity_type_comparison; After: profile/function/purpose wording outranks comparison unless explicit comparison signal exists | Blind #2 30/30; source-derived/fresh PASS; full gates PASS | FIXED |
| KFR-002 | Academic TA subsection page-limit answer was composed correctly but rejected by local meaning verifier | Kata Pengantar page-limit requestedField class | REAL_PRODUCTION_DEFECT_FIXED | src/engine/semanticRagEngine.js | Before: correct 1 halaman fact blocked to academic fallback; After: subsection pageLimit answer is emitted and narrowly trusted when requested fields match | Blind #2 30/30; focused/golden/evidence PASS | FIXED |
| KFR-003 | Foreign-student administrative route accepted broad international domain and hijacked Student Exchange requirements | Student Exchange requirement/procedure variants with exchange/luar negeri wording | REAL_PRODUCTION_DEFECT_FIXED | src/engine/semanticRagEngine.js | Before: Visa/ITAS/SKTT docs answered Student Exchange syarat; After: admin docs require explicit foreign-student/visa intent and Student Exchange requirements use Student Exchange composer | Blind #2 30/30; Blind #3 30/30 regression; gates PASS | FIXED |
| KFR-004 | Blind #3 evaluator/session isolation over-classified grounded/safe answers as non-pass | fee caution wording, no-active-wave date answer, DNUI Tahun 1 & 2, unsupported relation safe wording, stale chatId | TEST_EVALUATOR_DEBT_FIXED | tmp/blind_holdout_3_runner.js, tmp/blind_holdout_3_expected.json | Before: Blind #3 regression showed 8 evaluator non-pass; After: Blind #3 regression 30/30 with unique run ids and stricter fallback/forbidden-claim evaluator | Not clean blind proof; ready for Freeze #4 + fresh Blind #4 | FIXED_AS_REGRESSION_EVIDENCE |
| BH4-001 | Frozen provider-equivalent Blind Holdout #4 exposed remaining source-to-answer generalization gaps | 32 fresh source-derived cases across fee, schedule, academic, institution, organization, international, comparison, unsupported, cross-domain, and multi-turn | BLIND_HOLDOUT_GAPS_FOUND | source-present false fallback, composer requested-field preservation, unsupported relation/fee route precedence | PASS 24/32: 21 grounded + 3 safe fallback; non-pass: 4 false fallback, 3 incomplete answer, 1 unsupported claim | `BLIND_HOLDOUT_4_RESULTS.md`; raw `tmp/blind_holdout_4_results.json`; no wrong domain/entity/fact/raw leak/timeout | OPEN |
| B4R-001 | Organization COUNT evidence compatibility could lose compatible collection evidence | HIMAPRODI/ORMAWA COUNT class | FIXED | `semanticRagEngine`, canonical COUNT contract | Before: source-present count could fallback or collide with unrelated domains; After: validated organization subset collection produces grounded count | Focused knowledge 14/14; Blind #4 `blind4_17_himaprodi_count` PASS | FIXED |
| B4R-002 | Requested-field preservation missing for several source-present international/admin fields | Student Exchange information channel, DNUI accommodation, Hi-Think N2, Visa E30B amount/period | FIXED | `queryUnderstanding`, `semanticRagEngine` source-grounded requested-field contract | Before: source-present facts could fallback or omit material fields; After: field-specific evidence propositions are preserved without canned entity answers | Blind #4 regression PASS for affected classes | FIXED |
| B4R-003 | Generic source-grounded route overreached into foreign-admin definition/procedure composer | foreign study permit / ITAS / KITAS golden cases | FIXED | `semanticRagEngine` route precedence | Before: golden route/source mismatch after admin amount remediation; After: generic source-grounded route narrowed, admin topic composer restored | Golden smoke 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG | FIXED |
| B4R-004 | Document-purpose extraction from noisy administrative/form source remains incomplete | FORM IKU PTS purpose | OPEN | document-purpose proposition extraction / composer-preflight boundary | Source-present evidence exists and canonical is correct, but safe composer cannot yet summarize purpose without raw artifact risk | Blind #4 remains 31/32 with 1 FALSE_FALLBACK; no raw leak | OPEN |

| B4R-005 | Noisy institution-document purpose/function could safely fallback despite source-present evidence | FORM IKU/institution document purpose-function class | REAL_PRODUCTION_DEFECT_FIXED | `semanticRagEngine.js` institution-document proposition extraction | Before: correct canonical/source but composer/preflight boundary returned source-present FALSE_FALLBACK; After: generic source-scoped proposition extraction composes clean purpose/function/reporting-scope answer before common preflight | Blind #4 32/32; focused knowledge 35/35; golden 0 WRONG; evidence/document-safety/schedule/semantic/retrieval/npm/provider PASS | FIXED |
| B4R-006 | Generic source-grounded requested-field route was too broad for adjacent organization/history/admin classes | student-organization profile, institution founding date, foreign-student admin procedure | REAL_PRODUCTION_DEFECT_FIXED | `queryUnderstanding.js`, `semanticRagEngine.js` route boundary | Before: profile/history/admin queries could be hijacked by generic source-grounded path or lose requested fields; After: specific organization/history/admin handlers retain authority unless source-grounded preservation is actually required | Blind #1/#2/#3/#4 accepted outcomes all PASS; old 44 44/44 | FIXED |

## Final Knowledge Coverage Reconciliation Verdict

`KNOWLEDGE_COVERAGE_RECONCILED_READY_FOR_FREEZE_5`

| BH5-001 | Clean Blind Holdout #5 exposed remaining source-to-answer and provider-path generalization gaps | 32 fresh source-derived cases across fee, schedule, registration, program, academic, institution, organization, international, comparison, negative, cross-domain, and multi-turn | BLIND_HOLDOUT_GAPS_FOUND | canonical/requestType coverage, evidence rejection, route collision, comparison field preservation, provider performance/context | Raw: 20 PASS_GROUNDED, 3 PASS_SAFE_FALLBACK, 5 FALSE_FALLBACK, 2 TIMEOUT, 1 UNSUPPORTED_CLAIM, 1 INCOMPLETE_ANSWER; 0 wrong domain/entity/fact/raw leak | `BLIND_HOLDOUT_5_RESULTS.md`; `tmp/blind_holdout_5_results.json`; no remediation after result | OPEN |

## Blind Holdout #5 Verdict

`BLIND_HOLDOUT_GAPS_FOUND`

| B5R-001 | Blind #5 source-present false fallbacks were caused by incomplete canonical/requestType and route precedence coverage | program list/profile, registration correction, Student Exchange information channel, contact lecturer | REAL_PRODUCTION_DEFECT_FIXED | `queryUnderstanding.js`, `semanticRagEngine.js` | Before: supported meanings could enter generic fallback or slower source path; After: specific canonical routes preserve requested intent before generic routes | Blind #5 regression 32/32; golden 0 WRONG; provider parity PASS | FIXED |
| B5R-002 | Generic comparison could not synthesize source-grounded propositions across separate target evidence | Student Exchange vs Double Degree, institution legal-date vs schedule, academic S1 vs S2 SKS | REAL_PRODUCTION_DEFECT_FIXED | `semanticRagEngine.js` proposition-level comparison | Before: comparison false fallback/incomplete answer; After: per-target evidence/propositions are composed without requiring one chunk to mention both targets | Blind #3 30/30; Blind #5 32/32; source-derived 39 PASS | FIXED |
| B5R-003 | Unsupported policy/relation wording could be interpreted as a positive unsupported claim | unsupported remote exam/policy/relation classes | REAL_PRODUCTION_DEFECT_FIXED | `semanticRagEngine.js`, `answerPreflightEvaluator.js` | Before: safe fallback wording could look like permission/support; After: response states source does not confirm supporting rule/relation | Blind #5 32/32; evidence/document-safety PASS | FIXED |
| B5R-004 | Academic credit comparison dropped requested SKS field for S1 side after helper output contained cautious text | S1 vs S2 SKS comparison | REAL_PRODUCTION_DEFECT_FIXED | `semanticRagEngine.js` academic comparison proposition filter | Before: S1 side could select HIMAPRODI evidence and omit 144 SKS; After: supported `144 SKS` and `56 SKS` facts are preserved per target | Blind #3 regression 30/30; provider parity PASS | FIXED |
| B5R-005 | Blind #5 can no longer be used as clean blind proof after remediation | Blind #5 result set | PROCESS_STATUS | validation process | Raw Blind #5 remains `BLIND_HOLDOUT_GAPS_FOUND`; after remediation it is regression evidence only | Next phase requires new freeze and fresh blind holdout | READY_FOR_NEXT_FREEZE |

## Post Blind #5 Remediation Verdict

`BLIND_5_GAPS_REMEDIATED_READY_FOR_NEXT_FREEZE`

| BH6-001 | Clean Blind Holdout #6 exposed remaining source-to-answer contract gaps | schedule numeric-date point, registration correction channel, D3-only list subset, two-target program comparison, accreditation validity, BEM profile | OPEN | queryUnderstanding / route precedence / evidence compatibility / composer field preservation | Raw Blind #6: 24 PASS_GROUNDED, 2 PASS_SAFE_FALLBACK, 2 FALSE_FALLBACK, 2 INCOMPLETE_ANSWER, 2 WRONG_FACT | `BLIND_HOLDOUT_6_RESULTS.md`; `FREEZE_6_MANIFEST.md` | OPEN |

| PB6V-001 | Pending post-Blind #6 mandatory validation gates were blocked by runner access, then rerun after access returned | semantic, retrieval, npm test, provider/webhook release parity | VALIDATION_COMPLETE | No production code changed during validation-only pass | Before: status partially validated due blocked gates; After: semantic 13/13, retrieval 110/110, npm test unit 365/365 + contract 94/94, provider parity 2/2 PASS | POST_BLIND_6_PENDING_VALIDATION_REPORT.md | FULLY_VALIDATED |


| FPA-001 | Final production-path architecture audit found no release-blocking production defect | provider/webhook, canonical, routing, retrieval, composer, preflight, outbound | AUDIT_CLEAN | Audit-only; no production behavior changed | No REAL_PRODUCTION_DEFECT found; remaining items are NONBLOCKING_DEBT/TEST_DEBT/EXPECTED_BEHAVIOR | FINAL_PRODUCTION_PATH_ARCHITECTURE_AUDIT.md | READY_FOR_CLEANUP_AND_RELEASE_FREEZE |


| RFR-001 | Final cleanup and release freeze readiness | release candidate workspace after blind/regression remediation | RELEASE_FREEZE_RECORDED | cleanup/report/manifest only | Untracked remediation scripts archived; production behavior unchanged; all mandatory gates rerun after cleanup | RELEASE_CANDIDATE_VALIDATED_READY_FOR_DEPLOYMENT_REVIEW |

| PDB-001 | Organization/ORMAWA COUNT answers were blocked by meaning verifier despite validated collection/count evidence | `Jumlah ormawa di ITB STIKOM Bali ada berapa?` plus UKM/HIMAPRODI/count wording variants | REAL_PRODUCTION_DEFECT_FIXED | `src/engine/semanticRagEngine.js` | Before: production route `semantic-rag-meaning-verifier-blocked` returned safe fallback; After: structured organization-count verifier trusts only compatible `ukm-count` answers and rejects wrong/fabricated counts | Focused org-count 5/5; old44 44/44; Blind #1-#6; golden/evidence/document/semantic/retrieval/npm/provider PASS | FIXED_PENDING_DEPLOYMENT |
