# SPEC-007: Target Structure Parser

## Status
Draft

## Objective
Convert target CSV/XLSX structure definitions into canonical TargetDefinition objects.

## Reference Input
data_pc.xlsx

## Expected Reference Structures
- Profit Center
- Company Codes
- Translation

## Metadata
Capture where available:
- Structure/sheet
- Group
- Field Description
- Importance
- Type
- Length
- Decimal
- Technical structure
- Technical field
- Key information

## Acceptance Criteria
- Profit Center reference target produces three structures.
- Required fields are identifiable.
- Technical metadata is preserved.
- Parser does not hardcode Profit Center structure names.

## Out of Scope
- Source mapping
- Output generation
