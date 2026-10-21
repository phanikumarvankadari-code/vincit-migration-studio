# SPEC-015: UUID and Identifier Routines

## Status
Draft

## Objective
Provide reusable identifier-generation and preservation routines.

## Required Capabilities
- Preserve UUID
- UUID v4
- Deterministic UUID
- Fixed identifier
- Prefix
- Suffix

## Requirements
Deterministic UUID:
same inputs -> same UUID.

UUID v4:
explicitly non-deterministic.

## Acceptance Criteria
- Existing UUID can be preserved.
- UUID v4 has valid syntax.
- Deterministic UUID repeats for identical keys.
- Different deterministic keys generate different identifiers.

## Out of Scope
- External identifier services
