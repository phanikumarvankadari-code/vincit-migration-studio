# SPEC-001: Canonical Mapping Model

## Status

Ready for implementation

## Priority

MVP - Critical

---

## 1. Objective

Create the technology-independent canonical domain model for Migration Mapping Studio.

The model is the foundation shared by:

- importers
- profiler
- relationship engine
- mapping engine
- routine engine
- testing
- React UI
- React Flow
- future Power Platform integration
- future AI mapping

The canonical model must not depend on these consumers.

---

## 2. Reference Scenario

Use the SAP Profit Center example to prove that the model is sufficiently expressive.

Reference source datasets conceptually include:

CEPC

CEPCT

CEPC_BUKRS

Field dictionary metadata

Reference target contains:

Profit Center

Company Codes

Translation

The model must not hardcode these dataset or structure names.

---

## 3. Required Domain Objects

### Project

Represents a migration workspace.

Minimum properties:

- id
- name
- businessEntity
- sourceDefinitions
- targetDefinition
- mappingDefinition
- projectState
- createdAt
- updatedAt

---

### SourceDefinition

Represents a registered source such as a CSV file or Excel workbook.

Minimum properties:

- id
- name
- sourceType
- location/reference
- datasets

The model should not permanently tie SourceDefinition to local files because future sources may include SharePoint.

---

### SourceDataset

Represents a logical table/sheet.

Minimum properties:

- id
- sourceId
- name
- displayName
- fields

---

### SourceField

Minimum properties:

- id
- datasetId
- displayName
- technicalName
- datatype
- length
- nullable
- isKey

Technical properties must be optional.

A generic CSV may only supply:

- displayName
- inferred datatype

---

### Relationship

Represents a relationship between datasets.

Minimum:

- id
- leftDatasetId
- rightDatasetId
- keys
- cardinality
- joinType
- status

---

### RelationshipKey

Minimum:

- leftFieldId
- rightFieldId

Relationship must support multiple RelationshipKeys.

---

### Cardinality

Minimum options:

- oneToOne
- oneToMany
- manyToOne
- manyToMany

---

### JoinType

Initial minimum:

- inner
- left

---

### TargetDefinition

Represents the target migration definition.

Minimum:

- id
- name
- structures

There must be no fixed maximum number of structures.

---

### TargetStructure

Minimum:

- id
- targetDefinitionId
- name
- displayName
- technicalName
- fields

Technical name should be optional.

---

### TargetField

Minimum:

- id
- targetStructureId
- displayName
- technicalName
- datatype
- length
- decimals
- required
- isKey
- description

Optional source metadata must not be required.

---

### MappingDefinition

Represents all mapping logic for the project.

Minimum:

- id
- mappings
- relationships
- routineReferences
- lookupReferences
- validationRules

---

### FieldMapping

Minimum:

- id
- targetStructureId
- targetFieldId
- mappingType
- sourceReferences
- transformations
- status

---

### Mapping Type

Initial values:

- direct
- constant
- lookup
- conditional
- routine
- javascript

The type system should remain extensible.

---

### Mapping Status

Initial values:

- mapped
- needsReview
- unmapped
- error

---

### SourceReference

References source data used by a mapping.

Minimum:

- datasetId
- fieldId

A mapping must be able to reference multiple source fields.

---

### Constant Definition

Represents a configured hard-coded value.

The value must preserve its intended datatype.

---

### RoutineReference

References a reusable routine.

Minimum:

- routineId
- configuration
- order

Routine chains must preserve their execution order.

---

### LookupReference

Represents a configured lookup used by a mapping.

Minimum:

- lookupId
- input/reference configuration
- missing-value behavior

---

### ValidationRule

Represents a target validation rule.

Minimum:

- id
- scope
- ruleType
- configuration
- severity

---

### MappingSnapshot

Represents an immutable mapping state.

Minimum:

- id
- name
- createdAt
- mappingDefinition
- relevant configuration metadata

A snapshot should contain enough information to reproduce the mapping semantics used during a run.

---

### RunDefinition

Represents execution configuration.

Minimum:

- id
- snapshotId
- runType
- input references
- optional sample configuration

Run type:

- test
- full

---

### Diagnostic

Minimum:

- severity
- code
- message

Optional context:

- datasetId
- sourceRow
- sourceFieldId
- sourceValue
- targetStructureId
- targetFieldId
- fieldMappingId
- routineId
- technicalDetails

---

### RunResult

Minimum:

- runId
- status
- startedAt
- completedAt
- inputRecordCount
- outputRecordCounts
- warningCount
- errorCount
- diagnostics

---

## 4. Profit Center Reference Representation

The canonical model must be capable of representing:

TargetDefinition
    |
    +-- Profit Center
    |
    +-- Company Codes
    |
    +-- Translation

No Profit-Center-specific class should be required.

---

## 5. Composite Relationship Requirement

The model must represent:

CEPC.PRCTR + CEPC.KOKRS

related to:

CEPCT.PRCTR + CEPCT.KOKRS

using two RelationshipKey entries.

---

## 6. One-to-Many Requirement

The model must support:

one Profit Center

producing:

multiple Company Code target records

without adding Profit-Center-specific behavior to mapping-core.

---

## 7. Serialization

The model must support stable serialization.

Minimum initial representation:

JSON

Required test:

Canonical Object
    ↓
JSON
    ↓
Canonical Object

