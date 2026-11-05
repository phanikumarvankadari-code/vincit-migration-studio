# Vincit Migration Studio

A local-first tool for data migration consultants. You load source tables (CSV or Excel), load the target
structure (for example an SAP migration template), map source fields to target fields, test the mapping on real
rows, and write the result into the target files. Everything runs in your browser; no data is sent anywhere.

The reference scenarios are SAP ECC / S/4HANA migrations: Profit Center, and Fixed asset master data.

## What you need

- Node.js 22 or newer and npm.
- A Chromium-based browser (Chrome, Edge). Saving into a folder of your own (for example OneDrive) uses a
  browser feature that Safari and Firefox do not have; they work with browser storage instead.

## Run it

```bash
npm install                # once, installs every package of the workspace
npm run dev                # starts the app on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173. If the port is busy, stop the other process that uses it (the app needs exactly 5173).

Build and serve a production copy:

```bash
npm run build                                   # type-check and build into apps/mapping-studio/dist
npm run preview --workspace=@mms/mapping-studio # serves it on http://127.0.0.1:4173
```

## Check the code

```bash
npm test             # unit tests (Vitest) for every package
npm run typecheck    # TypeScript for packages, tests and the app
npm run lint         # ESLint
npm run format       # Prettier
npm run coverage     # test coverage

npx playwright install chromium   # once, for the browser tests
npm run e2e                       # browser tests (starts the app by itself)
```

A single test: `npx vitest run -t "name of the test"`. A single browser test, from `apps/mapping-studio`:
`npx playwright test -g "name" --project chromium`.

## How to use the tool

The screen has five steps: **1 Sources, 2 Target, 3 Map, 4 Test, 5 Ready**. Your work is saved automatically.

### Start

On the home page create a **customer**, then a **business object** (for example "Fixed asset"). Each object is its
own project. Choose "Where files are kept" to store projects in a folder (for example a synced OneDrive folder) or in
the browser. "Save project file" and "Open project file" in the header move a project as a `.mms.json` file.

### 1. Sources

- Choose **Add source files** and select CSV or Excel files. Each file (or Excel sheet) becomes one dataset.
- The separator (tab, semicolon, pipe or comma) is found from the header line, so SAP table dumps load as they are.
  A name like `S4H_ANLA_20261105_153937.csv` becomes the dataset `ANLA`.
- Every field shows its type, fill rate, distinct values and sample values. Leading zeros are kept.
- An optional **field dictionary** (SAP DD03L export) adds technical names and key flags.
- The app suggests **joins** between files. Joins are optional: only joins you confirm are used, and **Reject all
  suggested joins** clears the suggestions.

### 2. Target

- **Load target structure file**: an Excel template (`.xlsx` or Excel XML `.xml`) or a CSV.
- For an SAP migration template (a `Field List` tab plus one tab per structure):
  - `Field List` defines the structures. A "Sheet Name" row such as `General (mandatory)` starts a structure.
    Field Description is the field name, Importance says whether it is required, the group `Key` marks key
    fields, and Type, Length and Decimal give the data type.
  - Each structure is connected to the tab of the same name. Columns in that tab are found by the technical name
    in row 5. The result is written into that tab from row 9.
- Or choose **Create target manually**.
- For date fields you can set the **date format the target expects** (for example `yyyy-MM-dd`), per field or as a
  default per structure.

### 3. Map

- **Structures and their source tables**: each target structure takes its rows from one **main source table**
  (extra tables are optional). Choose it in the overview, or accept the AI's suggestion.
- Map fields in the **Mapping Table** (click a field) or the **Visual Mapper** (drag a source onto a target, or click
  one then the other; Expand all / Collapse all opens or closes the source tables).
- Mapping types, in order of preference: **Direct**, **Constant**, **Lookup** (value table), **Condition**, and a
  **Routine chain** (steps such as Date Format, text, numbers), with custom JavaScript as a last resort.
- **Dates**: use a Routine chain with the **Date Format** step. Example for a source such as `12/31/99`: input format
  `M/d/yy`, pivot `68`, special value `12/31/99 -> 9999-12-31`, output format from the target field. On a direct date
  mapping, the editor offers **Convert with Date Format**.
- **Download mapping** / **Upload mapping** save and replace the whole mapping as a `.mms.json` file.

### Mapping with a chat AI (optional)

The AI never sees your data rows, only names, statistics and the codes of code-like columns.

1. On the Map stage choose **Create AI mapping kit**. A zip downloads with `PROMPT.md`, `catalog.md`, `examples.json`
   and more.
2. Open a chat with an AI that can search the web. Attach `catalog.md` and `examples.json` and paste `PROMPT.md`.
   The AI interviews you and works in steps: what the source tables are, which table feeds which structure, then the
   fields of each structure.
3. After each step, copy the AI's JSON block and choose **Import AI result**. Descriptions are added, pairings show as
   "Suggested" in the Structures overview, and mappings arrive marked "needs review". Nothing you did is changed.
4. If items are skipped, choose **Copy report for the AI**, paste it into the chat, and import the corrected JSON.
5. Review and accept everything. Dates and hard-coded values are always yours to do.

### 4. Test

Run the mapping on a sample of rows (or all rows). The result grid shows every target value; click a cell to see its
lineage (source field, each step, final value). Problems are listed with row, field, value and the mapping involved.

### 5. Ready and output

- The checklist shows what is still open. **Save snapshot** keeps a named copy of the mapping; mark it **Ready** or
  **Approved**.
- **Run on all rows and create files** writes one file per target structure (CSV and/or Excel), a file with the
  rows that failed and why, a diagnostics file and a run summary. With a target template, the filled template is
  written too (each structure into its own tab). Download files one by one or as a ZIP, or save the run to the
  object's `output` folder.

## Good to know

- Row data is never saved in the project. After reopening a project, load the source files again when the app asks.
- The old single-project screen is still available at `/?legacy=1`.
- Mapping is deterministic: the same sources, mapping and routines give the same output.

## Repository layout

| Folder | Content |
|---|---|
| `apps/mapping-studio` | The web app (React, Vite, Fluent UI) and its Playwright tests |
| `packages/mapping-core` | The canonical model: types, validation, `.mms.json` format |
| `packages/file-import`, `file-export` | CSV, Excel and Excel XML reading; CSV, Excel, ZIP and template writing |
| `packages/profiler`, `relationships`, `target-parser` | Field statistics, join suggestions, target structure reading |
| `packages/transformation-engine`, `routine-library`, `js-sandbox` | Running mappings, built-in routines, sandboxed JavaScript |
| `packages/test-engine`, `local-run` | Test runs and full runs with output files |
| `packages/studio-model`, `workspace-files` | App state and edits; project and workspace files |
| `packages/ai-kit` | The AI mapping kit and the import of AI answers |
| `docs`, `specs`, `tests` | Architecture, decisions, specs and milestone tests |
| `test-data` | Sample files (Profit Center, Fixed asset templates) |

Start with `docs/ARCHITECTURE.md` and `AGENTS.md`. The milestone plan is in `docs/MILESTONES.md`.

## Working on it

- One branch per milestone (`milestone/mN-name`); merge to `main` only after tests pass.
- Commit messages: conventional style with a scope, for example `feat(mapping-core): add source dataset model`.
- Core packages never import from the app, and the app holds no mapping logic.
