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
