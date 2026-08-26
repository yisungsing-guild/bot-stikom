# Post Deployment Validation Report

Generated: 2026-08-25

Final verdict: `DEPLOYMENT_VALIDATION_FAILED`

No production code was changed. No WhatsApp/Fonnte live message was sent. Temporary smoke access was enabled only through `SEMANTIC_SMOKE_TOKEN`, then removed and verified disabled again.

## Deployment Artifact Parity

- Release candidate commit: `4aae882cc06e1d9e02016462b8e40b1c7621db0b`
- Branch: `main`
- Remote: `https://github.com/yisungsing-guild/bot-stikom.git`
- Push result: `be5e7a3..4aae882 main -> main`
- Railway service: `bot-stikom`
- Railway project: `resplendent-charm`
- Railway environment: `production`
- Railway URL: `https://bot-stikom-production-ff1e.up.railway.app`

Deployment from source:

- Initial deployed release deployment: `4b9dd83b-ce5f-4e90-875d-8a339eecea0b`
- Commit hash: `4aae882cc06e1d9e02016462b8e40b1c7621db0b`
- Builder: Dockerfile
- Image digest: `sha256:045f409784d13161baefe8d59bfcd260edfb7607deb73208991550160d0708c0`

Temporary smoke-token deployment:

- Enable-token deployment: `137c00af-0642-4290-958a-2eec76c7b50c`
- Commit hash: `4aae882cc06e1d9e02016462b8e40b1c7621db0b`

Disable-token deployment:

- Final active deployment: `f7a425e4-47a4-4db6-87b6-a56973875a9c`
- Commit hash: `4aae882cc06e1d9e02016462b8e40b1c7621db0b`
- Service status: Online

Artifact parity: PASS.

## Startup / RAG / Health

Observed after final deployment:

- Service online.
- Root `/`: previously verified `200`.
- `/fonnte/webhook` safe GET: previously verified `200 ok`.
- Provider: Fonnte production.
- RAG prewarm: `success=true`, `indexSize=835`.
- Error log filter: no startup/module/provider/RAG error found.

RAG index strategy remains unchanged:

- `src/data/rag_index.json` is not tracked by Git.
- Expected private/runtime index SHA remains `FA21B6D8ECC7B1F352DE34E28E77D757F77F808DBE0A9707E6466E27281DC0B9`.
- Runtime SHA could not be directly read through available safe endpoint, but runtime prewarm confirmed 835 chunks.

## Temporary Smoke Access Lifecycle

- Temporary token generated in memory only; token value was not printed.
- `SEMANTIC_SMOKE_TOKEN` set in Railway production through stdin.
- Protected smoke endpoint became callable.
- Smoke endpoint response confirmed:
  - `ok=true`
  - `diagnosticOnly=true`
  - `outboundProviderBypassed=true`
  - `indexSize=835`
- `SEMANTIC_SMOKE_TOKEN` was deleted after smoke.
- Final runtime redeployed from the same commit to remove token from process env.
- `/internal/semantic-smoke` without token now returns `404` again.

Smoke access cleanup: PASS.

## Non-Sending Production Semantic Smoke

Total: 20

- PASS by automated smoke evaluator: 14
- Non-pass by automated smoke evaluator: 6
- Max duration: 3442 ms
- No live WhatsApp/Fonnte outbound send was used.

Important note: the raw-leak detector in this ad-hoc smoke evaluator was intentionally conservative and flagged some normal answer formatting as `raw_evidence_leak`. These require follow-up review before classifying as production raw-leak defects. The material source-present false fallback below is the release blocker.

