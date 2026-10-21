# Product Decisions

This document records important product decisions that should not be changed casually during implementation.

---

## PD-001: Local-First MVP

Phase 1 runs locally.

Reason:

Validate the mapping engine and user experience before introducing infrastructure and integration complexity.

---

## PD-002: TypeScript-First Development

The main implementation language is TypeScript.

Reason:

One language can cover:

- core mapping model
- transformation engine
- React UI
- routines
- later Microsoft/PCF development

---

## PD-003: Mapping Table and Visual Mapper Are Equal Views

The Mapping Table and the Visual Mapper (React Flow) are two equal views of the same canonical mapping.

Both read and write the canonical mapping model. Neither owns it.

The user can switch between them at any time.

Reason:

Migration consultants need completeness and exception visibility (table) and an understanding of data flow (visual). Both are first-class.

Amended from "Table-First Mapping UX". Layout data for the Visual Mapper (node positions) is UI-only and is not part of the canonical mapping.

---

## PD-004: React Flow Visual Layer

React Flow will be used for:

- lineage
- dataset relationships
- transformation chains
- complex mappings

React Flow is not the canonical mapping model.

---

## PD-005: Multi-Structure Targets

A target definition can contain multiple structures.

The product must not assume one source business object produces one flat table.

Profit Center currently demonstrates:

1. Profit Center
2. Company Codes
3. Translation

---

## PD-006: Configuration Before Code

Preferred transformation hierarchy:

1. Direct
2. Constant
3. Built-in routine
4. Lookup
5. Conditional
6. Shared routine
7. Custom JavaScript

---

## PD-007: Sandboxed JavaScript

JavaScript provides an advanced transformation escape hatch.

It must run with restricted capabilities.

It must not receive unrestricted filesystem, network, process, operating-system or credential access.

---

## PD-008: Test Before Output

Mapping development occurs inside the application.

Users test mappings and inspect transformed rows before creating target files.

Excel is an input/output format, not the debugging experience.

---

## PD-009: Named Snapshots

Users should not manually manage technical version numbers.

Use:

- autosave
- history
- named snapshots
- Ready/Approved state

---

## PD-010: AI Proposes, Humans Approve

AI may suggest:

- mappings
- routines
- relationships

AI suggestions do not become approved mappings automatically.

Runtime execution does not depend on AI.

---

## PD-011: Golden Reference Scenario

SAP ECC Profit Center is the initial end-to-end integration fixture.

This is a reference scenario, not a hardcoded domain model.

---

## PD-012: Planner and Git Have Different Responsibilities

Microsoft Planner manages:

- ownership
- work status
- priority
- planning

Git manages:

- PRD
- architecture
- specifications
- code
- tests
- developer instructions

Coding agents should work primarily from version-controlled Git specifications.

---

## PD-013: Power Platform Comes After Core

Power Platform Tools may be installed during initial development.

However, PCF and Power Apps integration begin only after the local canonical model, transformation engine and core React experience are proven.

---

## PD-014: Automation Is a Later Layer

SharePoint, Power Automate, scheduling and archive/error-folder processing are future capabilities.

They must execute existing approved mappings rather than introduce new mapping semantics.