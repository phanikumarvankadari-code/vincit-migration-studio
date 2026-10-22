# SPEC-034 Outputs to the Workspace Folder

## Objective
After a full run, keep the transformed files where the customer's other files are, so they can be found, shared through OneDrive, and loaded into the target system. The browser download stays.

## Inputs
The result of a full run (`LocalRunResult` from `@mms/local-run`) for the open business object.

## Outputs
`<root>/<Customer>/<Object>/output/<yyyymmdd-hhmmss>_<snapshot name>/` holding the files of that run: the target files, the errors files, `diagnostics.csv`, `run-summary.json` and the optional workbook. Each run has its own folder; earlier runs are never replaced.

## Functional Requirements
1. Output step: **Save to workspace folder** writes every file of the last run into a new run folder. The folder name is the run start time plus the snapshot name, made safe and unique.
2. A switch **Save every run into the workspace folder** (on by default, remembered in this browser) saves automatically when a run finishes. A run that failed saves nothing.
3. After saving, the page shows where: `Customer/Object/output/<run folder>` and the number of files.
4. **Download all as ZIP** and per-file download stay as they are.
5. The business-object card on the home page shows the last output (run folder name and file count).
6. Saving never overwrites or deletes: a clash gets a number. A failed write shows a message and the files stay available to download.
7. In classic single-project mode there is no workspace, so only the download exists.

## Acceptance Criteria
- AC-1 Run folder names are safe, sort by time, and are unique.
- AC-2 Runs of an object are listed newest first with their file counts; other folders under `output/` are listed too and nothing else is.
- AC-3 Browser: a full run saves its files into a run folder with the expected names; the card shows the last output.
- AC-4 Browser: with the switch off nothing is saved until the button is used; a second run makes a second folder.
- AC-5 Browser: the ZIP download still works.

## Error Behavior
A failed save is reported with its message; nothing is half-reported as saved.

## Out of Scope
Opening the folder in the file manager (a web page cannot), cleaning old runs, loading the files into SAP.

## Test Command
`npx vitest run packages/workspace-files tests/milestones/m14-outputs-to-folder` and `npm run e2e`.
