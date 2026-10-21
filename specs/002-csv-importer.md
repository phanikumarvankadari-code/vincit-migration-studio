# SPEC-002: CSV Source Importer

## Status
Draft

## Objective
Convert local CSV files into canonical SourceDataset objects.

## Inputs
- CEPC.csv
- CEPCT.csv
- CEPC_BUKRS.csv
- field_dictionary.csv

## Output
Canonical SourceDataset plus structured import diagnostics.

## Requirements
- Detect headers.
- Preserve original values.
- Preserve leading zeros.
- Preserve blank values.
- Support quoted fields.
- Support Unicode.
- Support configurable delimiter where required.
- Return structured parsing errors.
- Contain no SAP-specific field hardcoding.

## Acceptance Criteria
- All Profit Center CSV fixtures import successfully.
- Blank values remain distinguishable.
- Leading zeros are preserved.
- Quoted delimiters are handled.
- Malformed input returns structured errors.
- Output conforms to mapping-core contracts.

## Required Tests
- Standard CSV
- Blank values
- Leading zeros
- Quoted commas
- UTF-8
- Malformed rows
- Empty file

## Out of Scope
- Profiling
- Excel
- Relationship detection
- Mapping execution
