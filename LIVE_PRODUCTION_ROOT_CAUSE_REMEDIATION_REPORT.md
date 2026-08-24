# Live Production Root-Cause Remediation Report

Generated: 2026-08-20

## Scope

Live production failures used as evidence:

1. `Perkuliahan yang ada di S2 apa saja?` routed away from S2 curriculum/course information.
2. `Berapa ada ormawa di ITB STIKOM Bali` returned generic ORMAWA evidence instead of the requested count.
3. `Profil ukm tari` leaked profile/raw evidence fragments.

No exact-query hardcode was added. Fixes target canonical meaning, route precedence, answer-shape count compatibility, and UKM profile evidence cleanup.

## Source Support

- S2 source support exists in the postgraduate deterministic/source-backed path: Program Pascasarjana / S2 Sistem Informasi, Intelligent & Secure System, Cyber Security, Data Science, Enterprise System, Medical Informatics, 4 semesters, 56 SKS.
- ORMAWA count support exists in `src/data/ukm_list_categorized.json` / UKM list loader: total 32 UKM/Ormawa.
- UKM Tari support exists in the private/validated RAG profile source for PRAGINA/Tari; failure was formatting/composer cleanup, not missing source.

## Root-Cause Trace Summary

| Case | First Failure | Module | Evidence | Fix |
|---|---|---|---|---|
| S2 perkuliahan | QUERY_UNDERSTANDING / ROUTE_PRECEDENCE | `src/engine/queryUnderstanding.js`, `tryProgramCurriculumFollowupAnswer` | Canonical was `ask_general/general`, no S2 entity, then slow generic path/Hi-Think collision risk | Contextual S2 entity resolution and learning synonyms; S2 curriculum preguard returns postgraduate curriculum facts before generic/international evidence |
| ORMAWA count | QUERY_UNDERSTANDING + ANSWER_SHAPE | `queryUnderstanding.js`, `tryUkmAnswer`, `hasConcreteNumberOrAmount` | Canonical lacked count previously; after canonical fix, answer-shape rejected `32 UKM/Ormawa` as non-numeric | Added canonical `ask_organization_count` / `questionType=count`, count preguard before document-first, count answer from UKM list total, count units accepted by shape guard |
| UKM Tari profile | COMPOSER / EVIDENCE_CLEANUP | `buildUkmProfileAnswerFromIndex`, `summarizeUkmProfileBody` | Correct profile source selected but output contained `PROFILE ORMAWA`, `Prof.`, `Beserta Istrinya`, and raw history fragments | UKM profile chunk/sentence cleanup now strips profile headings and rejects broken/raw fragment starts consistently |

## Generalization Evidence

Focused contract test added:

- `tests/semanticRagEngine.liveProductionRootCauseContracts.test.js`

Covered known failures, unseen paraphrases, and negative controls:

- S2 unseen: `mata kuliah pascasarjana apa saja?`, `S2 SI kuliahnya membahas apa?`, `kurikulum magister sistem informasi fokusnya apa?`.
- S2 negative: `apa itu Hi-Think?` remains Hi-Think/Jepang, not S2.
- Count unseen: `jumlah UKM di STIKOM ada berapa?`, `total organisasi mahasiswa berapa?`, `ada berapa unit kegiatan mahasiswa di kampus?`.
- Count negative: `UKM apa saja?` remains list route, not count-only.
- UKM profile unseen: `ukm tari pragina itu apa?`, `jelasin profil ormawa tari`, `tari tradisional pragina kegiatannya apa?`.
- UKM profile negative: unknown UKM profile does not substitute PRAGINA/Tari.

## Validation

Local validation completed:

- Focused live production root-cause contracts: PASS, 3/3.
- Golden smoke: PASS, 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG; `pmb_still_open` 1081ms.
- `npm run test:semantic`: PASS, 13/13.
- `npm run test:retrieval`: PASS, 110/110.
- `npm run test:document-safety`: PASS, 6/6.
- `npm run test:evidence`: PASS, 56/56.
- `npm run test:schedule`: PASS, 12/12.
- P0/P3/LFD focused gates: PASS, 22/22.
- P1 canonical/runtime files: PASS, 13/13.
- `npm test`: PASS natural, unit 330/330 and contract 94/94.

## Files Changed

- `src/engine/queryUnderstanding.js`
- `src/engine/semanticRagEngine.js`
- `tests/semanticRagEngine.liveProductionRootCauseContracts.test.js` (force-add required because `tests/` is ignored)

## Deployment Note

No deployment or production behavior change has been pushed yet in this report step. RAG index remains private and is not added to Git.

## Verdict

LOCAL_REMEDIATION_VALIDATED_PENDING_DEPLOYMENT_SMOKE

## Production Smoke Follow-Up Finding

Initial Railway semantic smoke after commit `1480ddf` exposed two safety/output issues still in the same defect class:

- Short raw-leak complaint `jawaban tadi bocor potongan dokumen mentah seperti PROFILE ORMAWA dan bullet patah` routed to `semantic-rag-campus-support-entity` instead of the raw document leak feedback guard.
- `Profil ukm tari` no longer leaked `PROFILE ORMAWA`, `Prof.`, or `Beserta Istrinya`, but still included a dangling history fragment: `Dari waktu ke waktu ... di dampingi.`

Additional general fix:

- Raw-leak complaint guard now recognizes short complaints containing one strong raw marker such as `PROFILE ORMAWA`, `potongan dokumen`, `dokumen mentah`, or `bullet patah`.
- UKM profile cleanup rejects broader raw history starts (`Dari waktu`, `Perjalanan`, `Seiring`) and dangling fragments such as `di dampingi.`.

