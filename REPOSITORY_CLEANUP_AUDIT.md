# Repository Cleanup Audit

Generated: 2026-08-24

Status: `CLEANUP_AUDIT_COMPLETE`

No production behavior was changed during this cleanup phase.

## Cleanup Actions

Archived to ignored local workspace path:

- `tmp/release_cleanup_archive_2026-08-24/`

Archived contents:

- `.agents/`
- untracked `scripts/PHASE_*`
- untracked `scripts/phase_*`
- untracked `scripts/patch_*`
- `scripts/facility_prefilter_prototype_validation.js`

Reason: these files were remediation/debug/prototype artifacts and were not release-gating runtime files.

## Classification Summary

| Category | Files / Areas | Action |
|---|---|---|
| KEEP_PRODUCTION | `src/routes/provider.js`, `src/engine/queryUnderstanding.js`, `src/engine/semanticRagEngine.js`, `src/engine/feeComparisonEngine.js`, `src/engine/hardMetadataGates.js`, `src/engine/ragTechniquePipeline.js`, `src/utils/answerPreflightEvaluator.js`, runtime source manifests | Kept |
| KEEP_REGRESSION | Blind #1-#6 runners/results, old 44 probe, source-derived probe, fresh holdout contracts, focused knowledge contracts | Kept |
| KEEP_RELEASE_GATE | Golden smoke, evidence, document-safety, schedule/provider, semantic, retrieval, provider release parity, `npm test` suites | Kept |
| KEEP_DOCUMENTATION | phase reports, root-cause matrices, architecture audits, readiness reports | Kept |
| ARCHIVE | untracked phase/patch/prototype scripts and `.agents/` | Moved to ignored archive |
| SAFE_TO_DELETE | none executed | No deletion performed |

## Tmp / Debug Policy

The `tmp/` directory remains ignored and contains historical audit outputs, blind evidence, traces, and archived remediation helpers. These files do not affect production runtime unless explicitly invoked by a release gate. Regression runners/results used as release evidence were retained.

## RAG Index Policy

`src/data/rag_index.json` exists locally for runtime parity and has the validated SHA256:

`FA21B6D8ECC7B1F352DE34E28E77D757F77F808DBE0A9707E6466E27281DC0B9`

It is intentionally not tracked by Git and remains excluded by `.gitignore`, consistent with the no-public-index deployment constraint.

## Result

Cleanup did not remove any release-gating regression suite or production runtime dependency.
