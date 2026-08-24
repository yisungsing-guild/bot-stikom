# Dead Code Audit

Generated: 2026-08-24

Status: `NO_RELEASE_BLOCKING_DEAD_CODE`

No production code was removed in this phase.

## Production Path Classification

| Area | Classification | Notes |
|---|---|---|
| `src/routes/provider.js` webhook entry, outbound handling, release parity path | ACTIVE_PRODUCTION | Required for production-equivalent validation. |
| `src/engine/queryUnderstanding.js` | ACTIVE_PRODUCTION | Canonical semantic authority. |
| `src/engine/semanticRagEngine.js` | ACTIVE_PRODUCTION | Main semantic/RAG routing and answer composition path. |
| `src/engine/feeComparisonEngine.js` | ACTIVE_PRODUCTION | Fee and comparison support path. |
| `src/utils/answerPreflightEvaluator.js` | ACTIVE_PRODUCTION | Final safety/output invariant. |
| PMB deterministic schedule/open handlers | ACTIVE_PRODUCTION | Intentional fast deterministic route for trusted PMB schedule behavior. |
| Generic RAG fallback paths | ACTIVE_PRODUCTION | Still needed after specific canonical routes decline or lack evidence. |
| Provider debug/global trace outputs and tmp parity artifacts | NONBLOCKING_DEBT / TEST_ONLY | Release-gating evidence exists; runtime-impacting behavior not found. |
| Legacy RAG mega-suite expectations | TEST_DEBT | Historical assertions/source labels are not release-gating production blockers. |
| `NODE_ENV === 'test'` semantic fallback branch | TEST_ONLY | Does not affect production `NODE_ENV=production`. |

## Bypass Audit Result

No release-blocking path was found that bypasses all of:

- canonical query understanding,
- route/evidence compatibility,
- composer/requested-field preservation,
- verifier/preflight safety,
- provider/webhook parity.

## Remaining Nonblocking Debt

- Some provider telemetry/debug logs remain noisy in tests.
- Legacy tests and tmp traces are still present for audit history.
- Some raw-regex fallback ownership remains a future maintainability item, but no active production correctness defect was proven in the final audit.
