# Development Workflow

## 1. Purpose

This document defines how Migration Mapping Studio development work moves from product requirement to tested implementation.

---

## 2. Source-of-Truth Hierarchy

When implementing a feature use this order:

1. Approved specification under `/specs`
2. Architecture documentation
3. Product Decisions
4. PRD
5. Existing interfaces and automated tests
6. Planner description

Planner tracks the work.

Git defines the implementation contract.

---

## 3. Development Flow

Planner Task
    |
    v
Implementation Specification
    |
    v
Developer / Coding Agent
    |
    v
Implementation
    |
    v
Unit / Component Tests
    |
    v
Integration Tests
    |
    v
Code Review
    |
    v
Merge
    |
    v
Planner Task Complete

---

## 4. Specification Requirements

Every independently developable component should have a specification containing:

- Objective
- Inputs
- Outputs
- Dependencies
- Functional requirements
- Acceptance criteria
- Test fixtures
- Error behavior
- Test command
- Out-of-scope items
- Definition of Done

---

## 5. Component Development Principle

A component should generally follow:

Input
    ↓
Component
    ↓
Output
    ↓
Automated Verification

Example:

CEPC.csv
    ↓
CSV Importer
    ↓
SourceDataset
    ↓
Automated Tests

---

## 6. Coding Agent Workflow

Before implementation:

1. Read `CLAUDE.md`.
2. Read `AGENTS.md`.
3. Read `PRD.md` when necessary.
4. Read `docs/ARCHITECTURE.md`.
5. Read `docs/PRODUCT_DECISIONS.md`.
6. Read the relevant specification completely.
7. Inspect existing interfaces.
8. Inspect relevant tests.
9. Inspect referenced test fixtures.

Then implement only the requested scope.

---

## 7. Coding Agent Completion Report

At completion report:

1. Files created
2. Files modified
3. Design decisions made
4. Tests added
5. Tests executed
6. Test results
7. Assumptions
8. Unresolved issues

---

## 8. Architectural Changes

An implementation task must not silently change:

- canonical source model
- canonical target model
- mapping semantics
- routine contract
- snapshot semantics
- execution semantics

If a specification requires such a change:

1. Explain why.
2. Identify affected components.
3. Update architecture documentation.
4. Update impacted specifications.
5. Add migration/compatibility handling where required.

---

## 9. Branching Recommendation

Use short-lived feature branches.

Examples:

feature/spec-001-canonical-model
feature/spec-002-csv-importer
feature/spec-014-date-routines
feature/spec-022-mapping-table

Avoid long-lived developer branches.

---

## 10. Commit Style

Examples:

feat(mapping-core): add canonical source dataset model

feat(import): add CSV source importer

feat(routines): add deterministic UUID routine

test(mapping-core): add serialization roundtrip coverage

fix(date): reject ambiguous unconfigured short dates

docs(architecture): clarify React Flow boundary

---

## 11. Definition of Done

A development item is complete when:

- Acceptance criteria pass.
- Required automated tests exist.
- Existing affected tests pass.
- Errors are handled.
- Documentation is updated.
- No unrelated scope was introduced.
- Code was reviewed.
- Security-sensitive behavior was considered.
- Planner can be updated to Completed.

---

## 12. Profit Center Reference Data

Use sanitized representative files under:

test-data/profit-center/

These fixtures provide the initial common test scenario available to all developers and coding agents.

Do not alter golden fixtures only to accommodate broken implementation.

If the fixture is incorrect, document the reason and update it intentionally.