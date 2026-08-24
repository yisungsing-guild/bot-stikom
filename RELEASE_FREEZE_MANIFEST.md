# Release Freeze Manifest

Generated: 2026-08-24

Final verdict: `RELEASE_CANDIDATE_VALIDATED_READY_FOR_DEPLOYMENT_REVIEW`

No deployment was performed.

## Git / Artifact State

- HEAD at validation: `be5e7a3b5d8e91b1d3bc1e1061471380eb4ec3bb`
- Worktree at validation contained tracked release-candidate modifications in production/report/test evidence files.
- `src/data/rag_index.json` is present locally but is not tracked by Git.
- `.env` and `.env.*` remain ignored; no secret values were recorded.

Tracked release-candidate modifications at validation:

- `BEFORE_AFTER_ROOT_CAUSE_MATRIX.md`
- `LIVE_PRODUCTION_ROOT_CAUSE_REMEDIATION_REPORT.md`
- `MASTER_IMPLEMENTATION_REPORT.md`
- `src/engine/feeComparisonEngine.js`
- `src/engine/queryUnderstanding.js`
- `src/engine/semanticRagEngine.js`
- `src/routes/provider.js`
- `src/utils/answerPreflightEvaluator.js`
- `tests/semanticRagEngine.performanceAsyncContracts.test.js`
- `tmp/provider_real_flow_results.json`

## Production Runtime

- Entrypoint: `src/index.js`
- Production start command: `npm run start:prod`
- Node engine contract: `>=20.0.0`
- Production secrets: platform-provided environment variables only; not baked into repository.

## RAG / Corpus Freeze

Validated local runtime index:

- `src/data/rag_index.json`
- SHA256: `FA21B6D8ECC7B1F352DE34E28E77D757F77F808DBE0A9707E6466E27281DC0B9`
- Git-tracked: no

Deployment strategy:

- Do not publish `src/data/rag_index.json` to the public GitHub repository.
- Provide the same index by private artifact, volume, private storage, or verified runtime sync.
- Recheck SHA256 and RAG health after runtime index is available.

## Final Mandatory Gate Results

All gates were rerun after cleanup. No old PASS was reused.

| Gate | Result |
|---|---|
| Blind #1 regression | 25/25 accepted outcomes |
| Blind #2 regression | 30/30 accepted outcomes |
| Blind #3 regression | PASS, exit 0 |
| Blind #4 regression | 32 total / 28 PASS_GROUNDED / 4 PASS_SAFE_FALLBACK |
| Blind #5 regression | 32 total / 28 PASS_GROUNDED / 4 PASS_SAFE_FALLBACK |
| Blind #6 regression | 32 total / 30 PASS_GROUNDED / 2 PASS_SAFE_FALLBACK |
| Old 44 | 44/44 PASS |
| Source-derived 39 | 33 grounded + 6 safe fallback |
| Fresh 20 + focused knowledge contracts | 35/35 PASS |
| Golden smoke | 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG |
| Golden `pmb_still_open` latency | 625 ms |
| Evidence | 56/56 PASS |
| Document safety | 6/6 PASS |
| Schedule/provider | 12/12 PASS |
| Semantic | 13/13 PASS |
| Retrieval | 110/110 PASS |
| Provider/webhook parity | 2/2 PASS |
| `npm test` | unit 365/365 PASS + contract 94/94 PASS |

## Cleanup Summary

- Untracked remediation/debug/prototype scripts were archived to `tmp/release_cleanup_archive_2026-08-24/`.
- No release-gating regression suite was deleted.
- No production behavior was changed by cleanup.
- No deployment was performed.

## Remaining Documented Nonblocking Debt

- Legacy RAG assertions/source labels remain historical debt and are not release-gating.
- Provider debug/tmp trace artifacts remain useful for release evidence but should not be exposed publicly.
- `src/data/rag_index.json` must remain outside public Git and be supplied privately at deployment time.
