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
