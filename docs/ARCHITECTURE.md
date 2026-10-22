# Migration Mapping Studio Architecture

## 1. Purpose

This document defines technical boundaries for Migration Mapping Studio.

The architecture must keep the mapping semantics independent from presentation technologies and future integration technologies.

---

## 2. Architecture Principles

### Canonical Model First

All application capabilities operate against a canonical model.

The model must not depend on React, React Flow, Power Apps or an AI provider.

### UI Does Not Own Business Logic

The UI edits and displays mappings.

The mapping engine executes them.

### File Format Does Not Define Internal Model

CSV and XLSX are input/output adapters.

They are not the application's internal data representation.

### Deterministic Execution

Given:

- same source data
- same mapping snapshot
- same deterministic routines

the engine should produce equivalent output.

The exception is explicitly non-deterministic behavior such as UUID v4 generation.

### Local First

Phase 1 runs locally.

Future SharePoint or SFTP connectors must not require redesigning canonical mapping semantics.

---

## 3. Conceptual Architecture

Local CSV / XLSX
        |
        v
+----------------------+
| Import Adapters      |
+----------------------+
        |
        v
+----------------------+
| Source Model         |
+----------------------+
        |
        +----------------------+
        |                      |
        v                      v
+---------------+      +----------------+
| Profiler      |      | Relationships  |
+---------------+      +----------------+
        |                      |
        +-----------+----------+
                    |
                    v
          +-------------------+
          | Canonical Mapping |
          | Model             |
          +-------------------+
                    |
          +---------+----------+
          |         |          |
          v         v          v
      Routines    Lookups   Conditions
          \         |          /
           \        |         /
            +-------+--------+
                    |
                    v
          +-------------------+
          | Transformation    |
          | Engine            |
          +-------------------+
                    |
                    v
          +-------------------+
          | Target Datasets   |
          +-------------------+
             |       |      |
             v       v      v
           Test   Validate  Export

---

## 4. Presentation Architecture

React Application
        |
        +-- Project Workspace
        +-- Source Explorer
        +-- Target Explorer
        +-- Mapping Table
        +-- React Flow
        +-- Routine Editor
        +-- Test Grid
        +-- Validation Inspector
        +-- Lineage Viewer

All presentation components operate on application services built on top of the canonical model.

---

## 5. React Flow Boundary

React Flow provides:

- visual relationships
- visual lineage
- transformation chains
- complex mapping visualization

React Flow does not own:

- field mapping semantics
- routine execution
- validation
- project persistence
- mapping serialization

The application must be capable of executing a saved mapping without initializing React Flow.

---

## 6. Core Packages

Suggested structure:

packages/
  mapping-core/
  file-import/
  profiler/
  transformation-engine/
  routine-library/
  test-engine/

### mapping-core

Owns canonical types and contracts.

### file-import

Owns CSV/XLSX adapters.

### profiler

Owns source data profiling.

### transformation-engine

Executes approved mappings.

### routine-library

Provides reusable transformation routines.

### test-engine

Executes mappings against representative subsets and collects diagnostics.

---

## 7. Application

apps/mapping-studio/

Contains the React application.

The application depends on the core packages.

Core packages must never depend on the React application.

---

## 8. Persistence

Phase 1 persistence is local.

The persistence mechanism must support:

- Projects
- Draft mapping
- Snapshots
- Local run history

The exact persistence implementation can be decided after the canonical model is stable.

Do not couple canonical objects directly to a database technology.

---

## 9. Transformation Contract

Conceptually:

Source Dataset(s)
    +
Target Definition
    +
Mapping Definition
    +
Routine Definitions
    +
Lookup Definitions
        |
        v
Transformation Engine
        |
        v
Target Dataset(s)
    +
Diagnostics
    +
Lineage

---

## 10. Error Contract

Diagnostics should support:

- severity
- error code
- message
- dataset
- source row
- source field
- source value
- target structure
- target field
- mapping ID
- routine ID
- technical details

Not every error requires every property.

---

## 11. Future Power Platform Integration

Later:

Power Apps
     |
     v
PCF / React Mapping Experience
     |
     v
Canonical Mapping Model

Power Apps may provide:

- application navigation
- project administration
- enterprise experience

Power Apps must not become the transformation engine.

---

## 12. Future Automation

Future:

SharePoint Input
       |
       v
