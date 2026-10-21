# SPEC-020: Mapping Test Engine

## Status
Draft

## Objective
Execute draft mappings against representative source samples.

## Inputs
- Source datasets
- Mapping definition
- Target definition
- Routine definitions
- Lookup definitions
- Sample configuration

## Outputs
- Target datasets
- Diagnostics
- Counts
- Lineage

## Sample Options
- 100 rows
- 1,000 rows
- All rows when safe

## Acceptance Criteria
- Sample mapping executes deterministically.
- Errors do not hide successful rows.
- Target structures are independently identifiable.
- Diagnostics are structured.

## Out of Scope
- UI result grid
- Full production execution
