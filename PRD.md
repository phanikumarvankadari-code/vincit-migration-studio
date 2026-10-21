# Migration Mapping Studio

## Product Requirements Document

**Status:** Draft  
**Phase:** MVP / Phase 1  
**Delivery Model:** Local-first  
**Primary Reference Scenario:** SAP ECC Profit Center to SAP S/4HANA target structures

---

## 1. Product Vision

Migration Mapping Studio is a local-first data mapping and transformation application designed for data migration projects.

The product enables migration consultants to:

1. Create a migration project for a business entity.
2. Load multiple CSV and Excel source datasets.
3. Understand source structures and relationships.
4. Load or define one or more target structures.
5. Map source fields to target fields.
6. Apply reusable transformation routines.
7. Configure constants, lookups and conditional rules.
8. Implement exceptional transformations using controlled JavaScript.
9. Test mappings against source data.
10. Preview transformed data directly in the application.
11. Diagnose transformation and validation errors.
12. Trace target values back to source data.
13. Save tested mappings as snapshots.
14. Execute approved mappings against complete datasets.
15. Generate target CSV or Excel output.

The initial reference scenario is SAP ECC Profit Center migration to SAP S/4HANA.

However, the mapping engine must remain generic and must not contain Profit-Center-specific assumptions.

---

## 2. Product Promise

> Get from multiple source files to a tested, trusted target dataset without writing code for common transformation requirements.

---

## 3. Target Users

### Migration Consultant

Needs to create, test, troubleshoot and reuse mappings quickly.

### Functional Consultant

Needs to review business-field mappings, constants, lookups and transformation behavior without programming.

### Data Migration Lead

Needs visibility into mapping readiness, errors, snapshots and migration results.

### Technical Migration Specialist

Needs an escape hatch for complex transformation logic using controlled JavaScript.

---

## 4. Product Principles

### 4.1 Table and Visual Mapper Are Equal Views

The Mapping Table and the Visual Mapper are equal views of the same canonical mapping (see PD-003).

The Mapping Table should immediately answer:

- Which target fields are mapped?
- Which fields are mandatory?
- Which fields are unmapped?
- Which mappings require review?
- Which transformation is being applied?

Example:

| Target Field | Source / Value | Transformation | Status |
|---|---|---|---|
| Profit Center | CEPC.PRCTR | Direct | Mapped |
| Valid From | CEPC.DATAB | Date Routine | Mapped |
| Description | CEPCT.LTEXT | Direct | Mapped |
| Language | EN | Constant | Mapped |
| Segment | - | - | Unmapped |

### 4.2 Visual When Valuable

React Flow is used when visualization improves understanding.

Suitable scenarios include:

- source relationships
- lineage
- multiple source fields feeding one target
- routine chains
- lookups
- conditional transformations
- complex data flows

React Flow is not the canonical mapping representation.

### 4.3 Configuration Before Code

Transformation preference order:

1. Direct mapping
2. Constant
3. Built-in routine
4. Lookup
5. Conditional
6. Shared routine
7. Custom JavaScript

### 4.4 Humans Remain in Control

AI may propose mappings and transformations.

The user must be able to:

- Accept
- Modify
- Reject

Approved mappings execute deterministically.

AI must not be required during normal transformation execution.

---

## 5. Core User Journey

Create Project
    ↓
Add Sources
    ↓
Profile Sources
    ↓
Confirm Relationships
    ↓
Load Target
    ↓
Review / Create Mappings
    ↓
Configure Transformations
    ↓
Test
    ↓
Preview Target Data
    ↓
Investigate Warnings / Errors
    ↓
Modify Mapping
    ↓
Test Again
    ↓
Create Snapshot
    ↓
Mark Ready
    ↓
Run Full Dataset
    ↓
Generate Output

---

## 6. Project Workspace

The application shall organize project work into:

1. Sources
2. Target
3. Map
4. Test
5. Ready

A project should contain:

- Project ID
- Project name
- Business entity
- Source definitions
- Source datasets
- Dataset relationships
- Target definition
- Mapping definition
- Routines
- Lookups
- Validation rules
- Draft history
- Mapping snapshots
- Test runs
- Full runs

Project changes should autosave.

Users should not be required to manually maintain version numbers.

---

## 7. Source Management

Phase 1 supports local:

- CSV
- XLSX

Multiple files can belong to one project.

An Excel workbook may contain multiple sheets.

Each selected sheet becomes a source dataset.

---

## 8. Source Metadata

For every dataset, expose:

- Dataset name
- Source file
- Row count
- Column count

For every field, support:

- Display Name
- Technical Name
- Datatype
- Length
- Key indicator
- Nullable
- Fill/null percentage
- Uniqueness information
- Representative values

Technical metadata is optional.

Generic CSV/Excel sources must remain usable without an SAP field dictionary.

---

## 9. Source Profiling

The application should profile source data to help users understand its actual contents.

Initial capabilities:

- row count
- null count
- fill percentage
- representative values
- inferred datatype
- uniqueness indicator
- distinct counts where practical

