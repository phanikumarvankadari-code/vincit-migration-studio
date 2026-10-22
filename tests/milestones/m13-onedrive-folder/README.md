# M13 — OneDrive folder as the workspace (SPEC-033)

| Case | Proves |
|---|---|
| M13-01 | Source, target and dictionary files are kept in `sources/`, `target/`, `dictionary/` with safe names. |
| M13-02 | Only csv/xlsx files directly in `sources/` are read back as sources. |
| M13-03 | An empty folder or a workspace is used; any other folder is never written into. |

Package tests: `packages/workspace-files/test/store.test.ts` (input paths, source listing, root inspection).

Browser tests: `apps/mapping-studio/e2e/onedrive-folder.spec.ts`. The folder picker cannot be driven in a test, so a test double returns a folder in the browser's own file storage; the real folder adapter, handle persistence, permission flow and conflict flow all run.

- AC-3 files created on disk for customers and objects
- AC-2 a folder with other files gets its own subfolder, files left alone
- AC-4 sources/target/dictionary copied; after reload the folder is used again and rows come back by themselves
- a missing source file is named in a banner
- AC-5 change on disk detected at the next save: Load their version (keeps a conflict copy) and Keep mine and overwrite
- AC-6 permission needed again: Reconnect folder
- AC-7 switching between browser storage and the folder

Not testable in CI: the real OneDrive sync. Manual check: choose the real OneDrive folder, create a customer and object, confirm the files appear in OneDrive.