Power Automate
       |
       v
Approved Mapping Execution
       |
       v
SharePoint Output
       |
       +-- Archive
       +-- Errors

Power Automate orchestrates.

It should not execute transformations row-by-row.

---

## 13. Architecture Rule

If React Flow, Power Apps, AI or Power Automate were removed tomorrow, an approved canonical mapping must still remain understandable and executable by the core engine.

---

## 14. Canonical Model Decisions (SPEC-001)

Implemented in `packages/mapping-core`.

- **Validation:** Zod 4 schemas are the source of truth; types are inferred. Objects are strict (unknown keys rejected). Unions are closed and discriminated (`mappingType`, `kind`, `ruleType`, `scope`).
- **Two validation layers:** `parseProject` / `parseSnapshot` check structure and return `Result` with `Diagnostic[]` (never throw). `validateProject` / `validateSnapshot` check references and return `Diagnostic[]` with `MODEL_*` codes and a `path`.
- **FieldMapping shape:** `mappingType` selects the primary operation (direct, constant, lookup, conditional, routine, javascript), each carrying its own definition. An ordered `transformations` chain (routine or lookup steps) follows. Chain order is stored in `order` and serialized sorted.
- **Definitions live in the project:** `routines` and `lookups` are stored; `MappingDefinition.routineReferences` pins `{routineId, version}` and `lookupReferences` lists lookups used. Usage must be declared.
- **Rows:** `TargetStructure.generation` names the driver dataset (final semantics in SPEC-013). `TargetStructure.parent` links a child structure to its parent through key pairs.
- **Snapshots** are self-contained (mapping, target, source schemas, routines, lookups, `modelSchemaVersion`) and hold no row data. Projects exclude snapshots and runs.
- **Values:** IDs are branded opaque strings supplied by the caller (core generates none). Timestamps are UTC ISO strings. Decimals are strings. No `Date` objects.
- **Serialization:** JSON envelope `{ format, schemaVersion: 1, <body> }`, canonical key order from the schema, 2-space indent, trailing newline. Newer schema versions are rejected. Golden file: `packages/mapping-core/test/fixtures/profit-center.project.json`. Do not run Prettier on it.
- **Boundaries:** core imports only `zod` and relative modules; `tsconfig` has no DOM lib and no Node types for `src`. Enforced by `boundaries.test.ts`.
- **Deviations from the SPEC-001 minimums (additive):** `Diagnostic.path`, `RunResult.inputRecordCounts` (per dataset), `RunResult.generatedFiles`, `SourceDefinition.fingerprint`, `nativeType` on fields, `Relationship.status` values `suggested|confirmed|rejected`.


---

## 15. Source Import and Profiling Decisions (SPEC-002 to 005)

- **Packages:** `@mms/file-import` (CSV, XLSX, field dictionary) and `@mms/profiler`. Both depend on `@mms/mapping-core` and, like it, use no Node or DOM APIs: importers take decoded text (CSV) or bytes (XLSX), never paths. Reading files is the caller's job.
- **Row data** lives outside the model: `SourceRows` (in mapping-core) holds `{ datasetId, fieldIds, rows }` with `string | null` cells. The project never stores rows.
- **Blank vs empty:** an unquoted empty CSV cell and an empty Excel cell are `null`. A quoted empty CSV cell (`""`) is `''`. Values are never trimmed or converted. Leading zeros survive because nothing is parsed to numbers.
- **Nothing dropped silently:** short rows are padded with `null` (warning). Over-long rows are cut (error) and the dropped values are recorded in `technicalDetails`. Blank or duplicate headers are kept and reported.
- **Excel dates:** date-formatted cells become ISO 8601 text (1900 and 1904 systems) with an info diagnostic per column; the non-existent 1900-02-29 stays as the raw number with a warning.
- **IDs** are deterministic from names (`src-CEPC`, `ds-CEPC`, `f-CEPC-3`), so re-importing gives identical IDs. Names must be unique within a project. Equal sheet-name slugs get a numeric suffix.
- **Field dictionary:** column names are configurable (defaults follow the SAP DD03L export). Dictionary entries are matched to dataset columns by order, after skipping placeholder rows whose field name starts with `.` (SAP `.INCLUDE`). Count mismatch, ambiguous entries and unknown tables are reported as diagnostics; enrichment never replaces display names and never blocks an import.
- **Profiler** reads rows and returns a `DatasetProfile`: null/empty/filled counts, fill %, distinct count, uniqueness, inferred datatype, min/max length, representative values (most frequent first). Datatype inference never guesses: leading-zero numbers stay `string`, and non-ISO dates such as `1/1/26` stay `string`.
- **New dependencies:** `fflate` (unzip) and `fast-xml-parser` (XLSX XML), both pure JavaScript and browser-safe.


