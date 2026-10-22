# M12 — Customer workspace and business objects (SPEC-032)

The main page is a customer. Each business object is an entry inside it with its own project. Records are plain files in a workspace folder (browser storage in this milestone, a synced OneDrive folder in M13).

| Case | Proves |
|---|---|
| M12-01 | One customer holds several business objects, each with a project file. |
| M12-02 | A saved project reads back equal; the card summary (state, datasets, fields mapped, snapshots) reflects it; saving bumps the revision. |
| M12-03 | A save made from an out-of-date copy is refused as a conflict. |
| M12-04 | Archiving an object moves all its files under `_archive`. |

Package tests: `packages/workspace-files/test/` (names, layout, conflict, archive, foreign folder, damaged files).

Browser tests: `apps/mapping-studio/e2e/workspace.spec.ts` — customer and cards; open with breadcrumb and Back; work saved and last object reopened after reload; changes just before Back are saved; separate customers; archive with confirmation; empty names refused; an unfiled browser project moved into a customer.

The earlier browser tests run in classic single-project mode (`/?legacy=1`), which stays as the fallback for browsers without file storage.
