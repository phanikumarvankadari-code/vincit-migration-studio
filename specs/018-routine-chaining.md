# SPEC-018: Routine Chaining

## Status
Draft

## Objective
Execute multiple routines against a field in a defined order.

## Example
Source
-> Zero Date to Null
-> Parse Date
-> Format Date
-> Target

## Requirements
- Preserve routine order.
- Output from one routine becomes input to the next.
- Failure identifies the failing routine.
- Lineage contains each transformation step.

## Acceptance Criteria
- Multi-step chain executes in order.
- Chain survives serialization.
- Failure stops or continues according to configured behavior.

## Out of Scope
- Visual React Flow implementation
