# SPEC-027: Mapping History and Snapshots

## Status
Draft

## Objective
Autosave mapping changes and preserve reproducible named mapping states.

## Examples
- Initial Mapping
- SIT Cycle 1
- SIT Cycle 2
- Approved Mapping

## Requirements
- Draft autosave.
- Named snapshots.
- Immutable snapshot semantics.
- Ready/Approved marker.
- Snapshot contains sufficient execution configuration.

## Acceptance Criteria
- Mapping snapshot can be reloaded.
- Reloaded snapshot behaves equivalently.
- Later draft changes do not modify older snapshots.

## Out of Scope
- Multi-user collaborative editing
