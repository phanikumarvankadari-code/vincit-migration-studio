# M5 Routines: test cases

Packages: `packages/routine-library` (26 built-in routines), `packages/js-sandbox` (QuickJS-based sandbox), engine hook for approved lookups in `packages/transformation-engine`.
Specs: 014 date, 015 UUID and identifier, 016 text, 017 numeric, 018 routine chaining, 019 JavaScript sandbox.

## Milestone demo check (this folder)

Real routine library and real sandbox, run through the engine.

| ID | Proves |
|---|---|
| M5-01 | Project with the library routine definitions is valid |
| M5-02 | Dates convert only with an explicit layout; SAP zero date to null; 12/31/99 handled by a special value |
| M5-03 | Invalid date is a structured error naming the failing routine; other rows unaffected |
| M5-04 | onError continue skips a failing step with a warning |
| M5-05 | Text and numeric chains run in order |
| M5-06 | Numeric errors do not stop the run |
| M5-07 | Deterministic UUID repeats; UUID v4 is explicitly not repeatable |
| M5-08 | Sandboxed JavaScript uses the approved lookup helper |
| M5-09 | JavaScript runtime errors and timeouts are row errors, run completes |
| M5-10 | process, require, fetch, constructor tricks are unreachable |
| M5-11 | Chains survive serialization |
| M5-12 | Lineage lists every step |
| M5-13 | Configuration mistakes caught before a run |

## Detailed tests

| Area | File |
|---|---|
| Date routines: formats, century policy, special values, blanks, invalid dates, configuration errors, chain | `packages/routine-library/test/date.test.ts` |
| Identifiers: SHA-1 and UUID vectors, preserve, v4, deterministic, fixed, prefix, suffix | `packages/routine-library/test/identifier.test.ts` |
| Text: success, null, boundary, invalid input per routine, Unicode | `packages/routine-library/test/text.test.ts` |
| Numeric: parse, format, round, multiply, divide, precision, divide by zero | `packages/routine-library/test/numeric.test.ts` |
| Registry and configuration checks, junk-input safety, repeatability, portability | `packages/routine-library/test/registry.test.ts` |
| Sandbox: valid code, lookup helper, syntax and runtime errors, timeout, memory, forbidden capabilities, repeatability, isolation, sample testing | `packages/js-sandbox/test/sandbox.test.ts` |

SPEC-018 (chaining): order, value passing, failure identification, stop or continue, lineage per step, and serialization are covered by the engine tests (`packages/transformation-engine/test/engine.test.ts`, "transformation chains") and M5-03/04/11/12.

No Playwright tests: M5 has no UI.
