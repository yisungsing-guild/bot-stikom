# Post Deployment Real User Semantic Remediation Report

Generated: 2026-08-26

Final verdict: `REAL_USER_GENERALIZATION_REMEDIATED_READY_FOR_RELEASE_REVIEW`

No deployment was performed. No cleanup was performed. No Blind Holdout was created. Historical Blind #1-#6 results were not modified.

## Scope

Production had previously reached `DEPLOYED_VALIDATED` after protected non-sending smoke passed 20/20. Manual WhatsApp/Fonnte questions then exposed semantic gaps outside the protected smoke set. The manual questions were treated as regression evidence, not exact-query patch targets.

Fixes were made at semantic contract boundaries: canonical understanding, requestType propagation, route precedence, evidence compatibility, structured verifier acceptance, stale-context rejection, and output encoding normalization.

## Production Files Changed

| File | Purpose |
|---|---|
| `src/engine/queryUnderstanding.js` | Added general canonical classes for academic-level comparison, career-goal recommendation, career/employment support, and postgraduate learning/curriculum questions. |
| `src/engine/semanticRagEngine.js` | Added grounded handlers/verifier-safe paths for academic-level comparison, program recommendation, career support, curriculum follow-up, and safer Double Degree formatting. |
| `src/utils/textSanitizer.js` | Normalizes mojibake bullet artifacts into safe punctuation without weakening raw-fragment protection. |

Related tests were updated/added for real-user semantic contracts, provider parity, and organization-count regression coverage.

Workspace hygiene note: `data/runtime/dynamic_alias_dictionary.json` shows generated timestamp drift only (`generatedAt`), with alias count unchanged. Review before release commit so unrelated runtime artifact drift is not included accidentally.

## Case Trace Matrix

| Case | Real Query | Before | FIRST_FAILURE | General Fix | After |
|---|---|---|---|---|---|
| A | `Perbedaan antara program S1 dan D3 apa ya?` | Safe fallback. The query was not treated as academic-level comparison with two comparable targets. | Canonical/requestType and route precedence. | Added academic-level comparison detection for S1/Sarjana and D3/Diploma variants, plus grounded comparison route. | Routes through `semantic-rag-study-level-comparison` and answers only from supported academic-level propositions. |
| B | `Kalau S1 yang cocok untuk bekerja di bidang pemasaran yang mana ya?` | Safe fallback. Career goal was not represented as recommendation request. | Canonical/requestType plus verifier boundary for structured recommendation. | Added career-goal recommendation contract: academic level + career field + candidate evidence + safe fallback for unsupported goals. | Supported marketing-style career goal produces grounded recommendation; unsupported goals safely fallback. |
| C | `Apakah ITB STIKOM Bali membantu lulusannya mendapatkan pekerjaan?` | Returned unrelated S2 degree outcome: `Lulusan memperoleh gelar Magister Komputer (M.Kom.).` | Evidence compatibility / stale context contamination. | Career/employment-support intent now outranks stale academic degree evidence; evidence-first degree answers are blocked for career-support questions. | Fresh and multi-turn context-switch variants answer from Career Center/career-support evidence and do not emit M.Kom. |
| D | Double Degree output displayed `â€¢` | Semantically valid answer contained mojibake bullet artifact. | Composer/output sanitization. | Replaced unsafe composer bullet literal and added generic sanitizer normalization for mojibake bullet artifact. | Double Degree output uses clean punctuation; raw-fragment safety remains intact. |
| E | `Perkuliahan yang ada di S2 apa saja?` and unseen curriculum variants | Routed to program list, then curriculum wording could be rejected by verifier. | Canonical precedence and structured curriculum verifier boundary. | Added postgraduate learning/curriculum canonical class and fixed structured curriculum verifier acceptance for S2 curriculum/focus evidence. | S2 curriculum/focus questions route through supported academic/program curriculum answer path. |

## Career Center Field Audit