| ID | Query | Source / Route | Latency | Result | Notes |
|---|---|---|---:|---|---|
| `pmb_current` | `PMB masih buka sekarang?` | `semantic-rag-schedule-window` | 1641 ms | PASS | PMB/date route responded. |
| `schedule_explicit` | `Tanggal 7 Juli 2026 gelombang berapa yang aktif?` | `semantic-rag-schedule-window` | 392 ms | REVIEW | Answer preserved `Per 7 Juli 2026`; ad-hoc raw-leak regex likely false-positive due normal labels. |
| `registration_how` | `Cara daftar mahasiswa baru gimana ya?` | `semantic-rag-registration-info` | 217 ms | REVIEW | Natural registration answer; ad-hoc raw-leak regex likely false-positive. |
| `fee_si` | `Rincian biaya Sistem Informasi berapa?` | `semantic-rag-fee-detail` | 262 ms | PASS | Fee facts present. |
| `ukt_ti` | `UKT Teknik Informatika per semester berapa?` | `semantic-rag-fee-detail` | 236 ms | PASS | UKT/semester facts present. |
| `program_definition` | `Informatika itu jurusan apa?` | `semantic-rag-program-definition` | 185 ms | PASS | Program definition route. |
| `academic_sks` | `S2 Sistem Informasi total SKS dan semesternya berapa?` | `semantic-rag-academic-source` | 187 ms | PASS | Academic numeric route. |
| `academic_procedure` | `Kalau mau yudisium prosedurnya gimana?` | `semantic-rag-academic-source` | 182 ms | PASS | Academic procedure route. |
| `student_exchange` | `Apa manfaat ikut Student Exchange?` | `semantic-rag-international-topic-composer` | 182 ms | PASS | International topic composer. |
| `ukm_count` | `Jumlah ormawa di ITB STIKOM Bali ada berapa?` | `semantic-rag-meaning-verifier-blocked` | 3442 ms | FAIL | Source-present count fell to safe fallback. |
| `ukm_profile` | `Profil UKM Tari PRAGINA seperti apa?` | `semantic-rag-ukm-list` | 331 ms | REVIEW | Profile answer present; ad-hoc raw-leak regex flagged formatting. Needs review before defect classification. |
| `comparison_fee` | `Bedanya DPP dan UKT apa?` | `semantic-rag-cross-domain-comparison` | 181 ms | PASS | Both comparison targets present. |
| `comparison_program` | `Kalau SI dibanding TI bedanya apa?` | `semantic-rag-program-comparison` | 183 ms | REVIEW | Comparison answer present; ad-hoc raw-leak regex flagged formatting. |
| `double_degree` | `Kalau UTB ambil DKV, di STIKOM Bali prodi apa?` | `semantic-rag-dual-degree` | 184 ms | PASS | Relation pairing present. |
| `unsupported_entity` | `Berapa biaya jurusan Astronomi di STIKOM Bali?` | `semantic-rag-unsupported-program-fee` | 2150 ms | PASS | No known-program substitution. |
| `unsupported_relation` | `Career Center kerja sama dengan NASA?` | `semantic-rag-explicit-external-insufficient-data` | 182 ms | PASS | Safe unsupported relation behavior. |
| `physical_fallback` | `Berapa tinggi gedung kampus Renon?` | `semantic-rag-campus-physical-attribute-insufficient-data` | 356 ms | PASS | No location hijack. |
| `raw_leak_guard` | `Kenapa jawaban tadi seperti potongan dokumen mentah: Source abc - Q: biaya?` | `semantic-rag-raw-document-leak-feedback` | 203 ms | PASS | Leak feedback route. |
| `small_talk` | `Halo kak` | `semantic-rag-small-talk` | 192 ms | PASS | Small talk route. |
| `multi_turn_style` | `Tadi bahas Sistem Informasi, kalau dibanding Teknik Informatika bedanya apa?` | `semantic-rag-program-comparison` | 198 ms | REVIEW | Comparison answer present; ad-hoc raw-leak regex flagged formatting. |

## Material Failure

Expected:

- Organization/UKM/ORMAWA count request should answer from compatible organization collection/count evidence when source support exists, or safely state no count only if source support is absent.

Actual:

- Query: `Jumlah ormawa di ITB STIKOM Bali ada berapa?`
- Route/source: `semantic-rag-meaning-verifier-blocked`
- Answer: safe fallback: `Saya belum menemukan data yang sesuai untuk menjawab pertanyaan itu...`
- Latency: 3442 ms

Deployed SHA/artifact:

- Commit: `4aae882cc06e1d9e02016462b8e40b1c7621db0b`
- Smoke-token deployment: `137c00af-0642-4290-958a-2eec76c7b50c`
- Final token-disabled deployment: `f7a425e4-47a4-4db6-87b6-a56973875a9c`

FIRST_FAILURE:

- Production semantic path after routing/evidence selection: organization count answerability/meaning verifier rejected or failed to preserve compatible count evidence, causing source-present false fallback.

Severity:

- Production smoke correctness blocker.
- No rollback performed because artifact parity, startup, basic health, provider mode, RAG prewarm, and unsupported-entity safety are healthy; the failure is semantic correctness that must be remediated deliberately in a separate phase if approved.

## Final Status

`DEPLOYMENT_VALIDATION_FAILED`

## Organization Count Verifier Remediation - 2026-08-25

The post-deployment blocker from the protected smoke was traced locally and remediated without changing routing, retrieval, source data, RAG index, provider behavior, or answer generation.

FIRST_FAILURE:

- `organization count answerability / meaning verifier`

General fix:

- Added structured count semantics for `semantic-rag-ukm-count` answers in `src/engine/semanticRagEngine.js`.
- The verifier now accepts grounded organization-family COUNT answers only when source, question, organization family, subset scope, numeric answer, and output quality align.
- Wrong-domain evidence, fabricated counts, unsupported counts, subset mismatch, and raw/admin fragments remain rejected.

