# SPEC-035 Vincit Migration Studio: Customers, Customer Home and Object Detail

## Objective
Give the application a corporate look and a three-level navigation that matches the approved mock-up: all customers, one customer with its business objects, and one business object. The tool is called **Vincit Migration Studio** and carries the Vincit logo.

## Inputs
The workspace (customers, business objects, project files, runs) from SPEC-032 to SPEC-034. The mock-up canvas "Vincit Migration Studio".

## Outputs
- Pages: **First run** (no customer yet), **All customers**, **Customer home**, **Business object detail** (a dialog), and the existing stage screens inside a restyled header.
- Brand: logo and name in every header, a light theme with one blue accent, system fonts only (no web fonts, no network).

## Functional Requirements
1. **First run:** a welcome with three steps and a form to create the first customer, with a choice of where files are kept: a OneDrive folder (recommended, offered when the browser can pick a folder) or this browser. Choosing the folder happens when the form is submitted.
2. **All customers:** title with a one-line summary (customers, business objects, runs saved); **New customer** (dialog); filter chips All and Needs attention; sort by recently changed, name or least mapped; search from the top bar; a card per customer with initial tile, storage place, note, number of business objects, % mapped with a bar, counts of draft, ready and approved, last change, and an attention tag; a dashed "Add a customer" card; a table of all projects across customers (project, customer, status, fields mapped, last output, changed). A customer card opens the customer home; a project name opens its detail.
3. **Customer home:** breadcrumb back to All customers; customer name and notes; four summary cards (business objects, fields mapped, ready to run, runs saved); a "Continue where you left off" panel for the most recently changed object with **Resume**; a table of business objects (name and entity, status, stage, fields mapped, last output, changed, Open and a ⋯ menu with Details and Archive); **Add business object** (dialog); latest outputs (newest run of each object with its result and a ZIP download); needs attention (project file unreadable, no source files).
4. **Business object detail:** dialog with the customer path, name and status; the five steps (Sources, Target, Map, Test, Ready) with a one-line note each; counts (fields mapped, datasets and confirmed joins, snapshots, required fields still open); the files kept in the object folder (sources, target, dictionary); the newest outputs; **Open project**, **Run all rows** (opens the project at the Ready stage) and **Archive** (with confirmation).
5. **Stage screens:** the header shows the logo, product name and the breadcrumb All customers › Customer › Object with Back, the project name, autosave status and the project-file actions, in the light style. Classic single-project mode (`?legacy=1`) uses the same header without the breadcrumb.
6. **Storage:** the top bar shows where files are kept (OneDrive folder name, or this browser) and opens a dialog to choose a OneDrive folder or return to browser storage. When the browser needs permission again, a banner offers Reconnect.
7. No sign-in, no avatar, no network calls: nothing in the UI implies a user account or a sync state the app cannot know.
8. Light theme, one accent (deep blue), status shown as a labelled tag (never colour alone), visible focus, text contrast of at least 4.5:1, works down to a narrow window (tables scroll sideways inside their box).

## Acceptance Criteria
- AC-1 First run creates the first customer in browser storage and in a chosen folder.
- AC-2 All customers lists customers with the figures above, filters, sorts and searches; the projects table lists objects of all customers.
- AC-3 Customer home shows the summary cards, the continue panel, the objects table, latest outputs and attention items from real data; Resume and Open open the project.
- AC-4 Object detail shows steps, counts, files and outputs; Open project, Run all rows (Ready stage) and Archive work.
- AC-5 Breadcrumb and Back navigate between the levels; reload reopens the last object.
- AC-6 Brand: every page shows the logo and "Vincit Migration Studio"; the browser tab is titled the same.
- AC-7 All earlier behaviour (autosave, rows re-attached, conflict dialog, outputs saved) still works.

## Out of Scope
Customer settings, archived-customer browsing, user accounts, themes other than light, translation.

## Test Command
`npx vitest run packages/studio-model tests/milestones/m15-vincit-ui` and `npm run e2e`.
