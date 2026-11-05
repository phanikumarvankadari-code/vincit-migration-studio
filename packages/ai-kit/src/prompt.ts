import type { Catalog } from './catalog.js';

/** One correct example of each mapping an AI may propose, with real IDs from the project when there are any. */
export function buildExamples(c: Catalog): Record<string, unknown> {
  const target = c.structures.flatMap((s) =>
    s.fields.filter((f) => !f.manual).map((f) => ({ s, f })),
  );
  const source = c.datasets.flatMap((d) => d.fields.map((f) => ({ d, f })));
  const t1 = target[0];
  const t2 = target[1] ?? target[0];
  const s1 = source[0];
  const s2 = source[1] ?? source[0];
  return {
    _readMe:
      'This is the shape of your answer. Copy IDs from catalog.md exactly. id, transformations and status are optional (the app fills them in).',
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
        targetStructureId: t1?.s.id ?? '<structure ID>',
        targetFieldId: t1?.f.id ?? '<target field ID>',
        mappingType: 'direct',
        sourceReferences: [
          { datasetId: s1?.d.id ?? '<dataset ID>', fieldId: s1?.f.id ?? '<source field ID>' },
        ],
      },
      {
        targetStructureId: t2?.s.id ?? '<structure ID>',
        targetFieldId: t2?.f.id ?? '<target field ID>',
        mappingType: 'lookup',
        sourceReferences: [
          { datasetId: s2?.d.id ?? '<dataset ID>', fieldId: s2?.f.id ?? '<source field ID>' },
        ],
        lookup: { lookupId: 'lk-example-status-code-to-target-code' },
      },
    ],
  };
}

/**
 * The guided prompt for a chat AI. Deterministic: the same catalog gives the same text. It asks for one target
 * structure at a time, questions before guesses, and an answer in the JSON shape the app can import.
 */
export function buildPrompt(c: Catalog): string {
  const structureList = c.structures
    .map(
      (s, i) =>
        `${i + 1}. ${s.name} (${s.fields.length} fields${s.sheet ? `, tab "${s.sheet}"` : ''})`,
    )
    .join('\n');
  const datasetList = c.datasets.map((d) => `${d.name} (${d.rows ?? '?'} rows)`).join(', ');
  return `# Task: propose the first mapping for "${c.object}"

You are an experienced SAP data migration consultant. Source data is a set of SAP tables (ECC or S/4HANA) exported
as files. The target is a migration template with several structures (tabs). Propose which source field fills each
target field. A human reviews everything you propose. Be exact and honest: a missing mapping is better than a wrong one.

## What is attached
- \`catalog.md\` (the same content may also come as \`catalog.json\`): every target structure and field with its Field
  ID, every source table and field with its Field ID, statistics, the joins between source tables, and for code-like
  columns the list of values. These are the ONLY IDs you may use. Never invent or shorten an ID.
- \`examples.json\`: the exact shape of your answer.
You only return the JSON described below, never the whole project.

Source tables: ${datasetList}.

Target structures, in this order:
${structureList}

## Rules
1. Propose only two kinds of mapping:
   - \`direct\`: the target field is filled from exactly one source field, unchanged.
   - \`lookup\`: the target field is filled from one source field through a value table (source code to target code).
     Only when the catalog lists the source codes for that column. Put the table in \`lookups\`.
2. Do NOT map date fields (marked "user (date)" in the catalog) and do NOT propose constants, hard-coded values,
   formulas, concatenations or splits. The user does those by hand. If a target field needs one of them, list it as
   "needs manual" in your table.
3. Match on meaning first, then type and length. A name match alone is not enough: the same technical name can mean
   different things in different tables. Check the target description and the SAP meaning of the field.
4. If no source field in the files fits, do not guess. Say there is no source, and name the SAP table that normally
   holds it (for example ANLB for depreciation keys, ANLT for asset texts) so the user can ask for that extract.
5. If two source fields could fit, or the target field is unclear, ask the user (see the steps) instead of picking.
6. One source field may fill several target fields. One target field gets at most one mapping.
7. Use the joins in the catalog. A target structure takes its rows from one driver table. Fields from other tables are
   reached through the joins. Say which driver table and which joins you assume for each structure.
8. Many SAP columns are empty in the export ("Filled %" is 0 in the catalog). Prefer a source field that has data.
   If the only fitting source field is empty, say so in your table instead of dropping it silently.
9. Research: use the target field descriptions in the catalog, the SAP documentation of this migration object and the
   SAP field texts (table DD03T) where you know them, and search the web when unsure. Name the source of each
   non-obvious decision in your table. Do not put explanations in the JSON.

## Steps (one target structure at a time)
Start with structure 1. Do not move on until the user says so.
1. Say which source table drives the rows of this structure, and which joins you need.
2. Go through the target fields. For each, give: the proposed source (Table.Field), a confidence (certain, likely or
   guess), and a short reason. Mark target fields that have no source, need a lookup, or need manual work.
3. Ask the user numbered questions about everything unclear. Wait for the answers. Then finalise.
4. Return exactly one JSON code block for this structure (shape below), then the table.
5. Ask whether to continue with the next structure.
When all structures are done, give a summary: counts per structure, the target fields with no source, the SAP
tables that would be needed for them, and the open questions.

## Shape of the JSON
Use the shape in \`examples.json\`. Mappings use \`mappingType\` "direct" or "lookup" and exactly one entry in
\`sourceReferences\`: \`{ "datasetId": ..., "fieldId": ... }\` with IDs from the catalog. A lookup mapping also needs
\`"lookup": { "lookupId": "<ID of an entry in lookups>" }\`. Lookup tables go in \`lookups\` with \`name\`, \`keyDatatype\`,
\`valueDatatype\` and \`entries\` (\`key\`, \`value\`) and an \`id\` such as "lk-asset-class".

## If the user pastes an import report
It lists items that could not be imported, with the reason. Fix only those items and answer with one JSON code block
that contains just the corrected items.
`;
}

export function kitReadme(c: Catalog): string {
  return `# AI mapping kit: ${c.object}

Use this with any chat AI (Copilot, Gemini, ChatGPT, Claude). It never sees your data rows: only names, statistics and
the codes of code-like columns.

1. Open a new chat with the AI. Attach \`catalog.md\` and \`examples.json\` (\`catalog.json\` has the same content as \`catalog.md\`
   and is only needed if the chat cannot read the Markdown well). Paste the whole of \`PROMPT.md\` as your first message.
2. Work through the structures one at a time. Answer the AI's questions.
3. Copy the AI's JSON code block. In the app, open the Map stage and choose "Import AI result", paste it and import.
   The valid mappings are added as "needs review". Nothing you already mapped is changed.
4. If the app reports skipped items, choose "Copy report for the AI", paste it into the chat, and import the corrected
   JSON.
5. Review each imported mapping in the Map stage and accept it. Dates and hard-coded values are yours to do.
`;
}
