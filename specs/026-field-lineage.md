# SPEC-026: Field Lineage

## Status
Draft

## Objective
Explain how each target value was generated.

## Example
FI01
  ^
Company Code Lookup
  ^
1000
  ^
CEPC.KOKRS

## Requirements
Capture:
- Source dataset
- Source field
- Original value
- Lookup
- Condition
- Routine steps
- Final value

## Acceptance Criteria
A selected target cell can be traced to its source and transformation chain.

## Out of Scope
- Enterprise-wide data catalog lineage
