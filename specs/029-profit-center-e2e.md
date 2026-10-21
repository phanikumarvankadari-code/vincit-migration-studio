# SPEC-029: Profit Center Golden End-to-End Scenario

## Status
Draft

## Objective
Validate the complete MVP using the supplied Profit Center reference scenario.

## Source Fixtures
- CEPC.csv
- CEPCT.csv
- CEPC_BUKRS.csv
- field_dictionary.csv

## Target Definition
- data_pc.xlsx

## Target Structures
- Profit Center
- Company Codes
- Translation

## Required Flow
Import
-> Profile
-> Relationships
-> Parse Target
-> Map
-> Apply Routines
-> Test
-> Validate
-> Inspect Result
-> Inspect Lineage
-> Save Snapshot
-> Reload Snapshot
-> Full Local Run
-> Generate Output

## Required Coverage
- Composite relationships
- Direct mapping
- Constants
- Date routines
- Lookups
- One-to-many generation
- Multiple target structures
- Diagnostics
- Lineage
- Snapshots
- Local output

## Acceptance Criteria
- All three target structures are produced.
- At least one date routine executes.
- At least one lookup or constant executes.
- Company Code one-to-many behavior is proven.
- Result rows are inspectable.
- A target cell can be traced to source.
- Snapshot can be saved/reloaded.
- Full local output is generated without AI.

## Out of Scope
- SharePoint
- Power Automate
- Scheduling
- Direct S/4 upload
