# SPEC-009: Direct Field Mapping

## Status
Draft

## Objective
Directly map a source field to a target field.

## Example
CEPC.PRCTR -> ProfitCenter

## Requirements
- Reference canonical source and target fields.
- Preserve values unless target validation rejects them.
- Produce lineage.
- Return structured errors for missing references.

## Acceptance Criteria
- Valid source value reaches the target unchanged.
- Null handling follows target/mapping configuration.
- Lineage identifies source field and original value.

## Out of Scope
- Transformations
- Lookups
