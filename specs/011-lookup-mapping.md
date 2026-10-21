# SPEC-011: Lookup Mapping

## Status
Draft

## Objective
Convert source values into target values using reusable lookup definitions.

## Example
1000 -> FI01

## Requirements
- Reusable lookup tables.
- Configurable missing-value behavior.
- Lookup diagnostics.
- Source and resolved values included in lineage.

## Missing Value Options
At minimum support architecture for:
- Error
- Warning
- Keep source
- Null/default

## Acceptance Criteria
- Existing key resolves correctly.
- Missing key follows configured behavior.
- Lookup can be reused by multiple mappings.

## Out of Scope
- Remote database lookups
