# SPEC-004: Field Dictionary Importer

## Status
Draft

## Objective
Enrich source fields with optional technical metadata.

## Reference Input
field_dictionary.csv

## Requirements
Support metadata such as:
- Table
- Technical field name
- Display name
- Datatype
- Length
- Key indicator
- Reference/check information

Do not replace the original source display name.

Field-dictionary metadata must remain optional.

## Example
Display Name: Profit Center
Technical Name: PRCTR
Dataset: CEPC
Datatype: CHAR
Length: 10
Key: Yes

## Acceptance Criteria
- Matching source fields are enriched.
- Missing dictionary entries do not break imports.
- Ambiguous matches generate diagnostics.
- Generic non-SAP files work without dictionaries.

## Out of Scope
- Mapping execution
- Relationship inference
