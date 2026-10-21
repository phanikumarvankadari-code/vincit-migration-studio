# SPEC-025: Validation and Error Diagnostics

## Status
Draft

## Objective
Provide understandable validation results and transformation diagnostics.

## Diagnostic Context
Where available:
- Dataset
- Source row
- Source field
- Source value
- Target structure
- Target field
- Mapping
- Routine
- Error code
- Message
- Technical details

## Severity
- Warning
- Error

## Requirements
Business-readable explanation is primary.

Technical detail can be expanded.

Records must not be silently discarded.

## Acceptance Criteria
Users can identify why a target value or row failed.

## Out of Scope
- AI error correction
