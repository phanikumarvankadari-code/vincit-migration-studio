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
