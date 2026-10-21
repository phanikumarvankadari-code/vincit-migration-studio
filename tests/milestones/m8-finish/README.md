# M8 Finish: test cases

Specs: 027 snapshots, 028 local output, 029 Profit Center end-to-end.
Packages: `packages/studio-model` (snapshots, persistence), `packages/file-export`, `packages/local-run`. Screens: `ready/*`, `apps/mapping-studio/e2e/{snapshots-output,golden}.spec.ts`.

Run: `npm test` (this folder), `npm run e2e` (Playwright, Chromium).

| ID | Proves |
|---|---|
| M8-01 | Golden import: three sources, dictionary, composite joins suggested then confirmed by a person |
| M8-02 | Target parsed, 21 mappings (direct, constant, date routine chain, lookup, one-to-many), parent links |
| M8-03 | Test run: all structures produced, one-to-many rows right, bad row reported with row and value |
| M8-04 | Lineage traces a target cell through a join to its source |
| M8-05 | Snapshot save, approve, store without row data, reload, restore, immutable |
| M8-06 | Full local run: good rows, errors file with reason, diagnostics, run summary |
| M8-07 | Supplied reference files are untouched |

Browser: `golden.spec.ts` runs the whole journey on screen, including reload with autosave restore and downloaded output files.

## Golden data deviation

The supplied CEPC, CEPCT and CEPC_BUKRS files share no key values, so joins and one-to-many cannot be shown with them. The golden test uses a key-aligned companion set in `test-data/profit-center/golden/` (one deliberate bad row). Originals are unchanged. See `golden/README.md`.
