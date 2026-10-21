# M7 Screen: test cases

App: `apps/mapping-studio` (React 19, Fluent UI 9, React Flow 12, Vite). Pure model: `packages/studio-model`.
Specs: 021 shell, 022 mapping table, 023 React Flow view, 024 result grid, 025 validation and errors, 026 field lineage.

Run: `npm test` (unit and the check in this folder), `npm run e2e` (Playwright in Chromium, starts the dev server itself).

## What is tested where

| Layer | Where | Proves |
|---|---|---|
| Pure model (no browser) | `packages/studio-model/test/*.test.ts` | State reducer, imports into state, relationship suggestions kept in step, target auto-import, mapping drafts to canonical mappings (all five editor forms, plain-language problems, round trip back into the editor), table rows and status, graph projection and visual edits, stage status and readiness checklist, preview |
| Whole journey without a browser | `tests/milestones/m7-screen/m7-screen.test.ts` | The screen has no logic of its own: the journey runs through the same functions the screen calls |
| Screens in a real browser | `apps/mapping-studio/e2e/*.spec.ts` | What a user sees and does (below) |

## Milestone check (this folder)

| ID | Proves |
|---|---|
| M7-01 | Stage status follows the work |
| M7-02 | Dictionary enriches sources; the table lists all target fields; required unmapped fields are findable |
| M7-03 | Editor forms and a visual link give ordinary canonical mappings |
| M7-04 | Preview on real rows, including problems |
| M7-05 | Test run, traced cell and readiness come from the same state; changes mark results out of date |

## Playwright specs (`apps/mapping-studio/e2e/`)

| File | Cases |
|---|---|
| `shell-sources-target.spec.ts` | Shell: context and five stages with status, navigation keeps work, rename. Sources: load Profit Center files, profile (fill %), dictionary, suggested joins with reasons and warnings, confirm/reject/undo, join type, refused file types, removal, import warnings. Target: automatic header row and layout, correcting the reading, field list with flags, manual target, unrecognised file |
| `map-table.spec.ts` | Table: all fields with status, required-unmapped filter, structure filter and search. Editor: direct, constant (and datatype errors), lookup (fill from source, missing key explained, validation), condition, routine chain (settings checks, reorder, remove steps), needs review, edit again, remove. Structure settings: driver suggestion and parent link. Preview message when a driver is needed |
| `visual-mapper.spec.ts` | Canonical mapping rendered as a graph, drag to connect creates a mapping the table shows, existing mappings are not overwritten, select target to edit or remove, keyboard delete, per-structure pictures, layout remembered, joins picture with confirm |
| `test-stage.spec.ts` | Run summary per structure, grid with field metadata and structure tabs, Ready/Warning/Error filters, lineage for a lookup and a routine chain, plain-language errors with technical details on request, row inspector, problems list (collapsed repeats, jump to row, severity filter), out-of-date marking, spread and 1,000-row samples, 5,000-row virtualized grid, lineage left out of "all rows", "all rows" refused above 100,000, pre-flight list, readiness checklist and a fully clean run |

Fixtures: the real Profit Center files under `test-data/profit-center/` for loading and profiling; small joinable files built in `e2e/helpers.ts` for mapping and test scenarios (the Profit Center sample files share no key values).
