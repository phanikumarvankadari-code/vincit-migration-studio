# AGENTS.md

Instructions for coding agents working in this repository. `CLAUDE.md` has the project overview and architecture rules. Read it first.

## Before implementing

1. Read `CLAUDE.md`.
2. Read `docs/ARCHITECTURE.md` and `docs/PRODUCT_DECISIONS.md`.
3. Read the relevant spec in `specs/` completely. Spec wins over PRD when they differ.
4. Inspect existing interfaces, tests and fixtures.
5. Implement only the requested scope.

## Workflow

- One branch per milestone (see `docs/MILESTONES.md`), for example `milestone/m1-canonical-model`.
- Merge to `main` only after the milestone's tests pass (`docs/TESTING_STRATEGY.md` section 7).
- Store each milestone's test cases under `tests/milestones/<mN-name>/`.
- Web-based milestones are tested with Playwright.
- Commit style: `feat(mapping-core): ...`, `fix(...)`, `docs(...)`, `test(...)`, `chore(...)`.
- No remote is configured yet. Do not push until one is added.

## Do not

- Change canonical model, mapping semantics, routine contract, snapshot or execution semantics silently (`docs/DEVELOPMENT_WORKFLOW.md` section 8).
- Edit golden fixtures in `test-data/` to make an implementation pass.
- Import React, React Flow, Power Platform, browser DOM or AI SDKs into `packages/mapping-core`.

## Completion report

List: files created, files modified, design decisions, tests added, tests run, results, assumptions, unresolved issues.
