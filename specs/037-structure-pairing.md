# SPEC-037 Structure Pairing

> **Removed (branch `milestone/remove-suggestions`).** Mapping and structure suggestions, the AI provider and the pairing step were taken out to redesign them. The last version that has them is the tip of `main` before this branch (commit `78677c0`). What stays: the structure driver (`generation`) set in structure settings. The Structures step, pair suggestions and scoped mapper are gone.

## Objective
Map structure to structure first. Migrations happen between similar structures whose names differ, so the app proposes which source dataset feeds which target structure, a person confirms, and the field mapper then works inside that pair.

## Model
A confirmed pair is the structure's driver: `TargetStructure.generation.driverDatasetId` (SPEC-001, unchanged). Helpers are not stored: they are the datasets joined to the driver by a relationship that is not rejected. Suggested and rejected pairs live in the session. One dataset may drive several structures.

## Functional Requirements
1. **Rule pairing** (`@mms/mapping-suggest` `suggestStructurePairs`): for each structure and dataset, score = 0.5 coverage + 0.2 required coverage + 0.1 key coverage + 0.1 tightness + 0.1 name similarity. A target field is covered when its best source field scores 0.5 or more. Pairs below 0.3 are dropped. Helper candidates are datasets joined to the driver that cover fields the driver does not.
2. **AI pairing**: the prompt holds dataset and structure names and fields, never row values; short ids; the answer is JSON; unknown ids are dropped. Merge as SPEC-036: agreement +5 points, disagreement keeps the stronger and records the other as a conflict, AI-only capped at 95%.
3. **Structures step** in Map: datasets left, structures right, lines between them. Each suggestion shows confidence, origin, coverage and reasons, with Accept and Reject. Accept all High (80% or more, no conflict). Driver can be set by hand, changed and removed. Unpaired structures and unused datasets are highlighted. Every change has Undo.
4. **Fields step** is scoped: the driver and joined datasets first, other datasets closed and tagged. Rule and AI suggestions look in the scope first; other structures only on request, with the confidence times 0.85.
5. Without a pair the Fields step says so and links to the Structures step. The engine message ENGINE_NO_DRIVER points to the Structures step.

## Acceptance Criteria
- AC-1 Real Profit Center files pair by fields, also with every name changed.
- AC-2 A pair is saved as the structure's driver and survives save and open.
- AC-3 The AI prompt holds no row value.
- AC-4 Nothing is paired without a click.
- AC-5 Suggestions show confidence, origin and coverage; accept, reject, change and remove work with Undo.
- AC-6 A rules-versus-AI disagreement is a conflict and is not accepted in bulk.
- AC-7 The Fields step shows the pair first and limits AI questions to it.

Tests: `tests/milestones/m17-structure-pairing`, `apps/mapping-studio/e2e/structure-pairing.spec.ts`.
