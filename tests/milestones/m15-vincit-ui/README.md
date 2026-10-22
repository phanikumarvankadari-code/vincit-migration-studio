# M15 — Vincit Migration Studio UI (SPEC-035)

The application is called **Vincit Migration Studio**, carries the Vincit logo and uses a light, formal style with one blue accent. Three levels: All customers, one customer, one business object.

| Case | Proves |
|---|---|
| M15-01 | The object summary holds what the cards and the detail dialog show (state, datasets, fields, mapped, snapshots, required open, joins confirmed). |
| M15-02 | A customer is copied between storage places with every file (used by Move to OneDrive folder). |
| M15-03 | A customer folder or business-object folder chosen as the workspace is recognised and not written into. |

Package tests: `packages/workspace-files/test/store.test.ts`.

Browser tests (Playwright, `npm run e2e`):
- `workspace.spec.ts`: logo and name on every page, first run, All customers (cards, projects table, search, attention filter, sort), customer home (summary, continue panel, Resume, breadcrumb), object detail (steps, counts, files, outputs, Open project, Archive), save and reload, Back, separate customers, archive with confirmation, empty names, unfiled project moved in.
- `onedrive-folder.spec.ts`: first run into a folder, other files left alone, picker closed without choosing, sources copied and rows back after reload, missing source banner, changed-elsewhere dialog (both choices), reconnect, storage chip switching, customers left in the browser offered a move, switching a browser workspace to an empty folder does not strand its customers, a customer folder chosen by mistake is explained, **Move to OneDrive folder** for an existing customer (files copied, browser copy archived).
- `workspace-output.spec.ts`: outputs saved, card and Latest outputs, ZIP.