Profiling must remain separate from file import.

---

## 10. Source Relationships

Relationships must support:

- single-field keys
- composite keys
- one-to-one
- one-to-many
- many-to-one
- potential many-to-many warning
- inner join
- left join

Example:

CEPC.PRCTR + CEPC.KOKRS
          ↓
CEPCT.PRCTR + CEPCT.KOKRS

The application may suggest relationships based on:

- technical field names
- display names
- datatype compatibility
- key information
- observed value overlap
- uniqueness/cardinality

Suggested relationships require human confirmation.

---

## 11. Target Definition

A target definition may be:

1. Loaded from a CSV/Excel structure definition.
2. Created manually.

A Target Definition contains one or more Target Structures.

A Target Structure contains Target Fields.

Target fields should support:

- Display Name
- Technical Name
- Datatype
- Length
- Decimal information where applicable
- Required flag
- Key flag
- Description

The engine must not assume one flat target table.

---

## 12. Profit Center Reference Scenario

The initial reference target contains three structures.

### Profit Center

Representative fields:

- Profit Center
- Valid From
- Valid To
- Profit Center Name
- Description
- Person Responsible
- User Responsible
- Standard Hierarchy Node
- Segment
- Department
- Address
- Country
- Language
- Telephone

### Company Codes

Representative fields:

- Profit Center
- Valid To
- Company Code

This structure proves one-to-many target generation.

### Translation

Representative fields:

- Profit Center
- Valid To
- Language
- Profit Center Name
- Profit Center Description

---

## 13. Canonical Mapping Model

The canonical mapping model is the core product asset.

It must remain independent from:

- React
- React Flow
- Fluent UI
- Power Apps
- PCF
- browser APIs
- AI providers
- Power Automate

Core concepts:

- Project
- SourceDefinition
- SourceDataset
- SourceField
- Relationship
- TargetDefinition
- TargetStructure
- TargetField
- MappingDefinition
- FieldMapping
- Routine
- Lookup
- ValidationRule
- MappingSnapshot
- RunDefinition
- RunResult

The canonical representation must be serializable into a stable format.

---

## 14. Mapping Types

### Direct

Source field directly supplies target field.

Example:

CEPC.PRCTR
→ ProfitCenter

### Constant

A configured value supplies the target.

Example:

"EN"
→ Language

### Lookup

A source value is converted using a lookup table.

Example:

1000
→ FI01

### Conditional

Example:

IF Country = "FI"
THEN CompanyCode = "FI01"
ELSE CompanyCode = "DEFAULT"

### Routine

Example:

CEPC.DATAB
→ Date Conversion
→ ValidFrom

### Custom JavaScript

Source data
→ Sandboxed JavaScript
→ Target value

---

## 15. Routine Library

Routines are reusable deterministic transformations.

Routines must be chainable.

Example:

CEPC.DATAB
    ↓
Zero Date → Null
    ↓
Parse Date
    ↓
Format Date
    ↓
ValidityStartDate

Routine scopes:

- Built-in
- Shared/Approved
- Project-specific

---

## 16. Date Routines

Initial routines:

- Parse Date
- Format Date
- Default Date
- SAP Zero Date → Null
- Date Validation

Example source representations:

- 1/1/26
- 5/1/26
- 12/31/99
- 00000000
- blank
- null

Ambiguous dates must not be silently interpreted.

Input format, locale and century assumptions must be explicit.

---

## 17. Identifier and UUID Routines

Support:

- Preserve existing UUID
- Generate UUID v4
- Generate deterministic UUID
- Fixed UUID
- Prefix identifier
- Suffix identifier

Deterministic UUID generation is important when repeatable migration tests require the same source keys to produce the same identifier.

---

## 18. Text Routines

Initial routines:

- Trim
- Uppercase
- Lowercase
- Concatenate
- Replace
- Substring
- Left Pad
- Right Pad
- Maximum Length
- Null/Empty handling

---

## 19. Numeric Routines

Initial routines:

- Parse
- Format
- Round
- Multiply
- Divide

---

## 20. Custom JavaScript

Advanced users may create transformations using JavaScript.

Conceptual function:

transform(value, row, context)

Allowed inputs include:

- Current value
- Current row
- Safe transformation context
- Approved lookup helpers

Custom JavaScript must execute inside a sandbox.

It must not have unrestricted access to:

- filesystem
- operating system
- processes
- network
- environment variables
- application credentials
- arbitrary packages

Users must be able to test JavaScript using sample data.

---

## 21. Mapping Workspace

The Mapping Table and the Visual Mapper (section 22) are equal views. This section describes the Mapping Table.

Default columns:

- Target Structure
- Target Field
- Required
- Source / Value
- Transformation
- Status

Statuses:

- Mapped
- Needs Review
- Unmapped
- Error

Selecting a mapping opens a side-panel editor.

The editor provides:

- target metadata
- source selection
- sample source values
- mapping type
- routine configuration
- constant configuration
- lookup configuration
- immediate preview

---

