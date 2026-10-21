# SPEC-022: Mapping Table

## Status
Draft

## Objective
Provide the primary table-first field mapping interface.

## Columns
- Target Structure
- Target Field
- Required
- Source / Value
- Transformation
- Status

## Statuses
- Mapped
- Needs Review
- Unmapped
- Error

## Requirements
Selecting a row opens an editor containing:
- Target metadata
- Source selection
- Source samples
- Mapping type
- Transformation configuration
- Preview

## Acceptance Criteria
- Required unmapped fields are easily identifiable.
- Mapping modifications update canonical mapping state.
- Mapping completeness is visible by structure.

## Out of Scope
- React Flow visualization
