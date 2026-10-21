# SPEC-016: Text Transformation Routines

## Status
Draft

## Objective
Provide standard reusable text transformations.

## Required Routines
- Trim
- Uppercase
- Lowercase
- Concatenate
- Replace
- Substring
- Left Pad
- Right Pad
- Maximum Length
- Null/Empty handling

## Requirements
- Unicode-safe behavior.
- Explicit null behavior.
- Routine produces lineage information.
- Routine is independently testable.

## Acceptance Criteria
Each routine has success, null, boundary and invalid-input tests.

## Out of Scope
- NLP transformations
