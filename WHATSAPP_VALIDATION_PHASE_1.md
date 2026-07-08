# WhatsApp Validation Phase 1

Goal: validate real-world WhatsApp behavior after orchestration stabilization.

## Invariants

- Exactly one outbound response per inbound request.
- No duplicated response.
- No fallback override after `FINAL_SEND`.
- `FINAL_ROUTE_DECISION` remains stable.
- Production logs to watch: `FINAL_SEND`, `FINAL_ROUTE_DECISION`.

## Test Matrix

| Query | Intent family | Current route family to verify | Primary checks | Notes |
| --- | --- | --- | --- | --- |
| `prodi apa saja yang ada di stikom?` | Program list | `program_list` / registration flow | One outbound, no fallback override, final source not duplicated | Existing deterministic coverage already exists. |
| `di sistem informasi belajar apa saja?` | Academic curriculum | `academic_rag` family | One outbound, grounded academic answer, no fallback override | In current handler this may surface as `pending_semantic_suggestion` or `program_pick_detail_rag` depending context; validate the academic path does not duplicate or fall through. |
| `prospek kerja TI bagaimana?` | Academic career/prospect | `academic_rag` family | One outbound, answer grounded in curriculum/prospect corpus, no fallback override | Watch `topScore` / `confidenceScore` when auditing answer quality. |
| `berapa biaya SI?` | Tuition / fee | `registration_flow` / fee path | One outbound, stable final route, no fallback override | If the first turn requests a follow-up program choice, validate the second turn after `SI`/`S1`. |
| `syarat pendaftaran apa saja?` | Requirements | `registration_flow` | One outbound, requirements answer, no fallback override | Ensure the answer comes from the registration/requirements path, not fee breakdown. |

## Validation Steps

1. Send one query at a time from WhatsApp.
2. Confirm the bot sends exactly one outbound message.
3. Check logs for `FINAL_SEND` and the final `FINAL_ROUTE_DECISION`.
4. Confirm the final source is not `fallback`.
5. Repeat the same query once to ensure no duplicate response race appears.

## Academic RAG Audit Notes

- Track `topScore`, `confidenceScore`, `contextCount`, and whether `answer` is present.
- Investigate cases where score is high but the answer is weak or null.
- If academic answers are too shallow, review curriculum/prospect corpus coverage and chunk granularity.
- Tune `RAG_ACADEMIC_MIN_SCORE` and `RAG_TOP_K` only after collecting real query samples.

## Logging Policy

Keep:

- `FINAL_SEND`
- `FINAL_ROUTE_DECISION`
- `fallback_suppressed` when needed

Keep verbose orchestration traces only when debugging is explicitly enabled.
