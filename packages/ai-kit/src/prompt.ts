import type { Catalog } from './catalog.js';

/**
 * The shapes of the answer, with real names from the project when there are any. Tables, structures and fields are
 * named, never numbered: the app finds the IDs.
 */
export function buildExamples(c: Catalog): Record<string, unknown> {
  const d1 = c.datasets[0];
  const d2 = c.datasets[1] ?? d1;
  const s1 = c.structures[0];
  const target = s1?.fields.find((f) => !f.manual) ?? s1?.fields[0];
  const target2 = s1?.fields.filter((f) => !f.manual)[1] ?? target;
  const f1 = d1?.fields[0];
  const f2 = d1?.fields[1] ?? f1;
  const name = (f: { technicalName?: string; name: string } | undefined, alt: string): string =>
    f?.technicalName ?? f?.name ?? alt;
  return {
    _readMe:
      'Shapes of your answers. Use the names exactly as in catalog.md. Give one JSON block per step; leave out the parts that do not belong to the step.',
    step1_tableDescriptions: {
      tableDescriptions: [
        {
          table: d1?.name ?? '<table>',
          description: '<what the table holds, from the SAP table text>',
        },
      ],
    },
    step2_pairings: {
      pairings: [
        {
          structure: s1?.name ?? '<structure>',
          mainTable: d1?.name ?? '<table>',
          extraTables: d2 && d2 !== d1 ? [d2.name] : [],
          confidence: 'likely',
          reason: '<why this table feeds this structure>',
        },
      ],
    },
    step3_fieldDescriptions: {
      fieldDescriptions: [
        {
          table: d1?.name ?? '<table>',
          field: name(f1, '<field>'),
          description: '<what the field means, from the SAP field text>',
        },
      ],
    },
    step3_mappings: {
      lookups: [
        {
          id: 'lk-example-status-code-to-target-code',
          name: 'Example: status code to target code',
          keyDatatype: 'string',
          valueDatatype: 'string',
          entries: [
            { key: 'A', value: '01' },
            { key: 'B', value: '02' },
          ],
        },
      ],
      mappings: [
        {
          structure: s1?.name ?? '<structure>',
          target: name(target, '<target field>'),
          table: d1?.name ?? '<table>',
          source: name(f1, '<source field>'),
          type: 'direct',
          confidence: 'certain',
        },
        {
          structure: s1?.name ?? '<structure>',
          target: name(target2, '<target field>'),
          table: d1?.name ?? '<table>',
          source: name(f2, '<source field>'),
          type: 'lookup',
          lookup: 'Example: status code to target code',
        },
      ],
    },
  };
}

/**
 * The prompt for a chat AI: a guided wizard in one conversation. Deterministic: the same catalog gives the same text.
 * It is not specific to one business object: it works for any set of SAP source tables and any target template.
 */