Local validation after patch:

- Focused organization/count: PASS, 5/5.
- Old 44: PASS, 44/44.
- Blind #1-#6 regressions: PASS.
- Source-derived 39 and fresh 20: accepted outcomes preserved.
- Golden smoke: 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG.
- Evidence 56/56, document-safety 6/6, schedule/provider 12/12, semantic 13/13, retrieval 110/110.
- Full `npm test`: PASS natural; unit 365/365 + contract 94/94.
- Provider/webhook release parity: PASS, 2/2.

Deployment validation must be rerun from a new release candidate commit. Current production verdict remains `DEPLOYMENT_VALIDATION_FAILED` until the remediated commit is deployed and protected non-sending smoke passes.

## Remediated Release Deployment Validation - 2026-08-25

Release candidate deployed from GitHub source:

- Commit: `75ff3f13fb9cb53aa4f053e997d6398e0ef092e2`
- Remote `main`: verified at `75ff3f13fb9cb53aa4f053e997d6398e0ef092e2`
- Railway service: `bot-stikom`
- Railway production deployment from remediated source: `cafdd825-a3fb-487f-be32-72e7c035e83d`
- Temporary smoke-token deployment: `651a2ce8-6473-4b37-af26-d05ae0a7f3ab`
- Final token-disabled cleanup deployment: `f3081333-3601-43d4-823d-750edad1860f`

Runtime readiness:

- Service status: Online.
- Root health: HTTP 200.
- Fonnte webhook safe GET: HTTP 200.
- Runtime command: `npm run start:prod` -> `node --max-old-space-size=4096 src/index.js`.
- Semantic RAG prewarm: success, `indexSize=835`.
- Protected smoke endpoint was enabled only with temporary `SEMANTIC_SMOKE_TOKEN`, then token was deleted and the endpoint returned HTTP 404 again.
- No live WhatsApp/Fonnte outbound message was sent.

Protected non-sending semantic smoke:

| ID | Source / Route | Latency | Result |
|---|---|---:|---|
| `pmb_current` | `semantic-rag-schedule-window` | 1664 ms | PASS |
| `schedule_explicit` | `semantic-rag-schedule-window` | 396 ms | PASS, explicit `7 Juli 2026` preserved |
| `registration_how` | `semantic-rag-registration-info` | 395 ms | PASS |
| `registration_fee` | `semantic-rag-registration-fee` | 238 ms | PASS |
| `ukt_ti` | `semantic-rag-fee-detail` | 245 ms | PASS |
| `program_definition` | `semantic-rag-program-definition` | 189 ms | PASS |
| `academic_sks` | `semantic-rag-academic-source` | 189 ms | PASS |
| `academic_procedure` | `semantic-rag-academic-source` | 186 ms | PASS |
| `student_exchange` | `semantic-rag-international-topic-composer` | 186 ms | PASS |
| `ukm_count` | `semantic-rag-ukm-count` | 187 ms | PASS |
| `ukm_profile` | `semantic-rag-ukm-list` | 352 ms | PASS |
| `comparison_fee` | `semantic-rag-cross-domain-comparison` | 186 ms | PASS |
| `comparison_program` | `semantic-rag-program-comparison` | 186 ms | PASS |
| `double_degree` | `semantic-rag-dual-degree` | 186 ms | PASS |
| `unsupported_entity` | `semantic-rag-unsupported-program-fee` | 2713 ms | PASS safe fallback |
| `unsupported_relation` | `semantic-rag-explicit-external-insufficient-data` | 183 ms | PASS safe fallback |
| `physical_fallback` | `semantic-rag-campus-physical-attribute-insufficient-data` | 182 ms | PASS safe fallback |
| `raw_leak_guard` | `semantic-rag-raw-document-leak-feedback` | 186 ms | PASS |
| `small_talk` | `semantic-rag-small-talk` | 190 ms | PASS |
| `multi_turn_style` | `semantic-rag-program-comparison` | 185 ms | PASS |

Organization count blocker verification:

- Before: `Jumlah ormawa di ITB STIKOM Bali ada berapa?` returned `semantic-rag-meaning-verifier-blocked` and safe fallback.
- After: same semantic class returns `semantic-rag-ukm-count` with grounded organization count answer.
- Production latency after fix: 187 ms.
- No wrong domain/entity/fact observed.
- No raw evidence leak observed.
- No unsupported claim observed.

Log review:

- Startup/module/provider/RAG prewarm logs clean.
- One post-runtime `Redis Rate Limit Error: fetch failed` log was observed. Health remained 200 and smoke passed; classified as nonblocking infrastructure/log debt, not semantic correctness failure.

Final deployment validation status:

`DEPLOYED_VALIDATED`
