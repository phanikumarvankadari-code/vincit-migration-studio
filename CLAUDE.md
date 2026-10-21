# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

M0 (tooling, docs) and M1 (SPEC-001 canonical model, `packages/mapping-core`) are done. Next: M2 sources (SPEC-002 to 005). Milestone plan: `docs/MILESTONES.md`. Agent rules: `AGENTS.md`. Model decisions: `docs/ARCHITECTURE.md` section 14.

## Commands

```bash
npm test                 # vitest run (tests/** and packages/*/test/**)
npx vitest run tests/milestones/m0-setup/m0-setup.test.ts   # single file
npx vitest run -t "M0-02"                                   # single test by name
npm run typecheck        # tsc for tests and for packages/mapping-core src (no DOM/Node types)
npm run lint             # eslint
npm run coverage         # v8 coverage
```

## Milestone Workflow

One branch per milestone (`milestone/mN-name`). Merge to `main` only after tests pass. Test cases for each milestone live in `tests/milestones/<mN-name>/` (with a README). Playwright for web milestones. No git remote yet; do not push. A separate Python tracker is at `../milestone-tracker/` (outside Git): update item statuses as work completes.

Sample fixtures (Profit Center): `test-data/profit-center/{input,target}/`. CEPC_BUKRS.csv has 10 columns but the dictionary lists 12 fields, which is intentional warning-case data. Source CSV headers are display names; link to dictionary fields by column position.

## What the Product Is

Migration Mapping Studio: local-first app for data migration consultants. Load CSV/XLSX sources, define target structures, map fields with routines/constants/lookups/conditions (sandboxed JS as escape hatch), test and preview in-app, trace lineage, save named snapshots, run full datasets, export CSV/XLSX. Reference scenario: SAP ECC Profit Center → S/4HANA (targets: Profit Center, Company Codes, Translation). Engine must stay generic — no Profit-Center-specific logic.

## Source-of-Truth Order (docs/DEVELOPMENT_WORKFLOW.md)

1. Approved spec in `specs/`
2. `docs/ARCHITECTURE.md`
3. `docs/PRODUCT_DECISIONS.md`
4. `PRD.md`
5. Existing interfaces and tests

Implement only the requested spec scope. Specs should contain: objective, inputs, outputs, dependencies, functional reqs, acceptance criteria, fixtures, error behavior, test command, out-of-scope, DoD.

## Architecture Rules (big picture)

- **Canonical mapping model is the center.** Technology-independent. No dependency on React, React Flow, Power Apps, AI provider, or a DB technology.
- **Layering:** import adapters (CSV/XLSX) → source model → profiler/relationships → canonical mapping model (+ routines, lookups, conditions) → transformation engine → target datasets + diagnostics + lineage → test/validate/export. File formats are adapters only, not internal representation.
- **Planned packages** (`packages/`): `mapping-core` (types/contracts), `file-import`, `profiler`, `transformation-engine`, `routine-library`, `test-engine`. App lives in `apps/mapping-studio/`. Core packages must never import from the app.
- **UI owns no business logic.** An approved mapping must be executable without React Flow initialized. React Flow is visualization only (lineage, relationships, routine chains), not the serialization format. Mapping Table is the primary UX.
- **Deterministic execution:** same sources + snapshot + routines → same output. Exception: UUID v4 routine.
- **Targets are multi-structure** (one source object may produce several target tables).
- **Transformation preference order:** direct → constant → built-in routine → lookup → conditional → shared routine → custom JS.
- **Custom JS must be sandboxed:** no filesystem, network, process, OS, or credential access.
- **AI proposes, humans approve.** Runtime never depends on AI.
- **Diagnostics contract:** severity, error code, message, dataset, source row/field/value, target structure/field, mapping ID, routine ID, technical details (not all required each time).
- **Later layers (SharePoint, Power Automate, PCF/Power Apps)** must execute existing approved mappings, never add mapping semantics or run row-by-row transforms.

## Do Not Silently Change

Canonical source/target model, mapping semantics, routine contract, snapshot semantics, execution semantics. If a spec forces a change: explain why, list affected components, update architecture docs and impacted specs, add compatibility handling.

## Conventions

- Branches: short-lived, `feature/spec-NNN-<name>`.
- Commits: conventional style with scope, e.g. `feat(mapping-core): add canonical source dataset model`, `fix(date): reject ambiguous unconfigured short dates`.
- Golden fixtures: sanitized Profit Center files go under `test-data/profit-center/`. Don't edit them to make a broken implementation pass; if wrong, document and change intentionally.
- Completion report should list: files created/modified, design decisions, tests added/run/results, assumptions, unresolved issues.
- Planner tracks work status; Git holds the contract (PRD, specs, code, tests).

## Stray Data

`../data/audit.jsonl` sits outside the repo (parent dir `Migration MappingStudio/data/`); not part of this project's source.
