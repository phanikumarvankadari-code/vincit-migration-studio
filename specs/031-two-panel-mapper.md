# SPEC-031 Two-Panel Mapper and Mapping Suggestions

> **Removed (branch `milestone/remove-suggestions`).** Mapping and structure suggestions, the AI provider and the pairing step were taken out to redesign them. The last version that has them is the tip of `main` before this branch (commit `78677c0`). What stays: the two-panel mapper (drag, click, lines, edit, remove). Suggestions and `@mms/mapping-suggest` are gone.

## Objective
Replace the node-graph Visual Mapper with a two-panel mapper in the style of SAP CPI message mapping: sources on the left, target fields on the right, lines between them. The system proposes mappings; the user accepts or rejects each one (PD-010).

## Inputs
The project (source datasets, target structures, mappings), optionally the row data of the sources.

## Outputs
- `@mms/mapping-suggest`: `suggestMappings(project, options)` returns ranked, explained suggestions for unmapped target fields. Pure, deterministic, no UI, no AI.
- `@mms/studio-model`: `applySuggestions(project, items, at)` turns accepted suggestions into direct mappings in one edit.
- App: the Visual Mapper tab shows the two-panel mapper. "Joins between datasets" stays as the second picture.

## Functional Requirements
1. Left panel: source datasets as collapsible groups, each field with data type, length, key marker and fill %. Search box. Right panel: fields of one chosen target structure with required and key markers and a mapping status. Search box and a filter (all, unmapped, required unmapped).
2. Every mapping is a line from each of its source fields to its target field. A mapping that is not a plain direct copy (constant, lookup, condition, routine chain, JavaScript) carries a function box on the line, labelled with the transformation. A constant has no source line, only its box.
3. Create a mapping by dragging a source field onto a target field, or by clicking a source field and then a target field. A target that already has a mapping is never overwritten.
4. Selecting a target field, a line or a function box opens a panel with its source, transformation and status, with Edit mapping and Remove mapping. Edit opens the same editor as the Mapping Table.
5. Fields that are scrolled out of sight or hidden by a filter keep their lines, pinned to the edge of the panel or to the dataset header.
6. Suggest mappings: a button asks the engine for suggestions for the unmapped target fields of the chosen structure. Each is drawn as a dashed line with its score and listed with its reasons. Accept turns it into a mapping. Reject drops it. Accept all at 70% or more accepts the strong ones in one step. Nothing is applied without a user action.
7. Suggestion scoring uses: same technical name, same display name, shared words in names and description, same data type, key on both sides, length fit, and (when rows are loaded) an empty source column counts against a suggestion. The best candidate per target field is returned with up to two alternatives. Only fields without a mapping get suggestions. Scores are 0 to 1. Default minimum 0.5.
8. Order and ties are deterministic: structure order, field order, then source order.

## Acceptance Criteria
- AC-1 CEPC Profit Center, Valid From and Country are suggested for the matching target fields with reasons; an already mapped target gets none.
- AC-2 A target with no similar source gets no suggestion at or above the minimum.
- AC-3 An empty source column is ranked below a filled one with the same name score.
- AC-4 Same input gives the same output.
- AC-5 `applySuggestions` creates direct mappings, skips targets that are already mapped, and reports how many it applied and skipped.
- AC-6 Browser: sources and targets are visible on both sides; a drag creates a mapping that the Mapping Table also shows; a mapping with a routine shows its function box; selecting a target offers edit and remove; suggest, accept and reject work; Accept all applies only strong suggestions.

## Error Behavior
Dropping a source on an already mapped target shows a message and changes nothing. Suggesting with no target or no sources returns an empty list.

## Out of Scope
AI-assisted suggestions, dragging routines from a palette onto a line, value preview on the line. These can follow.

## Test Command
`npx vitest run packages/mapping-suggest tests/milestones/m11-two-panel-mapper` and `npm run e2e`.
