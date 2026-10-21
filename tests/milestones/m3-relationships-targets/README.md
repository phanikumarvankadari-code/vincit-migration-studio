# M3 Relationships and Targets: test cases

Packages: `packages/relationships`, `packages/target-parser`; completeness and row contracts in `packages/mapping-core`.
Specs: 006 relationship engine, 007 target structure parser, 008 multiple target structures.

## Milestone demo check (this folder)

| ID | Proves |
|---|---|
| M3-01 | Joins suggested on composite keys, status suggested, confirm gives confirmed |
| M3-02 | Sample data problems reported (no shared key values, blank client keys) |
| M3-03 | data_pc.XLSX loads via layout detection into 3 structures |
| M3-04 | Required fields, key fields, technical metadata preserved |
| M3-05 | Sources, relationships and targets form one valid Project; JSON round-trip equal |
| M3-06 | Completeness calculated independently per structure |

## Detailed tests

| Area | File |
|---|---|
| Relationships: analysis, observed cardinality, blank keys, checks and diagnostics, suggestions, confirm/reject, serialization | `packages/relationships/test/relationships.test.ts` |
| Target parser: reference workbook, generic layouts (section rows, column, per sheet), type map, errors and warnings, layout detection | `packages/target-parser/test/target-parser.test.ts` |
| Completeness per structure | `packages/mapping-core/test/completeness.test.ts` |
| Row contracts (source and target rows) | `packages/mapping-core/test/rows.test.ts` |
| Portability | `packages/*/test/boundaries.test.ts` |

No Playwright tests: M3 has no UI.
