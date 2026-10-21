# SPEC-019: Custom JavaScript Sandbox

## Status
Draft

## Objective
Allow advanced transformations using controlled JavaScript.

## Contract
transform(value, row, context)

## Allowed Inputs
- Current value
- Current row
- Safe context
- Approved lookup helpers

## Forbidden Access
- Filesystem
- Network
- OS commands
- Process execution
- Environment variables
- Credentials
- Arbitrary package loading

## Requirements
- Execution timeout.
- Structured errors.
- Sample testing.
- Runtime failure must not crash the complete transformation.

## Acceptance Criteria
- Valid routine executes.
- Syntax errors are reported.
- Runtime errors are reported.
- Long-running routine is terminated.
- Forbidden capabilities are inaccessible.

## Out of Scope
- General-purpose Node.js plugins
