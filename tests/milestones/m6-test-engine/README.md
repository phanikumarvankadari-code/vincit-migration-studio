# M6 Test Engine: test cases

Package: `packages/test-engine`; sampling hooks and driver reporting in `packages/transformation-engine`; spread sample in `packages/mapping-core`.
Spec: 020 mapping test engine. Also delivers the four key checks chosen for the first version.

## Milestone demo check (this folder)

Real importers, relationship confirmation, real target workbook, real routines, 1,200 generated rows with deliberate data problems.

| ID | Proves |
|---|---|
| M6-01 | Runs 100 rows by default, with counts |
| M6-02 | Runs 1,000 rows and all rows |
| M6-03 | "All rows" refused when not safe |
| M6-04 | The sample decides which problems show (first 100, 1,000, all, spread) |
| M6-05 | Diagnostics show row, field, mapping and routine; errors do not hide successful rows |
| M6-06 | Diagnostics list collapses repeats and links to rows |
| M6-07 | Duplicate target key and missing parent found |
| M6-08 | Parent check skipped (and said so) when the parent was only sampled |
| M6-09 | Unmapped required fields warned once, no per-row noise |
| M6-10 | Unconfirmed relationship flagged before the run |
| M6-11 | Deterministic |
| M6-12 | Lineage on for samples up to 1,000 rows, off for all |
| M6-13 | Snapshot test runs |

## Detailed tests

| Area | File |
|---|---|
| Sample selection, result packaging, failed runs, key checks, pre-flight, driver suggestion, snapshots | `packages/test-engine/test/test-engine.test.ts` |
| Engine sampling hooks and driver reporting | `packages/transformation-engine/test/engine.test.ts` ("sampling hooks") |
| Spread sample contract | `packages/mapping-core/test/snapshot-run.test.ts` |
| Portability | `packages/test-engine/test/boundaries.test.ts` |

No Playwright tests: M6 has no UI.