Post-fix local validation:

- Focused live root-cause + raw leak tests: PASS, 6/6.
- Golden smoke: PASS, 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG; `pmb_still_open` 1838ms.
- `npm run test:semantic`: PASS, 13/13.
- `npm run test:retrieval`: PASS, 110/110.
- `npm run test:document-safety`: PASS, 6/6.
- `npm run test:evidence`: PASS, 56/56.
- `npm test`: PASS natural, unit 330/330 and contract 94/94.

## Production Smoke Follow-Up Schedule Verifier Finding

Railway semantic smoke after commit `cafc321` exposed a production-only false rejection:

- Explicit-date schedule queries such as `gelombang 1 masih buka tanggal 7 juli 2026?` returned `semantic-rag-meaning-verifier-blocked`.
- Equivalent local production-mode/no-provider execution returned the correct deterministic `semantic-rag-schedule-window` answer.
- Production smoke variants showed the failure depended on the provider/LLM verifier path, not schedule parsing or route selection.

Root cause:

- The final meaning verifier could overrule trusted deterministic schedule-window answers even when the answer contained a concrete schedule period/date and preserved the user's explicit reference date.

General fix:

- Added a narrow structured schedule safety condition for `semantic-rag-schedule-window` answers that contain concrete schedule/date information and are still clean under the document-safety guards.
- This does not bypass verifier globally; it protects only deterministic schedule-window answers already produced by the trusted schedule handler.

Post-fix local validation:

- Focused live root-cause + P0 contracts: PASS, 15/15.
- Golden smoke: PASS, 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG; `pmb_still_open` 1300ms.
- `npm run test:semantic`: PASS, 13/13.
- `npm run test:retrieval`: PASS, 110/110.
- `npm run test:document-safety`: PASS, 6/6.
- `npm run test:evidence`: PASS, 56/56.
- `npm test`: PASS natural, unit 330/330 and contract 94/94.

## Live Production Root-Cause Deployment Validation - 2026-08-20

Deployment sequence:

- Code commit deployed for smoke: `70be022` (`Protect deterministic schedule from verifier false rejects`).
- Smoke deployment: `e535a0f1-fed4-4b25-b043-87bd6b8efc80`, status `SUCCESS`.
- Smoke endpoint disabled after validation by setting `SEMANTIC_SMOKE_TOKEN=disabled`.
- Active post-disable deployment: `796c1af3-fb6f-4f0b-8953-fb20dc3beaea`, status `SUCCESS`.
- Endpoint verification after disable: `POST /internal/semantic-smoke` returned HTTP 404.

Production non-sending semantic smoke result:

| Case | Route/Source | Duration | Result |
|---|---|---:|---|
| PMB current status | `semantic-rag-schedule-window` | 1676ms | PASS |
| Explicit-date schedule | `semantic-rag-schedule-window` | 365ms | PASS, preserved `Per 7 Juli 2026` |
| Explicit-date unseen schedule | `semantic-rag-schedule-window` | 343ms | PASS, preserved `Per 5 Juli 2026` |
| Registration how-to | `semantic-rag-registration-info` | 206ms | PASS |
| Registration fee | `semantic-rag-registration-fee` | 245ms | PASS |
| UKT | `semantic-rag-fee-detail` | 222ms | PASS |
| Program list | `semantic-rag-program-list` | 189ms | PASS |
| SI vs TI comparison | `semantic-rag-program-comparison` | 189ms | PASS |
| BD curriculum | `semantic-rag-program-curriculum` | 188ms | PASS |
| Academic SKS | `semantic-rag-academic-credit` | 190ms | PASS |
| Facility | `semantic-rag-campus-facility` | 193ms | PASS |
| Career Center | `semantic-rag-campus-support-entity` | 188ms | PASS |
| Student Exchange benefit | `semantic-rag-international-topic-composer` | 191ms | PASS |
| UTB/DKV Double Degree | `semantic-rag-dual-degree` | 190ms | PASS |
| Unsupported Double Degree partner | `semantic-rag-unsupported-double-degree-partner` | 187ms | PASS |
| Unknown program fee | `semantic-rag-meaning-verifier-blocked` | 192ms | PASS, safe fallback |
| Physical-attribute fallback | `semantic-rag-campus-physical-attribute-insufficient-data` | 188ms | PASS |
| Raw-document leak complaint | `semantic-rag-raw-document-leak-feedback` | 195ms | PASS |
| Small talk | `semantic-rag-small-talk` | 189ms | PASS |
| S2 curriculum live failure | `semantic-rag-postgraduate-profile` | 189ms | PASS |
| ORMAWA count live failure | `semantic-rag-ukm-count` | 193ms | PASS |
| UKM Tari profile live failure | `semantic-rag-ukm-list` | 344ms | PASS |

Validator summary:

- 22/22 PASS.
- 0 WRONG.
- RAG index loaded with `indexSize=835`.
- No raw evidence leak in inspected critical answers.
- No unsupported entity substitution.
- Explicit dates preserved after the verifier patch.
- PMB current-status latency remained acceptable at 1676ms.

Log review:

- Startup used `npm run start:prod` / `node --max-old-space-size=4096 src/index.js`.
- RAG prewarm succeeded with `indexSize=835` on both smoke and post-disable deployments.
- No sampled startup crash, missing module, unhandled rejection, repeated RAG initialization, provider loop, or stream-write crash.
- One intermittent `Redis Rate Limit Error: fetch failed` remained nonblocking; server stayed online and semantic smoke passed.

Final verdict for this remediation:

`DEPLOYED_VALIDATED`