## 22. React Flow (Visual Mapper)

React Flow provides the Visual Mapper, an equal view alongside the Mapping Table.

Example:

CEPC.DATAB
   |
   v
Zero Date → Null
   |
   v
Convert Date
   |
   v
ValidityStartDate

React Flow reads/writes the canonical mapping model.

React Flow nodes and edges must not become the authoritative mapping representation.

Transformation execution must work without React Flow running.

---

## 23. Testing

Testing is part of mapping development.

Primary cycle:

Map
→ Test
→ Preview
→ Diagnose
→ Fix
→ Test Again

Suggested sample sizes:

- 100 rows
- 1,000 rows
- all rows when safe

---

## 24. Result Grid

Test results appear inside the application.

Example:

| ProfitCenter | Company | Description | ValidFrom | Status |
|---|---|---|---|---|
| 100001 | FI01 | Finance | 2026-01-01 | Ready |
| 100002 | FI01 | Sales | 2026-01-01 | Ready |
| 100003 | FI01 | Logistics | Invalid | Error |

Users should not need to repeatedly generate and open Excel files while developing mappings.

---

## 25. Validation and Diagnostics

Results include:

- Ready
- Warning
- Error

Diagnostics should identify where practical:

- dataset
- source row
- source field
- source value
- target structure
- target field
- mapping
- routine
- error code
- business-readable explanation
- technical detail

The product should never silently discard invalid records.

---

## 26. Field Lineage

The user should be able to answer:

> Where did this target value come from?

Simple example:

FI01
  ↑
Company Code Lookup
  ↑
1000
  ↑
CEPC.KOKRS

Complex example:

Target Value
    ↑
Routine 3
    ↑
Routine 2
    ↑
Lookup
    ↑
Source Field
    ↑
Original Source Value

---

## 27. Mapping History and Snapshots

Draft changes autosave.

Users should not manually maintain technical version numbers.

Important states are saved as named snapshots.

Examples:

- Initial Mapping
- SIT Cycle 1
- SIT Cycle 2
- Approved Mapping

Snapshots must contain sufficient information to reproduce execution.

---

## 28. Local Execution

Phase 1 runs locally.

Process:

Local Source Files
        ↓
Approved Mapping
        ↓
Transformation
        ↓
Validation
        ↓
Target Datasets
        ↓
Local CSV/XLSX

Run summary includes:

- start time
- completion time
- mapping snapshot
- input count
- output count
- warning count
- error count
- generated files

---

## 29. Technology Direction

Primary language:

TypeScript

Development:

- Visual Studio Code
- Git
- Node.js
- npm

UI:

- React
- TypeScript
- Microsoft Fluent UI

Visual mapping:

- React Flow

Later Microsoft integration:

- Power Apps
- Power Apps Component Framework

Later automation:

- Power Automate
- SharePoint

---

## 30. Delivery Phases

### Phase A: Core

- Canonical model
- CSV importer
- XLSX importer
- Field dictionary importer
- Source profiler
- Relationship model/engine
- Target parser
- Mapping engine
- Routine library
- Test engine

### Phase B: User Experience

- React application
- Mapping Table
- React Flow
- Result Grid
- Validation
- Lineage

### Phase C: Microsoft Integration

- PCF packaging
- Power Apps integration
- Project administration

### Phase D: AI

- Mapping suggestions
- Routine recommendations
- Relationship suggestions
- Mapping explanation

### Phase E: Automation

- SharePoint
- Power Automate
- Scheduling
- Input/Output folders
- Archive/Error handling

---

## 31. Phase 1 Out of Scope

Do not implement during the initial MVP:

- SharePoint integration
- FTP/SFTP
- Scheduling
- Azure dependencies
- Remote folders
- Automated archive folders
- Automated error folders
- Direct SAP API integration
- Generic API orchestration
- Make.com clone

---

## 32. Golden Test Scenario

Reference source files:

test-data/profit-center/input/CEPC.csv
test-data/profit-center/input/CEPCT.csv
test-data/profit-center/input/CEPC_BUKRS.csv
test-data/profit-center/input/field_dictionary.csv

Reference target:

test-data/profit-center/target/data_pc.xlsx

The scenario must prove:

- multiple source datasets
- composite relationships
- source metadata
- multiple target structures
- direct mapping
- constants
- routines
- date conversion
- lookup
- one-to-many generation
- validation
- lineage
- snapshots
- local output

---

## 33. MVP Success Criteria

MVP succeeds when a consultant can:

1. Create a project.
2. Import Profit Center sources.
3. Inspect fields and profiles.
4. Confirm relationships.
5. Load the target definition.
6. See Profit Center, Company Codes and Translation structures.
7. Map fields.
8. Apply standard transformations.
9. Test against sample records.
10. Preview transformed data.
11. Diagnose warnings/errors.
12. Trace an output value back to source.
13. Create an approved snapshot.
14. Run the full dataset locally.
15. Generate target output.

AI is not required to prove the MVP.

Cloud infrastructure is not required to prove the MVP.