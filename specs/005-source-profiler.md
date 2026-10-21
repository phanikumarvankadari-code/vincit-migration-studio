# SPEC-005: Source Data Profiler

## Status
Draft

## Objective
Profile imported source datasets to help users understand content and data quality.

## Inputs
Canonical SourceDataset plus source rows.

## Outputs
Profile information for datasets and fields.

## Requirements
Calculate where practical:
- Row count
- Null count
- Fill percentage
- Distinct count
- Uniqueness indicator
- Inferred datatype
- Representative values

Profiling must remain separate from import.

## Acceptance Criteria
- CEPC-like datasets can be profiled.
- Null/fill statistics are accurate.
- Representative values are available.
- Profiling does not modify source data.
- Profiling failures return diagnostics.

## Out of Scope
- File parsing
- Target mapping
