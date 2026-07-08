# Phase 2 Academic RAG Audit

Baseline run: `npm run audit:rag:academic`

Scope: answer quality, retrieval relevance, corpus coverage, and threshold tuning candidates. No orchestration changes were made.

## Summary

The academic path is now healthy on the representative sample set after retrieval and threshold tuning.

- `curriculum` now returns a grounded RAG answer.
- `career` now returns a grounded RAG answer with one strong supporting context.
- Control rows for tuition and requirements remain useful as reference points only.

## Results

| Label | Source | Top score | Contexts | Flags | Notes |
| --- | --- | ---: | ---: | --- | --- |
| program_list | `rag-lexical-fallback` | 0.398 | 1 | `lexical_fallback_source` | Answer exists, but it is generic and not deeply grounded. |
| curriculum | `gpt-4o-mini` | 0.668 | 2 | `ok` | Grounded answer with two supporting contexts. |
| career | `gpt-4o-mini` | 0.683 | 1 | `ok` | Grounded answer with one strong supporting context. |
| tuition | `rag-fee-breakdown` | n/a | 0 | `no_contexts` | Useful as a non-academic control, not part of the Phase 2 academic quality target. |
| requirements | `gpt-4o-mini` | 0.505 | 0 | `no_contexts` | Also a control row; answer exists but is not grounded in explicit retrieved contexts. |

## Findings

1. The curriculum path now retrieves the intended `Apa Yang Dipelajari` sections and answers with grounded content rather than a generic fallback prompt.
2. The career/prospect path now keeps enough supporting contexts to answer cleanly after lowering the academic retrieval floor.
3. The short title-only chunk noise was reduced by filtering non-substantive chunks before scoped academic scoring.

## Tuning Candidates

- Keep the current academic threshold at `RAG_ACADEMIC_MIN_SCORE = 0.50` unless future samples show hallucination or drift.
- Preserve the short-chunk filter in `ragScoped` so title-only vectors do not outrank substantive curriculum or career passages.
- Re-evaluate `RAG_TOP_K` only if future corpora add more career/curriculum sub-sections that should support multi-context synthesis.
- Preserve the current orchestration behavior. The problem in Phase 2 was answer quality and retrieval quality, not response routing.

## Next Step

If you want, the next narrow pass should be a corpus/indexing audit of the academic domain files that feed `ragScoped`, starting with curriculum and career/prospect chunks.