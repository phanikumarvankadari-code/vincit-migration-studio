# M0 Setup and Cleanup: test cases

| ID | Proves |
|---|---|
| M0-01 | Required project files exist (AGENTS.md, CLAUDE.md, PRD, .nvmrc, milestone plan) |
| M0-02 | No duplicated stub headers in docs or SPEC-001 |
| M0-03 | TESTING_STRATEGY is a real document, not a copy of the workflow |
| M0-04 | PD-003 amended: Table and Visual Mapper are equal views |
| M0-05 | Profit Center golden fixtures present |

Run: `npm test`. Also required for the gate: `npm run typecheck` and `npm run lint`.
No Playwright tests: M0 has no UI.