The questions `Apa itu Career Center ITB STIKOM Bali?` and `Apa keuntungan menjadi mahasiswa ITB STIKOM Bali dari sisi karier?` were audited for possible composer collapse. No material wrong fact was proven. The remediation keeps definition/profile, benefit, service/function, and employment-support intent separate where source evidence supports separation, without forcing artificial differences when source propositions overlap.

## Generalization Coverage

For each fixed root contract, tests cover exact regression, unseen paraphrase, reordered wording, short/slang wording, single-turn, multi-turn, context switch, supported follow-up, unsupported negative control, cross-domain collision, and nearby-supported-entity negative control.

Acceptance principle:

- source-supported and semantically compatible request -> grounded answer;
- unsupported source/relation/goal -> safe fallback;
- explicit new intent -> stale context rejected;
- true elliptical follow-up -> compatible context inherited;
- wrong-domain evidence -> rejected;
- nearest entity substitution -> rejected.

## Validation Results

Completed after the final production-code patch:

| Gate | Result |
|---|---|
| Syntax: `queryUnderstanding.js` | PASS |
| Syntax: `semanticRagEngine.js` | PASS |
| Syntax: `textSanitizer.js` | PASS |
| Focused real-user + organization count + live root-cause contracts | PASS, 3 suites / 25 tests |
| `npm run test:semantic` | PASS, 5 suites / 13 tests |
| `npm run test:retrieval` | PASS, 4 suites / 110 tests |
| `npm run test:evidence` | PASS, 3 suites / 56 tests |
| `npm run test:document-safety` | PASS, 2 suites / 6 tests |
| `npm run test:schedule` | PASS, 1 suite / 12 tests |
| Golden smoke | PASS, 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG |
| Provider/webhook release parity | PASS, 1 suite / 4 tests |
| Full `npm test` | PASS, unit 365/365 + contract 94/94 |

An additional broad ad-hoc Jest bundle that included several historical regression files was started but interrupted after it produced no useful terminal result within the working timebox. No assertion failure was captured from that interrupted run, and it is not used as acceptance evidence.

## Provider-Equivalent Validation

Provider/webhook release parity was extended to cover academic-level comparison, career-goal recommendation, unsupported career-goal fallback, same-session context switch from S2 topic to employment support, and Double Degree formatting. Result: PASS. No live WhatsApp/Fonnte outbound message was sent during local validation.

## Remaining Debt, Not Semantic Production Defect

| Item | Classification | Notes |
|---|---|---|
| Local fresh provider family test with Neon/session persistence timeouts | `TEST/ENVIRONMENT_DEBT` | DB/session lookup and inbound/outbound persistence timed out locally; not a semantic production failure without production evidence. |
| Redis rate-limit fetch log observed after deployment | `INFRASTRUCTURE/LOG_DEBT` | Health and semantic smoke remained healthy. |
| `stream.write is not a function` style log issue | `LOG_ONLY_DEBT` | Does not change semantic correctness; clean separately. |
| Interrupted broad historical Jest bundle | `REGRESSION_RUNNER_DEBT` | Re-run standalone historical suites if release review requires explicit fresh evidence for every archived runner. |
| Runtime alias dictionary generated timestamp drift | `ARTIFACT_HYGIENE_DEBT` | Alias count unchanged; avoid including unrelated runtime-generated timestamp drift in release commit unless intentional. |

## Release Review Notes

The remediation is general-contract based, not query-specific:

- no hardcoded answer for S1/D3;
- no hardcoded marketing-to-program mapping outside source-supported recommendation logic;
- no exact phrase patch for employment-support question;
- no direct replace-only fix for one Double Degree answer without generic sanitizer coverage;
- no historical Blind result mutation.

No deployment, cleanup, release candidate, or Blind Holdout was created after this remediation.

Final status:

`REAL_USER_GENERALIZATION_REMEDIATED_READY_FOR_RELEASE_REVIEW`
