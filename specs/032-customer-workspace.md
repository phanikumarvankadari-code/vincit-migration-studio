# SPEC-032 Customer Workspace and Business Objects

## Objective
The main page is a customer: the whole migration entity for one customer. Inside it, each business object (Profit Center, Cost Center, ...) is its own entry with its own mapping project. All records are plain files in one workspace folder, so they can be shared and read without the app.

## Inputs
A workspace folder reached through a `FilePort` (browser storage in this milestone; a synced OneDrive folder in SPEC-033).

## Outputs
`@mms/workspace-files`: file layout, schemas, name rules, and store functions over `FilePort`. App: a home page, a breadcrumb, a Back button, and a project that autosaves into its object folder.

## Folder Layout
```
<root>/mms-workspace.json
<root>/<Customer>/customer.json
<root>/<Customer>/<Business Object>/object.json
<root>/<Customer>/<Business Object>/project.mms.json     (existing workspace file: project, snapshots, dictionary)
<root>/<Customer>/<Business Object>/sources|target|output/   (filled by SPEC-033 and SPEC-034)
<root>/_archive/                                            (removed items are moved here)
```

## Functional Requirements
1. The workspace is created on first use; an existing folder with a different manifest is refused.
2. Create, list and archive customers; create, list and archive business objects. Names are made safe for any file system (no path characters, no reserved names, length limited) and made unique inside their folder.
3. Archive moves the folder into `_archive/<name>-<timestamp>`. The app never deletes user files except the source copy after the archive copy is complete.
4. `object.json` has a revision. Saving the project passes the revision it loaded; if the file on disk has another revision the save is refused with a conflict and nothing is written.
5. Home page: choose or create a customer; cards per business object with status (draft, ready, approved), fields mapped, number of datasets and last change; Add business object (name, entity); Open; Archive after confirmation.
6. Opening an object shows the existing stage screens with the breadcrumb "Customer › Object" and a Back button. Reloading the page reopens the last open object.
7. Projects saved in this browser before workspaces existed are listed as unfiled and can be moved into a customer.
8. Classic single-project mode stays available (`?legacy=1`) and is used when the browser has no file storage.

## Acceptance Criteria
- AC-1 Layout and schemas: a created customer and object have the files above and read back equal.
- AC-2 Names: unsafe, reserved, empty and duplicate names are handled; two objects with the same name get different folders.
- AC-3 Conflict: saving with an old revision is refused and writes nothing; saving with the current revision bumps it by one.
- AC-4 Archive: the folder is gone from its place and complete under `_archive/`.
- AC-5 Foreign folder: a root with another manifest is refused.
- AC-6 Browser: create a customer and two objects; open one, work, go Back, reopen; status shown on the card; reload reopens the last object; archive; move an unfiled project into a customer.

## Error Behavior
Failed file operations return a message; the app shows it and keeps the work in memory. A conflict is shown as "changed elsewhere" (dialog in SPEC-033).

## Out of Scope
OneDrive folder access (SPEC-033), outputs to the folder (SPEC-034), sign-in, locking, shared lookups across objects.

## Test Command
`npx vitest run packages/workspace-files tests/milestones/m12-customer-home` and `npm run e2e`.