---

## 16. Relationships and Target Parsing Decisions (SPEC-006 to 008)

- **Packages:** `@mms/relationships` and `@mms/target-parser`, both depending only on `@mms/mapping-core`. The target parser takes the parsed table (schema plus rows) produced by the file importers, so it does not depend on `@mms/file-import`.
- **Target layout is configuration, not code.** `TargetLayout` names the header of each column and a mode: `sectionRows` (a row holding only a structure name starts a structure; this is the `data_pc.XLSX` shape), `column` (a structure name on every field row) or `perSheet`. `detectTargetLayout` proposes a layout from header names and row shape to pre-fill the load wizard; the user can change every setting. No structure name is hard-coded.
- **Target field rules:** the Group column carries down to the rows below it; a group named `Key` (configurable) marks key fields, or a key flag column does. Importance starting with `mandatory` or `required` (configurable) marks required fields. Type text maps to a datatype through a configurable map; unknown types become `unknown` with a warning. A bracket note in a structure heading, such as `Profit Center (mandatory)`, becomes the structure `importance`. Group, importance and original type text are kept on the field.
- **Model additions (additive):** `TargetField.group`, `TargetField.importance`, `TargetStructure.importance`, `TargetRows` (output rows stay tied to a structure), and `computeCompleteness` (mapping completeness per structure: mapped, required mapped, unmapped required and key fields, needs-review and error counts, ready flag). Completeness is derived from the model, never stored.
- **Relationship analysis** compares data on the keys: matching and unmatched rows, key uniqueness per side, blank-key rows (which never match), and the cardinality the data implies. `checkRelationship` reports unknown datasets or fields and repeated key pairs as errors; many-to-many, datatype mismatch, declared cardinality different from the data, no matching values and blank keys as warnings.
- **Suggestions** score each field pair from technical-name match (dictionary), display-name match, key on both sides and shared values. Pairs that hold one single value everywhere are left out unless both sides declare a key. Every suggestion has status `suggested` with plain-language evidence and diagnostics, and never becomes `confirmed` without `confirmRelationship`. The sample data shows the diagnostics at work: no key value is shared between the three Profit Center files, and the Client key is blank on two CEPC rows.
- **Not here:** executing joins (mapping engine, M4+), AI-based suggestions, visual editing.


---

## 17. Mapping Engine Decisions (SPEC-009 to 013)

Implemented in `@mms/transformation-engine` (depends only on `@mms/mapping-core`; no Node, DOM, clock, randomness or code evaluation). `executeMapping(model, rows, options)` returns a `Result<ExecutionResult>`.