The reconstructed object must be semantically equivalent to the original.

---

## 8. Validation

The implementation should reject clearly invalid states where practical.

Examples:

- mapping referencing nonexistent target field
- relationship referencing nonexistent dataset
- relationship key referencing nonexistent field
- duplicate IDs where IDs must be unique

The implementation should not over-constrain legitimate future use cases.

---

## 9. Technology Requirements

Implement using TypeScript.

mapping-core must not import:

- React
- React Flow
- Fluent UI
- Power Apps APIs
- Power Automate APIs
- browser DOM APIs
- AI SDKs

Prefer portable TypeScript domain objects.

---

## 10. Acceptance Criteria

### AC-001

Given a Project

When three SourceDatasets are defined

Then all datasets can coexist inside the same project.

---

### AC-002

Given CEPC and CEPCT-like datasets

When a relationship is created

Then the relationship supports multiple key pairs.

---

### AC-003

Given a TargetDefinition

When three target structures are added

Then all structures and their fields are represented independently.

---

### AC-004

Given a FieldMapping

When its mapping type is created

Then it can represent:

- direct
- constant
- lookup
- conditional
- routine
- JavaScript

without introducing UI-specific objects.

---

### AC-005

Given a mapping requiring two source fields

When SourceReferences are defined

Then the mapping can reference both fields.

---

### AC-006

Given multiple RoutineReferences

When attached to a FieldMapping

Then their execution order is preserved.

---

### AC-007

Given a complete MappingDefinition

When serialized and deserialized

Then its semantic contents remain equivalent.

---

### AC-008

Given an invalid source/target reference

When runtime/domain validation is performed

Then a structured validation failure is returned.

---

### AC-009

No mapping-core source file imports a UI, browser, Power Platform or AI dependency.

---

## 11. Required Tests

Create automated tests covering:

### Source Model

- SourceDefinition
- SourceDataset
- SourceField

### Relationships

- single key
- composite key
- different cardinalities

### Target

- TargetDefinition
- multiple TargetStructures
- TargetFields

### Mappings

Test every mapping type.

### Multiple Source References

Prove a mapping can reference multiple source fields.

### Routine Chain

Prove routine order remains stable.

### Serialization

Object → JSON → Object

### Invalid References

Test representative invalid references.

### Profit Center Reference

Create a model-only test fixture representing:

- CEPC-like source
- CEPCT-like source
- CEPC_BUKRS-like source
- Profit Center target
- Company Codes target
- Translation target

This does not require reading files yet.

---

## 12. Inputs

SPEC-001 does not parse the actual source files.

The Profit Center files are used as domain reference material.

File parsing belongs to later specifications.

---

## 13. Outputs

Expected implementation output:

packages/mapping-core/

containing canonical:

- types
- schemas/validators
- serialization
- domain validation
- tests

Exact internal file organization may be proposed by the implementation agent.

---

## 14. Out of Scope

Do not implement:

- CSV parser
- Excel parser
- SAP field dictionary parser
- profiling
- transformation execution
- actual date conversion
- UUID generation
- React
- React Flow
- PCF
- Power Apps
- Power Automate
- SharePoint
- AI

---

## 15. Definition of Done

SPEC-001 is complete when:

- Required canonical TypeScript model exists.
- Profit Center reference can be represented.
- Multi-structure targets work.
- Composite relationships work.
- Multiple source references work.
- All initial mapping types can be represented.
- Routine chains can be represented.
- JSON round-trip works.
- Invalid references can be identified.
- Tests pass.
- mapping-core contains no UI or Power Platform dependency.
- Documentation reflects significant implementation decisions.

---

## 16. Completion Report

The implementing developer or coding agent must report:

1. Files created
2. Files modified
3. Domain-model choices
4. Runtime validation approach used
5. Tests created
6. Tests executed
7. Test results
8. Assumptions
9. Open questions
10. Any recommended follow-up changes to SPEC-002 or later specifications

---

## Completion Report (M1)

1. **Files created:** `packages/mapping-core/{package.json,tsconfig.json,src/*.ts}`, `packages/mapping-core/test/*.test.ts` and `fixtures/`, `tests/milestones/m1-canonical-model/`, `tsconfig.base.json`.
2. **Files modified:** `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierignore`, `docs/ARCHITECTURE.md` (section 14), `CLAUDE.md`.
3. **Domain-model choices:** see `docs/ARCHITECTURE.md` section 14.
4. **Runtime validation:** Zod 4 structural parse plus a pure semantic `validateProject` / `validateSnapshot`.
5. **Tests created:** 99 across source/target, mapping, serialization (with golden JSON), validation, snapshot/run/diagnostic, boundaries, and the M1 milestone demo check.
6. **Tests executed:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run coverage`, `prettier --check`.
7. **Results:** all pass; 94.6% line coverage.
8. **Assumptions:** the 13 design points in the design review were adopted as recommended (user said "continue with milestones").
9. **Open questions:** condition language is minimal (SPEC-012 may extend); `generation` semantics finalised in SPEC-013; Ready/Approved marker for snapshots belongs to SPEC-027 (not stored inside the immutable snapshot).
10. **Follow-ups:** SPEC-007 target parser needs a user-supplied layout config. SPEC-020/025 implement the four key checks (unmapped key warning, duplicate key, parent-child link, driver suggestion). `fingerprint` on sources is filled by importers.
