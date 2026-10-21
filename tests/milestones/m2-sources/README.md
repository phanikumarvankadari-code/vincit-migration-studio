# M2 Sources: test cases

Packages: `packages/file-import` (CSV, XLSX, field dictionary), `packages/profiler`.
Specs: 002 CSV importer, 003 Excel importer, 004 field dictionary importer, 005 source profiler.

## Milestone demo check (this folder)

| ID | Proves |
|---|---|
| M2-01 | Profit Center CSVs import to canonical output, no diagnostics |
| M2-02 | Dictionary enriches fields, display names kept |
| M2-03 | CEPC_BUKRS include placeholders skipped, 10 columns match 10 fields, no false mismatch |
| M2-04 | Fill %, inferred datatype, uniqueness, sample values |
| M2-05 | Profiling leaves rows unchanged |
| M2-06 | Excel workbook readable, blank header column reported |
| M2-07 | Generic CSV works without a dictionary |

## Detailed tests

| Area | File |
|---|---|
| CSV: blanks vs empty strings, leading zeros, quoted commas and line breaks, UTF-8/BOM, line endings, delimiter, malformed rows, empty file, fixtures | `packages/file-import/test/csv.test.ts` |
| XLSX: sheet discovery and selection, header row, empty cells, text and leading zeros, dates, error cells, failures, real workbook | `packages/file-import/test/xlsx.test.ts` |
| Dictionary: import, native type mapping, configurable columns, apply, count mismatch, ambiguity, generic files | `packages/file-import/test/dictionary.test.ts` |
| Profiler: counts, fill %, distinct, uniqueness, representative values, datatype inference, no mutation, failures | `packages/profiler/test/profile.test.ts` |
| Portability: no Node/DOM code in importers and profiler | `*/test/boundaries.test.ts` |

No Playwright tests: M2 has no UI.