- **Preconditions:** the model must pass `validateModel` and the rows must match the dataset fields. Otherwise nothing runs and diagnostics are returned.
- **Driver and rows:** each target structure has a driver dataset (`generation.driverDatasetId`, or the one dataset its mappings read; otherwise `ENGINE_NO_DRIVER`). One output row per driver row, in driver order. A parent with three children in the driver dataset gives three rows; a parent with none gives none. Rows stay in a `TargetRows` table tied to their structure and record the driver row number.
- **Joins:** other datasets are reached through **confirmed** relationships only (suggested or rejected ones are ignored, so human confirmation matters), by the shortest path in relationship order. `generation.viaRelationshipIds` limits which relationships a structure may use. Key parts that are blank never match. Left join with no match keeps the row with blanks. Inner join with no match, or a join entered from the right-hand side, drops the row with `ENGINE_ROW_DROPPED`. Several matches use the first and warn. Nothing is dropped silently.
- **Mapping types:** direct (value unchanged); constant (typed value written as text); lookup (exact key; missing-value behaviors: error and warning give a diagnostic and a blank, keepSource keeps the source, null is blank, default writes the default; a blank key counts as a miss); conditional (first matching rule wins, `current` is the first source reference, no match and no otherwise gives a blank plus an info diagnostic). Comparison: eq/ne exact text, ordering numeric when both sides are plain numbers, otherwise text; an empty value (null or `''`) is never ordered. `isEmpty` means null or `''` (spaces are a value).
- **Chains:** after the primary operation, steps run in `order`. Routine steps use a `RoutineRegistry` (implementations arrive in M5); a missing implementation is an error, never a silent pass-through. `onError: stop` ends the chain with an error and a blank; `continue` skips the step with a warning. Custom JavaScript runs only through an injected `JavaScriptExecutor` (the sandbox arrives in SPEC-019).
- **Diagnostics and status:** every problem carries dataset, driver source row, target structure, target field, mapping, target row (when produced) and, where it applies, the routine. Row status is error, warning or ready, per row, so generated rows are judged independently.
- **Lineage** (`collectLineage: true`): per target value, the source cells with their 1-based row numbers (also across joins) and each step with input and output. It is off by default because it costs memory on large runs.
- **Repeatable:** same model, rows and options give the same result; the model and rows are never changed.
- **Core additions (additive):** `Diagnostic.targetRow`, `CellLineage` / `LineageStep`.
- **Not here:** routine implementations (M5), the JavaScript sandbox (M5), validation rules execution and key checks (M6 and later), and file output (M8).


---

## 18. Routines and the JavaScript Sandbox (SPEC-014 to 019)

- **`@mms/routine-library`** holds 26 built-in routines (date 5, identifier 6, text 10, numeric 5), each defined once with a Zod configuration schema, a description and a pure `run`. `createBuiltInRegistry()` returns implementations for `executeMapping({ routines })`; `builtInRoutineDefinitions()` gives the project routine entries (scope `builtIn`, version `1`); `checkRoutineConfiguration()` and `describeRoutine()` (JSON Schema) serve editors, so mistakes show at design time.
- **Contract:** a routine gets the current chain value, all source values and its configuration, and returns a value or a structured error. It never throws (configuration errors give `ROUTINE_CONFIG_INVALID`, unexpected failures `ROUTINE_INTERNAL_ERROR`). Configuration objects are strict: unknown settings are errors. Routines have no clock, no randomness (UUID v4 takes an injected `randomBytes`; without it the routine reports an error), no Node or DOM code.
- **Explicit, never guessed:** dates need an explicit layout, a pivot for two-digit years, and a locale for month names; ISO `YYYY-MM-DD` is the interchange form. `specialValues` maps exact inputs such as `12/31/99` to a fixed date or blank. Numbers need explicit separators and rounding; arithmetic is exact (BigInt decimals); division by zero is an error on that row. Blank handling is a setting (`onBlank`) where it matters; unless stated, a null stays null.
- **Identifiers:** deterministic UUIDs are RFC 4122 version 5 over the JSON-encoded key (salt first, then the current value, then the other source values) with a configured namespace, so equal keys always give equal UUIDs and the encoding cannot be confused. UUID v4 is documented as non-repeatable.
- **Text** counts and cuts by Unicode code points. Case changes use locale-independent Unicode rules. Replace is literal (no patterns).
- **`@mms/js-sandbox`** runs custom JavaScript in QuickJS compiled to WebAssembly, not in Node's `vm` (which is not a security boundary). Nothing from the host exists inside: no process, require, fetch, timers, console, file or network access; dynamic `import()` fails. The code is the body of `transform(value, row, context)`; `context.inputs` holds all source values and `context.lookup(id, key)` answers only lookups listed in `declaredLookupIds` (the engine enforces this too). Each call gets a fresh context, so nothing carries from row to row. `Math.random`, `Date.now`, `new Date()` and the clock reachable through date objects are disabled so results are repeatable. A timeout stops runaway loops (default 1 s), memory and stack are limited, and `repeat`, `padStart` and `padEnd` refuse results over 100,000 characters because a single native call cannot be interrupted. Errors are structured (`JS_SYNTAX_ERROR` with the line of the user's code, `JS_RUNTIME_ERROR`, `JS_TIMEOUT`, `JS_MEMORY_LIMIT`, `JS_BAD_RETURN`) and never crash the run: they become row errors. `sandbox.test(definition, samples)` serves the "try it with sample data" step.
- **Engine change (additive):** the `JavaScriptExecutor` receives a `lookup` helper restricted to declared lookups.
- **Known limit:** the sandbox is for transformations, not for untrusted multi-tenant code; a very large single native operation inside QuickJS other than those capped above could run past the timeout.


