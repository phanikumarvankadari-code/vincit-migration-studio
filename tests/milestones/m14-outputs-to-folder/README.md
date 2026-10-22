# M14 — Outputs to the workspace folder (SPEC-034)

| Case | Proves |
|---|---|
| M14-01 | A run is saved under `output/<time>_<snapshot>/` with every file (target, errors, diagnostics, summary). |
| M14-02 | A second run with the same name and time gets its own folder; the first is untouched. |
| M14-03 | Runs are listed newest first with their file counts. |

Package tests: `packages/workspace-files/test/store.test.ts` (run folder names, unique files and folders, listing).

Browser tests: `apps/mapping-studio/e2e/workspace-output.spec.ts` — a full run saves its files into the object's output folder and the card shows the last output; with the switch off nothing is saved until **Save to workspace folder**, and each save is its own folder; the ZIP download still works.
