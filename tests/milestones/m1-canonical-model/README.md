# M1 Canonical Model: test cases

Package: `packages/mapping-core`. Spec: `specs/001-canonical-mapping-model.md`.

## Milestone demo check (this folder)

| ID | Proves |
|---|---|
| M1-01 | Profit Center reference model parses, no reference issues |
| M1-02 | Save to JSON and load back equal |
| M1-03 | Composite relationship, one-to-many generation, parent link |
| M1-04 | All six mapping types representable |
| M1-05 | Bad reference returns structured error (code, path) |

## Acceptance criteria to tests (in `packages/mapping-core/test/`)

| AC | File |
|---|---|
| AC-001 three datasets coexist | source-target.test.ts |
| AC-002 composite relationship | source-target.test.ts |
| AC-003 three target structures | source-target.test.ts |
| AC-004 six mapping types | mapping.test.ts |
| AC-005 multiple source references | mapping.test.ts |
| AC-006 routine order preserved | mapping.test.ts, project-serialization.test.ts |
| AC-007 JSON round-trip | project-serialization.test.ts (plus golden `fixtures/profit-center.project.json`) |
| AC-008 structured validation failure | validation.test.ts |
| AC-009 no UI/browser/Power Platform/AI imports | boundaries.test.ts |

No Playwright tests: M1 has no UI.
