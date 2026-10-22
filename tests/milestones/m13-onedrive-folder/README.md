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

## Added later: open an existing workspace

`e2e/onedrive-folder.spec.ts` covers AC-8: Open workspace from OneDrive folder from the first-run page, All customers and the storage dialog; the workspace itself or its parent folder; empty and foreign folders refused with nothing written; closing the picker; the folder remembered; the link from single-project mode.

## Fix: opening the real OneDrive layout

A real OneDrive had `MigrationStudio/Vincit` (the workspace, two customers) next to an empty `MigrationStudio/Migration Mapping Studio` leftover. Choosing `MigrationStudio` opened the empty leftover and nothing seemed to happen. Now the workspace with customers is used, several candidates are chosen from a dialog, the remembered folder is the workspace itself, startup never creates folders, and every open reports what it found. Tests: `packages/workspace-files` (nested discovery, choice rule, scoped port, scanning) and `e2e/onedrive-folder.spec.ts` (the real layout, the choice dialog, create in an existing workspace, notices, unreadable file).
