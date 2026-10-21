# SPEC-003: Excel Source Importer

## Status
Draft

## Objective
Convert local Excel workbooks and selected worksheets into canonical SourceDataset objects.

## Inputs
Local XLSX workbook.

## Outputs
One SourceDataset per selected worksheet.

## Requirements
- Discover worksheet names.
- Allow sheet selection.
- Extract headers.
- Preserve empty cells.
- Preserve text values and leading zeros.
- Handle Excel date cells without destructive silent conversion.
- Produce structured diagnostics.

## Acceptance Criteria
- Workbook sheets are discoverable.
- Multiple sheets can become independent datasets.
- Headers are preserved.
- Empty cells do not shift columns.
- Import failures produce diagnostics.

## Out of Scope
- Target parsing
- Data profiling
- Mapping execution
