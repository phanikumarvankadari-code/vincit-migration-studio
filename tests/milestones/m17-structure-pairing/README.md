# M17 — Structure pairing (SPEC-037)

The Map stage starts with structures: which source dataset feeds which target structure, even when the names differ. Fields come second, in the scope of the pair. A confirmed pair is the structure's driver (`TargetStructure.generation`); helpers are the datasets joined to the driver.

| Case | Proves |
|---|---|
| M17-01 | On the real Profit Center files CEPC drives Profit Center, CEPC_BUKRS drives Company Codes, CEPCT drives Translation, by fields. |
| M17-02 | With every dataset and structure renamed the same pairs come out: names do not matter. |
| M17-03 | A pair is `generation.driverDatasetId`; the scope is the driver plus joined datasets; removing the pair clears it. |
| M17-04 | The AI question holds names and fields and no row value; a disagreement with the rules is kept as a conflict. |

Package tests: `packages/mapping-suggest/test/ai.test.ts` (pairing, helpers, AI prompt, merge, scoped suggestions) and `packages/studio-model/test/pairing.test.ts`.

Browser tests (`apps/mapping-studio/e2e/structure-pairing.spec.ts`, Ollama mocked with `page.route`):
- the Structures step lists datasets and structures and flags structures with no source;
- suggested pairs show confidence, origin, coverage and reasons; accept pairs; Accept all High leaves Medium and conflicts for a click; Undo;
- set by hand, change the driver, remove, each with Undo; a helper's join can be confirmed there;
- AI suggest pairs: names and fields only, disagreement is a conflict and is not accepted in bulk; unreachable model keeps the rules;
- Fields step: the pair first, datasets of other structures closed and tagged, joined datasets tagged Joined, AI questions limited to the pair; no pair gives a hint with a button to the Structures step.

Fixed on the way: `aiSuggest` did not pass the pair's datasets to the prompt builder, so the model was asked about every dataset.

## M17b — real Ollama, tidy reasons

- `apps/mapping-studio/e2e/ai-real-ollama.spec.ts` has an opt-in test for pair suggestions on the real Profit Center files (`MMS_REAL_OLLAMA=1 npm run e2e -- ai-real-ollama`). With `gemma4:latest` it answers in about 5 s; CEPC drives Profit Center (95%, Rules and AI), CEPC_BUKRS drives Company Codes (80%), CEPCT drives Translation.
- Ids the model repeats in its reason (d1, t2) are shown as dataset and structure names.
- Playwright runs with 5 workers; fewer load-related timeouts in the full run.
