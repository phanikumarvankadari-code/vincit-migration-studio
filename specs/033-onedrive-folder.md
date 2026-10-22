# SPEC-033 OneDrive Folder as the Workspace

## Objective
Keep the workspace (customers, business objects, their projects and input files) in a folder the user chooses, typically a synced OneDrive folder, instead of only in the browser. OneDrive's own sync does the upload; the app never talks to Microsoft and holds no credentials.

## Inputs
A folder chosen with the browser's folder picker (Chrome, Edge). Browser storage stays the default and the fallback.

## Outputs
- Autosave of each project into its object folder (`project.mms.json`, `object.json`).
- Copies of every source file added (`sources/`), the target file (`target/`) and the field dictionary file (`dictionary/`).
- On opening an object, its rows are read from `sources/` again, so no files need to be added a second time.
- A dialog when the project on disk was changed elsewhere.

## Functional Requirements
1. Home page: "Choose OneDrive folder" opens the picker. An empty folder or an existing workspace folder is used as it is. A folder that holds other files gets its own subfolder "Migration Mapping Studio", and the other files are not touched. If that subfolder exists and is not a workspace, the choice is refused with a message.
2. The chosen folder is remembered (IndexedDB). On the next visit it is used without asking again. If the browser needs permission again, the page shows "Reconnect folder" (a click is required) and "Use browser storage instead". Nothing is lost either way.
3. "Use browser storage" switches back. Customers kept in the other place are not copied; switching again shows them again.
4. Files added in Sources, Target and the dictionary box are copied into the open object's `sources/`, `target/` and `dictionary/` folders. Names are made safe and keep their extension. A copy that fails shows a warning and does not stop the work.
5. Opening an object reads the files in `sources/` (only .csv and .xlsx directly inside it) and attaches their rows. Files that do not match a dataset of the project are reported as warnings, not errors. If a dataset has no file, a banner names it.
6. The app never deletes user files. Removing a source from the project leaves its file in `sources/`.
7. Conflict: saving checks the revision in `object.json`. If it moved on, a dialog asks: **Load their version** (the unsaved version is first kept as `project.conflict-<time>.mms.json` next to it) or **Keep mine and overwrite**. The same dialog appears when the page becomes visible again and the revision on disk has changed. Nothing is overwritten before the user chooses.
8. Saves are queued one after another, each using the revision left by the one before.

## Acceptance Criteria
- AC-1 Input paths: names are made safe and keep their extension; only csv/xlsx files directly in `sources/` are listed.
- AC-2 A folder with other files is never written into except its own subfolder; an empty folder and an existing workspace are used directly.
- AC-3 Browser: choose a folder, create a customer and object, and the expected files exist on disk.
- AC-4 Browser: added source and target files are copied; after a reload the folder is used again and the rows are back.
- AC-5 Browser: a change made on disk opens the dialog on the next save; both choices work and Load theirs keeps a copy of the unsaved version.
- AC-6 Browser: permission needed again shows Reconnect, and reconnecting restores the customers.
- AC-7 Browser: switching to browser storage and back works.

## Error Behavior
A folder that cannot be opened or written shows its message and keeps the previous workspace.

## Out of Scope
Microsoft Graph sign-in, live merge of two editors, copying an existing browser workspace into the folder, outputs (SPEC-034).

## Test Command
`npx vitest run packages/workspace-files tests/milestones/m13-onedrive-folder` and `npm run e2e` (the folder picker is replaced by a test double that returns a folder in the browser's own file storage, so the real adapter code is exercised).
