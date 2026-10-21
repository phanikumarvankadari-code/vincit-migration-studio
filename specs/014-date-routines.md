# SPEC-014: Date Transformation Routines

## Status
Draft

## Objective
Provide deterministic reusable date transformations.

## Required Routines
- Parse Date
- Format Date
- Default Date
- SAP Zero Date to Null
- Date Validation

## Reference Inputs
- 1/1/26
- 5/1/26
- 12/31/99
- 00000000
- blank
- null

## Requirements
- Input format explicit.
- Output format explicit.
- Locale assumptions explicit.
- Century policy explicit.
- Invalid dates return diagnostics.

## Acceptance Criteria
- Valid configured dates convert correctly.
- SAP zero date can become null.
- Ambiguous dates are not silently interpreted.
- Invalid dates return structured errors.

## Out of Scope
- Time-zone conversion unless later required.
