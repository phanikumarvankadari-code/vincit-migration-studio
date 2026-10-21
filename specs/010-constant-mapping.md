# SPEC-010: Constant Mapping

## Status
Draft

## Objective
Populate target fields using configured constant values.

## Example
"EN" -> Language

## Requirements
- Constants preserve intended datatype.
- Configuration is stored in the mapping definition.
- Constant value participates in lineage.

## Acceptance Criteria
- Constant populates every applicable target record.
- Invalid constant datatype produces validation error.
- Snapshot preserves the constant.

## Out of Scope
- Conditional constants
