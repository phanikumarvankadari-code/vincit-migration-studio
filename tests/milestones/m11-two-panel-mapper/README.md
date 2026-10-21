# M11 — Two-panel mapper and mapping suggestions (SPEC-031)

Replaces the node-graph Visual Mapper with a mapper in the style of SAP CPI message mapping, and adds system suggestions.

| Case | Proves |
|---|---|
| M11-01 | On the real Profit Center files the engine proposes the obvious sources (key fields, dates, company code, language) with scores and reasons. |
| M11-02 | A partial name match scores lower than an exact one. |
| M11-03 | Accepting applies direct mappings in one edit, never overwrites an existing mapping, and leaves nothing more to suggest. |
| M11-04 | Applying suggestions does not change the project it was given. |

Package tests: `packages/mapping-suggest/test/` (AC-1 to AC-4 and the boundary check).

Browser tests (`apps/mapping-studio/e2e/visual-mapper.spec.ts`, `project-library.spec.ts`): two panels with all sources and targets; lines for mappings; function box for a routine chain and for a constant; drag and click-to-connect; no overwrite; select, edit, remove, Delete key; hidden or collapsed sources keep their line; search and filters; structure switch; Suggest, Accept and Reject; Accept all at 70% or more on the real files; the joins picture; Fresh start.

Also added in this milestone: a **Fresh start** button in the header. It starts a new project (the old one stays in Projects) and reloads the whole screen so nothing from the previous project is left on screen.
