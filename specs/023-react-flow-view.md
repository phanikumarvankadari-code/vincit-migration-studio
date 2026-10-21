# SPEC-023: React Flow Visual Mapping

## Status
Draft

## Objective
Visualize relationships, complex transformation chains and lineage.

## Technology
React Flow

## Requirements
Visualize:
- Dataset relationships
- Multi-source mappings
- Routine chains
- Lookups
- Conditions
- Lineage

React Flow must operate on the canonical mapping model.

## Acceptance Criteria
- Canonical mapping can render visually.
- Supported visual edits update canonical state.
- Reload reconstructs equivalent visualization.
- Mapping execution does not require React Flow.

## Out of Scope
- Canonical business logic inside React Flow nodes
