# M10 — Project library and visual mapper sources

Fixes two gaps found when the finished app was used by hand.

| Problem | Fix |
|---|---|
| Only the last project was kept; "New project" removed it, so earlier projects could not be found. | Every project that has sources, a target, mappings or snapshots is kept in the browser's library. **Projects** in the header lists them; Open and Delete. The current project stays in the list when a new one starts. |
| The Visual Mapper showed only sources that were already mapped, so a new link could not be drawn until "Show all source fields" was switched on. | All source fields are shown by default. The switch can still hide unmapped ones. |

Browser test cases (Playwright, run with `npm run e2e`):

- `apps/mapping-studio/e2e/project-library.spec.ts`
  - earlier project is listed after starting a new one and opens again with its name and sources;
  - empty list message; an empty new project is not listed; a listed project can be deleted.
- `apps/mapping-studio/e2e/visual-mapper.spec.ts`
  - all source fields are on the canvas from the start, with no links yet;
  - the layout test now compares positions in node heights because the view re-fits when reopened.

Row data is still never saved. After opening a project, add the source files again.
