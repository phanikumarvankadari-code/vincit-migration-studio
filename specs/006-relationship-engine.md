# SPEC-006: Source Relationship Engine

## Status
Draft

## Objective
Represent, validate and later suggest relationships between source datasets.

## Requirements
Support:
- Single-field keys
- Composite keys
- 1:1
- 1:N
- N:1
- N:N warning
- Inner joins
- Left joins

## Reference Scenario
CEPC.PRCTR + CEPC.KOKRS
relates to
CEPCT.PRCTR + CEPCT.KOKRS

CEPC also relates to CEPC_BUKRS.

## Future Suggestion Signals
- Technical-name similarity
- Display-name similarity
- Datatype compatibility
- Key metadata
- Value overlap
- Cardinality

Suggested relationships require human confirmation.

## Acceptance Criteria
- Composite relationships are supported.
- One dataset can participate in multiple relationships.
- Relationships serialize correctly.
- Invalid key references return diagnostics.

## Out of Scope
- AI-based relationship suggestions
- Visual relationship editing
