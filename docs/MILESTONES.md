# Milestones

Draft for review. Built from PRD §30 (Phases A–E) and `specs/001`–`029`.
Phase A = core engine, no screen (M0–M6). Phase B = screen (M7–M8). M9 packages the finished local app as a container. Phases C–E (Power Apps, AI, automation) are later.

Each milestone ends with a demo check: something you can run or see.

| # | Milestone | Specs | Demo check |
|---|---|---|---|
| M0 | Setup and cleanup | – | `npm test` and `npm run typecheck` pass on an empty package. Docs cleaned, `AGENTS.md` added. |
| M1 | Canonical model | 001 | Profit Center model built in a test, saved to JSON, loaded back equal. Bad references return structured errors. |
| M2 | Sources | 002 CSV, 003 Excel, 004 field dictionary, 005 profiler | CEPC, CEPCT, CEPC_BUKRS and the dictionary load. Fields show type, key flag, fill % and sample values. CEPC_BUKRS dictionary has 2 include placeholders; they are skipped and its 10 columns match the 10 real fields. |
| M3 | Relationships and targets | 006 relationships, 007 target parser, 008 multi-structure | Joins suggested and confirmed (composite PRCTR + KOKRS). `data_pc.XLSX` loads through the layout wizard into 3 structures. |
| M4 | Mapping types | 009 direct, 010 constant, 011 lookup, 012 conditional, 013 one-to-many | One Profit Center produces several Company Code rows. Lookup, constant and conditional give correct values. |
| M5 | Routines | 014 dates, 015 UUID, 016 text, 017 numeric, 018 chaining, 019 JS sandbox | `1/1/26` converts only with explicit format. Chain runs in order. Sandboxed JS cannot reach files or network. |
| M6 | Test engine | 020 | Run 100 / 1,000 / all rows against a mapping, no screen. Diagnostics list errors with row, field and mapping. |
| M7 | Screen | 021 app shell, 022 mapping table, 023 React Flow view, 024 result grid, 025 validation, 026 lineage | Table and Visual Mapper both edit one mapping. Result grid plus diagnostics list. Click a value to trace it to source. |
| M8 ✅ | Finish | 027 snapshots, 028 local output, 029 Profit Center end-to-end | Named snapshot, Ready/Approved, full run writes target files plus an error file. |
| M9 | Container | 030 container packaging (spec to be written) | `docker build` produces an image. `docker run` serves the app on localhost. Projects and files live on a mounted volume. Playwright smoke test passes against the running container. |

## Decisions already made

- M9 container: local-first stays. The image serves the app; user data (projects, source and output files) sits on a mounted volume, never inside the image. No cloud dependency. Non-root user, healthcheck, pinned base image.
- Sources are CSV/Excel only in the first version. SAP extractors (MCP or ABAP report) come later as another adapter.
- Sample files are supplied by the user under `test-data/profit-center/`.
- CSV headers link to dictionary fields by column order (include placeholders such as `.INCLUDE` are skipped first), with a warning when counts differ.
- Target layout is loaded through a wizard where the user marks header, type, length and required rows.
- Mapping Table and Visual Mapper are equal views (PD-003 to be amended).
- Relationships: app suggests, user confirms.
- Full run writes valid rows plus a separate error file. Nothing is silently dropped.
- Key checks in the first version: unmapped key field warning, duplicate target key, parent-child key link, driver dataset suggestion.
- SPEC-001 gets an optional parent link on `TargetStructure`.

## Open items

- SPEC-001 design decisions 1–13 await approval (Group 1: mapping shape, routine/lookup definitions, one-to-many driver).
- Sample data: keys differ across CEPC, CEPCT and CEPC_BUKRS (no join overlap). `Client` is blank on CEPC rows 2–3.
- PRD file name says `data_pc.xlsx`, the file is `data_pc.XLSX`.
