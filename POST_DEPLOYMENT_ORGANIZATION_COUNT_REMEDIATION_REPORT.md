# Post-Deployment Organization Count Remediation Report

Generated: 2026-08-25

## Scope

Deployment validation found one material production semantic blocker:

- `organization/ORMAWA COUNT -> valid source-present answer -> blocked by meaning verifier -> safe fallback`

Regression example:

- `Jumlah ormawa di ITB STIKOM Bali ada berapa?`

The deployment artifact was otherwise healthy. This remediation did not change routing, retrieval, source data, RAG index, provider behavior, or answer text generation. The fix is limited to verifier semantics for grounded organization-family count answers.

## First Failure

Trace:

`query -> canonical COUNT organization request -> semantic-rag-ukm-count answer -> outbound meaning verifier -> semantic-rag-meaning-verifier-blocked -> safe fallback`

FIRST_FAILURE:

- `organization count answerability / meaning verifier`

The count route had compatible source-present evidence, but the verifier evaluated the answer with loose lexical mismatch rules instead of structured count semantics.

## General Fix

File changed:

- `src/engine/semanticRagEngine.js`

Added a narrow structured verifier helper for organization-family count answers. It accepts only answers that satisfy all of these constraints:

- source is the organization count route (`ukm-count`);
- user asks a count question;
- user asks about an organization family such as UKM, ORMAWA, organisasi mahasiswa, unit kegiatan mahasiswa, HIMAPRODI, HIMA, or himpunan mahasiswa;
- answer mentions the compatible organization family;
- answer contains a numeric count;
- subset wording such as HIMAPRODI/HIMA is preserved;
- wrong-domain terms such as Student Exchange, Double Degree, UKT, DPP, Gelombang, or Hi-Think are rejected;
- raw/admin/document markers are rejected.

This preserves rejection for fabricated counts, wrong organization family, wrong subset, unsupported counts, unrelated-domain evidence, and raw fragment leakage.

## Tests Added

- `tests/semanticRagEngine.organizationCountVerifier.test.js`

Coverage:

- generic ORMAWA count;
- UKM and organization-family count wording;
- HIMAPRODI/HIMA subset count;
- unrelated-domain evidence negative control;
- fabricated count negative control;
- non-organization count no-hijack control;
- outbound verifier acceptance for grounded `semantic-rag-ukm-count`.

## Local Validation

Validation after the production patch:

- Focused organization/count contracts: PASS, 5/5.
- Old 44-probe: PASS, 44/44.
- Blind #1 regression: PASS, 25/25.
- Blind #2 regression: PASS, 30/30.
- Blind #3 regression: PASS, 30/30.
- Blind #4 regression: PASS, 32/32.
- Blind #5 regression: PASS, 32/32.
- Blind #6 regression: PASS, 32/32.
- Source-derived 39: 33 grounded + 6 safe fallback.
- Fresh 20: 16 grounded + 4 safe fallback.
- Golden smoke: 37 total / 34 PASS / 3 EXPECTED_FALLBACK / 0 WRONG.
- Evidence: PASS, 56/56.
- Document-safety: PASS, 6/6.
- Schedule/provider: PASS, 12/12.
- Semantic: PASS, 13/13.
- Retrieval: PASS, 110/110.
- Full `npm test`: PASS natural; unit 365/365 + contract 94/94.
- Provider/webhook release parity: PASS, 2/2.

## Release Status

Ready to create a new release candidate commit and deploy that exact commit for protected non-sending production smoke.

Final local remediation status:

`ORGANIZATION_COUNT_VERIFIER_REMEDIATED_PENDING_DEPLOYMENT`
