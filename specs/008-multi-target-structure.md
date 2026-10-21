# SPEC-008: Multiple Target Structures

## Status
Draft

## Objective
Support migration objects containing multiple target structures.

## Requirements
- TargetDefinition contains unlimited TargetStructures.
- Mappings belong to a specific target structure.
- Each structure may have independent keys and required fields.
- Test results must distinguish target structures.

## Reference Scenario
Profit Center:
- Profit Center
- Company Codes
- Translation

## Acceptance Criteria
- Three structures can coexist.
- Mapping completeness can be calculated independently per structure.
- Output rows remain associated with their target structure.

## Out of Scope
- Final file packaging
