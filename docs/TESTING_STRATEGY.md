# Testing Strategy

This document defines how Migration Mapping Studio is tested. It complements `docs/DEVELOPMENT_WORKFLOW.md` (definition of done) and the acceptance criteria in each spec.

---

## 1. Principles

- Every spec acceptance criterion has at least one automated test. Name tests after the criterion (for example `AC-007 round-trips a complete mapping`).
- Core packages are tested without a UI, a browser, or a network.
- Tests are deterministic. No wall-clock time, randomness, or machine locale unless injected and fixed.
- Golden fixtures are never edited to make a broken implementation pass (see `docs/DEVELOPMENT_WORKFLOW.md` section 12).

---

## 2. Tools

| Purpose | Tool |
|---|---|
| Unit, contract and integration tests | Vitest (with `@vitest/coverage-v8`) |
| Type-level tests | Vitest `expectTypeOf` |
| Browser tests (UI milestones M7+) | Playwright |
| Static checks | `tsc` (strict), ESLint, Prettier |

---

## 3. Layout

```
packages/<name>/test/            unit and contract tests for that package
tests/milestones/<mN-name>/      stored test cases for each milestone (cross-package)
test-data/profit-center/         golden fixtures (input/, target/, expected/)
```

Each milestone has a folder under `tests/milestones/` containing:

- an automated test file that proves the milestone's demo check (see `docs/MILESTONES.md`),
- a short `README.md` listing the test cases and what each proves.

Test cases stay in the repository after the milestone is merged and keep running as regression tests.

---

## 4. Test Levels

1. **Unit:** one function or schema. Fast, no I/O.
2. **Contract:** public API of a package, including invalid input and error shapes (structured diagnostics, never thrown strings).
3. **Integration:** several packages together, using golden fixtures.
4. **End-to-end:** the Profit Center scenario (SPEC-029), and Playwright tests for UI milestones.

---

## 5. Required Test Categories per Feature

- Happy path.
- Invalid and missing input, with the exact diagnostic code.
- Null, empty string, and SAP zero-date (`00000000`) handling where relevant.
- Serialization round-trip where the feature has a persisted shape.
- Determinism: same input gives the same output (UUID v4 excepted).

---

## 6. Browser Tests (Playwright)

Applies to web-based milestones. Tests are stored under the milestone folder, run against a locally started app, and cover the user-visible demo check. A milestone with a UI is not complete until its Playwright tests pass.

---

## 7. Milestone Gate

A milestone is merged to `main` only when:

1. Its test cases are stored under `tests/milestones/<mN-name>/`.
2. `npm test`, `npm run typecheck` and `npm run lint` pass.
3. Playwright tests pass, if the milestone has a UI.
4. Coverage for the touched packages meets the target (initially 90% lines for `mapping-core`).
5. The milestone tracker is updated.

---

## 8. Core Boundary Checks

`mapping-core` must not import UI, browser, Power Platform or AI dependencies (SPEC-001 AC-009). An automated test scans its sources and `package.json`, and the TypeScript config excludes the DOM library and Node typings for source files.

---

## 9. Browser Tests in Practice

- Tool: Playwright (`@playwright/test`) with Chromium. Specs live in `apps/mapping-studio/e2e/*.spec.ts`; run `npm run e2e`. The Vite dev server is started automatically on 127.0.0.1:5173 (an already running one is reused).
- Select elements by role, accessible name or `data-testid`. Files are loaded through the real file inputs (`setInputFiles`), never by calling internal functions.
- Anything that is business logic is tested without a browser first (`packages/studio-model`). Browser tests prove the screens, not the rules.
- Test data: real fixtures for loading and profiling; small purpose-built files (see `e2e/helpers.ts`) for scenarios that need joinable values.
- Large-result behavior (virtualized grid) is tested with generated files of 5,000 and 100,001 rows.
