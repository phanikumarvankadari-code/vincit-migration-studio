# SPEC-013: One-to-Many Target Generation

## Status
Draft

## Objective
Allow one source business entity to generate multiple records in a target structure.

## Reference Scenario
One Profit Center may produce multiple Company Code target rows.

## Requirements
- Preserve parent/business key linkage.
- Generate zero, one or multiple child rows as configured.
- Produce independent validation for generated rows.
- Preserve lineage.

## Acceptance Criteria
Given Profit Center P100 assigned to FI01, FI02 and SE01,
the target Company Codes structure produces three rows.

## Out of Scope
- SAP-specific hardcoding
