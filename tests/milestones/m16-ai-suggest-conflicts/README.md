# M16 — AI suggestions, confidence, conflicts, hard-coded values and delete (SPEC-036)

AI proposes, a person approves. The AI is a local Ollama model by default, or Anthropic's API with the user's own key. Only field metadata is sent, never row values.

| Case | Proves |
|---|---|
| M16-01 | The prompts built from the real Profit Center files hold metadata and rule hints and no row value. |
| M16-02 | A model answer is merged with the rules: agreement raises confidence, disagreement is kept as a conflict, an AI-only answer is capped. |
| M16-03 | A mapping in place has a confidence band like a suggestion; reused sources are information. |
| M16-04 | Several mappings are deleted in one edit; the earlier project is the undo. |

Package tests: `packages/mapping-suggest/test/` (prompts, parser, merge, bands, mapping confidence, value suggestions) and `packages/studio-model/test/conflicts.test.ts` (conflict kinds, bulk remove).

Browser tests (`apps/mapping-studio/e2e/ai-suggestions.spec.ts`, the model mocked with `page.route`):
- AI suggest shows confidence bands, origin tags and band-coloured dashed lines; no row values are sent;
- a rules-versus-AI disagreement is a conflict in the mapper (second line, tag, list, marker) and in the table (column, filter, suggestion cell);
- Accept all applies only High without conflict; accept and reject in the mapper and the table;
- unreachable model: clear message, rules still work; settings test connection and model choice;
- API key (Anthropic): sent as a header, kept in this browser, never with row values; a refused key is reported;
- mappings in place: line and target capsule coloured by confidence, the capsule opens the mapping to review;
- hard-coded values: rule suggests 9999-12-31 for an end date; AI suggests a date from context; an invalid date cannot be used; Hard-code from the mapper and the table;
- delete: table row, selected rows with confirmation, select all, mapper button and Delete key, each with Undo.