---

## 19. Test Engine Decisions (SPEC-020)

Implemented in `@mms/test-engine` (depends on `mapping-core`, `routine-library` for configuration checks, and the engine). `runTest(input, options)` never throws for bad models or data: a run that cannot execute returns `status: "failed"` with the reasons as diagnostics.

- **Samples:** `firstRows` (default 100), `spread` (evenly spaced rows, so a sample is not just the top of the file) and `all`. Presets: 100, 1,000, all. A sample limits **driver rows only**; joined datasets are always complete. "All" runs only when the sources hold at most `safeRowLimit` rows in total (default 100,000), otherwise `TEST_ALL_NOT_SAFE`. The sample is applied through the engine option `sampleRows`; the engine also reports each structure's driver dataset, driver row count and sampled row count.
- **Clock and IDs are injected** (`now`, `runId`), so the package has no clock and results are repeatable.
- **Result:** `run` (the shared `RunResult` contract: status, times, per-dataset input counts, per-structure output counts, warning and error counts, all diagnostics), one `TargetOutput` per structure (rows, row status, driver row numbers, lineage), per-structure summaries (ready, warning, error counts), mapping completeness, the pre-flight list, and `diagnosticGroups` (repeats collapsed by code, structure and field, worst first, with the first affected row). `diagnosticsForRow` and `rowOf` link the list and the grid in both directions. Lineage defaults to on for samples up to 1,000 rows.
- **Pre-flight** (once per problem, not once per row): routine without an implementation, invalid configuration of a built-in routine, JavaScript without a sandbox, unconfirmed relationships (not used in runs), unmapped key fields and unmapped required fields (warnings), and structures reading several datasets with no driver (warning with a suggestion from `suggestDrivers`: the dataset supplying most of the structure's key fields, then the most-read one).
- **Row checks** (the four key checks chosen for the first version, plus blank required fields): mapped key and required fields must not be blank; no duplicate keys within a structure (only when every key field is mapped); every child row needs a parent row through the structure's parent link. Parent links are not checked when the parent structure was only sampled, and this is reported once (`TARGET_PARENT_CHECK_SKIPPED`) instead of raising false alarms. Fields without a mapping are left to pre-flight so a half-mapped draft is not flooded with row errors. Row status is raised to error where a check fails.
- **Snapshots:** `runTestOnSnapshot` tests a saved snapshot with the sample of its run definition; a full run or another snapshot's run definition is refused (`TEST_RUN_MISMATCH`).
- **Core addition (additive):** `spread` sample kind in `RunDefinition`.
- **Not here:** executing validation rules (`ValidationRule`: required, unique, maxLength, pattern, allowedValues) is SPEC-025 (M7); full production runs and file output are M8.


---

## 20. Screen Decisions (SPEC-021 to 026)

- **Pure model first.** `@mms/studio-model` holds everything the screens decide: the app state and its reducer (`StudioState`, `reduce`), the mapping table rows and statuses, the editor forms as plain drafts that become canonical mappings (`draftToMapping`) or go back into the editor (`mappingToDraft`), the graph projection and edits for the Visual Mapper, stage statuses and the readiness checklist, the per-mapping preview, and automatic target import. It has no React and no DOM. The React app (`apps/mapping-studio`) only renders state and sends events.
- **State.** One `Project` plus row data kept in memory beside it (`data` by dataset), import diagnostics, relationship notes, the last test run and a `runStale` flag. Every change goes through the reducer and marks an existing run out of date. Rows are never part of the project. There is no persistence yet (autosave and history come with snapshots).
- **Joins are suggested, not assumed.** Adding sources or a dictionary refreshes suggested relationships; decided ones (confirmed or rejected) are never overwritten. Only confirmed joins are used by runs.
- **Mapping Table and Visual Mapper are equal views** (PD-003). Both edit the same canonical mapping. The graph is derived with `buildMappingGraph` / `buildRelationshipGraph`; positions are UI layout only, kept in the browser's local storage per project, view and structure, never in the project. Visual edits use `connectFields` (a source field onto an unmapped target field makes a direct mapping; a mapped target is never overwritten by a stray drag) and `disconnectTarget`, the same project edits as the table.
- **Editor.** Five forms (direct, constant, lookup, condition, routine chain). Problems are listed in plain words and block saving; a live preview runs the mapping on the first rows through the test engine without saving. A mapping the forms cannot show (custom JavaScript, combined conditions) is kept untouched and the user is told. Custom JavaScript is not editable in the screen yet.
- **Structure settings** (driver dataset with a suggestion from key fields, and the parent link) are edited per structure and used by runs and by the parent-link check.
- **Results.** The grid is virtualized (only visible rows are in the DOM, so 100,000-row results stay responsive), filters by Ready, Warning and Error, tints cells that have their own problem, and has one tab per target structure. Selecting a cell shows its lineage from the final value down to the source cells (SPEC-026); selecting a row number inspects the row. The problems list collapses repeats, shows plain messages first with technical details on request, and links to rows in the grid. Lineage is recorded for samples up to 1,000 rows.
- **Stage status is derived, never stored** (`stageStatuses`): Sources (files, joins to confirm), Target, Map (fields mapped, pre-flight problems), Test (last run, out of date), Ready (all of these plus a clean test). The Ready stage lists the checklist; saving snapshots and writing output arrive in the next milestone.
- **Toolchain:** Vite 8, React 19, Fluent UI 9, React Flow 12, TanStack Virtual. The app typechecks with its own tsconfig (DOM, bundler module resolution). The JavaScript sandbox is not bundled into the app yet.

## 21. Snapshots, Persistence and Local Output (SPEC-027 to 029)

- A snapshot is an immutable, deep-frozen copy of the mapping definition and target structures. The marker (none, ready, approved) lives outside the snapshot, so marking never changes it. Restoring copies a snapshot into the draft.
- Ready stage completes only when a marked snapshot matches the checklist.
- Autosave writes the workspace (project, snapshots, dictionary) to localStorage `mms:workspace`; never row data. Rows are re-attached by loading the files again. `decodeWorkspace` validates with the schemas and refuses inconsistent files.
- Layout positions of the Visual Mapper stay UI-only.
- Local run (`@mms/local-run`) runs a snapshot over full data. Writes `<Structure>.csv`, `<Structure>.errors.csv` (only when errors), `diagnostics.csv`, `run-summary.json`, optional XLSX. It refuses non-full runs and blocking pre-flight errors. Nothing is dropped silently.
- Golden scenario (SPEC-029) uses a key-aligned companion data set, because the supplied files share no key values.
- Project library: autosave also keeps each project that has work in `mms:project:<id>` with an index in `mms:projects` (no row data). The Projects dialog opens or deletes them; `mms:workspace` stays the project open last. The Visual Mapper shows all source fields by default.
- Two-panel mapper (SPEC-031): `apps/mapping-studio/src/stages/MapperPanel.tsx` draws the canonical mapping as lines between source and target rows (SVG over measured row positions) and edits through `connectFields`, `disconnectTarget` and `applySuggestions`. React Flow remains only for the joins picture. `@mms/mapping-suggest` is a pure, rule-based suggestion engine (no AI, no network); suggestions never become mappings without a user action.
- Customer workspace (SPEC-032): `@mms/workspace-files` defines the folder layout (`<root>/<Customer>/<Object>/{object.json,project.mms.json,sources,target,output}`, `_archive/`), schemas, name rules and store functions over a `FilePort`. The app adapts a directory handle to that port (`lib/handle-port.ts`; browser storage now, a picked OneDrive folder in SPEC-033). `WorkspaceProvider` owns customers, cards and the open object; `StudioProvider` takes `initial` and `persist`. Saves are serialised and carry the object revision, so a change made elsewhere is reported, never overwritten.
- OneDrive folder (SPEC-033): the workspace root can be a folder picked with `showDirectoryPicker` (handle kept in IndexedDB, permission re-requested on a click). The same `handlePort` adapter serves it and browser storage (OPFS). Files added in Sources/Target are copied into the object's `sources/`, `target/`, `dictionary/` folders; opening an object re-reads `sources/` and attaches the rows. A folder with other files gets its own `Migration Mapping Studio` subfolder. The app never talks to Microsoft: OneDrive's sync does the upload. A revision mismatch at save time (or when the page becomes visible) opens the Changed elsewhere dialog.
