# M4 Mapping Types: test cases

Package: `packages/transformation-engine` (plus `SourceRows`/`TargetRows`/lineage contracts in `packages/mapping-core`).
Specs: 009 direct, 010 constant, 011 lookup, 012 conditional, 013 one-to-many generation.

## Milestone demo check (this folder)

Built from the real importers, relationship suggestion and confirmation, and the real target workbook.

| ID | Proves |
|---|---|
| M4-01 | Direct, constant and conditional mappings give the right values; unmapped fields stay blank |
| M4-02 | Lookup resolves keys; a missing key is an error on that row only |
| M4-03 | One Profit Center produces several Company Code rows, parent key kept |
| M4-04 | Lineage traces a generated value back through the join |
| M4-05 | Unconfirmed relationships are not used |
| M4-06 | Structures without mappings are reported |
| M4-07 | Saved and reloaded project gives the identical result |
| M4-08 | Run counts and test-run limit |

## Detailed tests (`packages/transformation-engine/test/engine.test.ts`)

Direct (preserves values, blanks, leading zeros, lineage) · Constant (typed values, lineage, invalid datatype) · Lookup (all five missing-value behaviors, blank key, reuse, lineage) · Conditional (first match, current value, null behavior, ordering, in/and/or/not, no match, lineage, determinism) · Chains (order, routine and JS hooks, failure handling) · One-to-many (three rows for P100, zero rows, independent row validation, lineage through joins, inner/left join, multiple matches, blank keys, composite keys, two-step joins, unconfirmed relationships, `via`, driver inference) · Execution rules (limit, structure filter, no mutation, repeatable, refuses bad models and data).

No Playwright tests: M4 has no UI.
