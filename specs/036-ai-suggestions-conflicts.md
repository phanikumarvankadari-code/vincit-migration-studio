# SPEC-036 AI Mapping Suggestions, Confidence, Conflicts and Deleting Mappings

> **Removed (branch `milestone/remove-suggestions`).** Mapping and structure suggestions, the AI provider and the pairing step were taken out to redesign them. The last version that has them is the tip of `main` before this branch (commit `78677c0`). What stays: conflict detection (type, length, reuse, empty source), delete with undo and the Hard-code button. AI, suggestions, confidence, value suggestions and the suggestion-disagree conflict are gone.

## Objective
Let a local AI model (Ollama) propose mappings next to the rule-based ones, show every suggestion with a confidence, show conflicts visually in the mapper and in the Mapping Table, and make deleting mappings easy and reversible. AI proposes, a person approves (PD-010): nothing is mapped without a click, and the runtime never depends on AI.

## Inputs
The project (source and target field metadata, existing mappings), the rule-based suggestions (SPEC-031), settings for a local Ollama server.

## Outputs
- `@mms/mapping-suggest`: AI prompt builder, response parser and merge with the rule-based suggestions. Pure, no network.
- `@mms/studio-model`: `detectConflicts`, `removeMappings`.
- App: AI settings, an AI suggest button, confidence and origin on every suggestion, conflict markers, delete and undo.

## Functional Requirements
1. **AI provider:** a local Ollama server (default `http://127.0.0.1:11434`). Settings (address, model) are kept in this browser only. A test button lists the installed models and shows a clear message when the server cannot be reached or has no model. Nothing is sent anywhere else.
2. **Data sent:** field metadata only: names, technical names, data types, lengths, key and required flags, group and description, and the rule-based candidate pairs. **No row values.** The settings dialog states this.
3. **AI suggest** asks the model, in batches of target fields, for the best source field of each unmapped target field with a confidence and a short reason. The model sees short ids; ids it makes up are discarded. It may answer "no match". The answer must be JSON; text around it is tolerated, anything else is reported, not guessed.
4. **Merging:** for each unmapped target field the rule-based and the AI answer are combined.
   - Same source: the higher confidence plus 5 points (at most 100%), origin "Rules and AI".
   - Different sources: the higher confidence wins, the other is kept as a conflict and shown as an alternative.
   - Only one of them: origin "Rules" or "AI". An AI-only confidence is capped at 95%.
5. **Confidence** is shown as a percentage and a band, never colour alone: High 80% or more, Medium 60 to 79%, Low below 60%. Origin is shown as a tag (Rules, AI, Rules and AI). Reasons are listed in words.
6. **Accept all** applies only High suggestions without a conflict. Each suggestion can be accepted or rejected on its own. Nothing is applied automatically.
7. **Conflicts** (computed from the project, not stored):
   - Type mismatch: a direct copy whose source type differs from the target type in a way that needs a conversion.
   - Length: a direct copy from a longer source field into a shorter target field (may be cut).
   - Source reused: one source field feeds several target fields of a structure (information).
   - Empty source: the source column is empty in the loaded rows, or a required target is fed from a column with blanks.
   - Suggestion conflict: rules and AI disagree for the same target field.
   Each has a severity (warning or information) and a plain message.
8. **Where conflicts show:**
   - Mapper: a warning marker on the target row and on the line; suggestion lines are dashed with the confidence on them, the second candidate of a conflict is drawn lighter; a Conflicts list under the toolbar lists them and selects the field on click.
   - Mapping Table: a Conflicts column with a count and the messages, a "Has conflicts" filter, and a Suggestion column showing the best source with its confidence and origin and Accept and Reject buttons.
9. **Deleting mappings:**
   - Mapping Table: a Remove button on every mapped row, checkboxes and **Delete selected** with a confirmation.
   - Mapper: Remove mapping in the field panel and the Delete key (existing).
   - Every delete shows **Undo** which restores the project as it was.

## Acceptance Criteria
- AC-1 The prompt holds metadata and rule candidates and no row values; ids are short and map back.
- AC-2 The parser accepts JSON in code fences or with text around it, scales 0 to 1 and 0 to 100 confidences, drops unknown ids and reports bad answers.
- AC-3 Merge: agreement raises confidence, disagreement keeps the stronger and records the other, AI-only is capped.
- AC-4 `detectConflicts` finds each kind and nothing for clean mappings. `removeMappings` removes several and leaves the rest.
- AC-5 Browser (Ollama mocked): AI suggest shows confidence bands and origins; conflicts appear in the mapper and the table; accepting and rejecting work; Accept all applies only High without conflict.
- AC-6 Browser: delete from the table (single and selected) and from the mapper, each with Undo.
- AC-7 Browser: an unreachable Ollama gives a clear message and the rule-based suggestions still work.

## Error Behavior
Unreachable server, no model, a timeout or an unreadable answer: a message with what to do; rule-based suggestions are unaffected.

## Out of Scope
Cloud AI providers, sending row values, learning from accepted or rejected suggestions, AI-written routines.

## Test Command
`npx vitest run packages/mapping-suggest packages/studio-model tests/milestones/m16-ai-suggest-conflicts` and `npm run e2e`.