export function buildPrompt(c: Catalog): string {
  const structureList = c.structures
    .map((s, i) => `${i + 1}. ${s.name} (${s.fields.length} fields)`)
    .join('\n');
  const tableList = c.datasets
    .map((d) => `${d.name}${d.description ? ` (${d.description})` : ''} - ${d.rows ?? '?'} rows`)
    .join('\n');
  return `# Task: guided mapping for "${c.object}"

You are an experienced SAP data migration consultant, and you run this as a guided session with me in this chat.
The source data is a set of SAP tables (ECC or S/4HANA) exported as files. The target is a migration template with
several structures (tabs). Work in the steps below. Ask me short numbered questions whenever something is unclear,
and wait for my answers before you finish a step. A person reviews everything you propose: a missing mapping is
better than a wrong one.

## What is attached
- \`catalog.md\`: the target structures with their fields, and the source tables with their fields, statistics and,
  for code-like columns, the codes. These names are the ONLY ones you may use in your answers. Never invent a
  table, structure or field name.
- \`examples.json\`: the exact shapes of the JSON you give me after each step.

Source tables:
${tableList}

Target structures:
${structureList}

## Steps
Go step by step. After each step give me ONE JSON code block, then say what comes next. Do not skip ahead.

### Step 0 - Interview
Ask me: which source tables are relevant for this object (for example, posting documents are usually not
master data), which SAP release the data comes from, and anything I already know about which table feeds which
structure. Keep it to a few questions.

### Step 1 - What the source tables are
For each relevant source table, find its description online (the SAP table text, for example in the SAP data
dictionary or SAP Help). Give me a short table and then the JSON (\`tableDescriptions\`, see examples.json).

### Step 2 - Which table feeds which structure
For every target structure propose ONE main source table, and extra tables only if the main table cannot supply the
structure's key or mandatory fields. Use the table descriptions from step 1, the key fields and field names of the
structure, and what the SAP migration object normally reads. Give me, for each structure: main table, extra
tables, a confidence (certain, likely, guess) and a short reason. Ask me about every "guess". After I confirm, give
the JSON (\`pairings\`). Structures that no table in the files can feed are listed as "no source", with the SAP
table that normally holds the data, so I can ask for that extract.

### Step 3 - Fields, one structure at a time
Take the structures in the order above and do this for each, then ask whether to continue:
1. Look up the field descriptions of its main table (and extras) online and give me the JSON
   (\`fieldDescriptions\`). Only the fields that matter for this structure.
2. Compare each target field with the source fields: by meaning first, then by type and length. Use the target field
   descriptions from the catalog, the SAP meaning of the source fields, and the statistics. A name match alone is
   not enough: one technical name can mean different things in different tables.
3. For each target field give: the proposed source (Table.Field), a confidence, a short reason. Mark fields that
   have no source, need a lookup, or need manual work. Ask me about anything unclear.
4. Give the JSON (\`mappings\` and, if needed, \`lookups\`).

### Step 4 - Summary
Counts per structure, the target fields with no source and the SAP tables that would hold them, and open questions.

## Rules for mappings
1. Only two kinds: \`direct\` (one source field, unchanged) and \`lookup\` (one source field through a value table; only
   when catalog.md lists the source codes for that column).
2. Do NOT map date fields (marked "user (date)") and do NOT propose constants, hard-coded values, formulas,
   concatenations or splits. I do those by hand. List such fields as "needs manual".
3. One target field gets at most one mapping. One source field may fill several target fields.
4. Prefer a source field that has data. Columns listed under "Empty in this export" have no values; if the only
   fitting field is empty, tell me instead of dropping it silently.
5. Use only the main table of a structure. A field from an extra table is only usable if a join is listed in
   catalog.md; otherwise tell me it needs a join.
6. Give the source of every non-obvious decision (a web page, the SAP table text) in your table, not in the JSON.
7. Everything here applies to any business object: do not assume this one's structures or tables.

## If I paste an import report
It lists items that could not be imported, with the reason. Fix only those items and answer with one JSON code block
that contains just the corrected items.
`;
}

export function kitReadme(c: Catalog): string {
  return `# AI mapping kit: ${c.object}

One kit for the whole mapping. It never contains your data rows: only names, statistics and the codes of code-like
columns.

1. Open a new chat with an AI that can search the web (Copilot, Gemini, ChatGPT, Claude). Attach \`catalog.md\` and
   \`examples.json\`. Paste the whole of \`PROMPT.md\` as your first message.
2. The AI interviews you and works in steps: table descriptions, which table feeds which structure, then fields
   one structure at a time. Answer its questions.
3. After each step the AI gives one JSON block. In the app open the Map stage, choose "Import AI result", paste it
   and import. Descriptions are added, pairings are shown as "suggested" in the Structures overview, mappings are
   added as "needs review". Nothing you already did is changed.
4. If the app reports skipped items, choose "Copy report for the AI", paste it into the chat, and import the
   corrected JSON.
5. Confirm the pairings in the Structures overview, review the mappings and do the dates and hard-coded values yourself.
`;
}
