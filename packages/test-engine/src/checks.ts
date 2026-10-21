import type { Diagnostic, ModelParts, SourceValue, TargetStructure } from '@mms/mapping-core';
import type { RowStatus, TargetOutput } from '@mms/transformation-engine';

const blank = (v: SourceValue | undefined): boolean => v === null || v === undefined || v === '';
const d = (
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  extra: Partial<Diagnostic>,
): Diagnostic => ({ severity, code, message, ...extra }) as Diagnostic;

export interface CheckedTargets {
  diagnostics: Diagnostic[];
  /** Row status after the checks (engine status or worse). */
  rowStatus: Map<string, RowStatus[]>;
}

const rank: Record<RowStatus, number> = { ready: 0, warning: 1, error: 2 };
const worse = (a: RowStatus, b: RowStatus): RowStatus => (rank[a] >= rank[b] ? a : b);

/**
 * Checks on the produced rows:
 * - a mapped key field must not be blank (TARGET_KEY_BLANK) and a mapped required field must not be blank
 *   (TARGET_REQUIRED_BLANK). Fields without a mapping are left to the pre-flight warnings, so a draft that is only
 *   partly mapped does not get an error on every row;
 * - no two rows of a structure may have the same key (TARGET_DUPLICATE_KEY), when all key fields are mapped;
 * - every row of a child structure needs a parent row (TARGET_PARENT_MISSING). When the parent structure was only
 *   sampled, the check is skipped and reported once (TARGET_PARENT_CHECK_SKIPPED).
 * Every diagnostic carries the output row number, so rows can be found in the result.
 */
export function checkTargetRows(
  model: ModelParts,
  outputs: readonly TargetOutput[],
): CheckedTargets {
  const diagnostics: Diagnostic[] = [];
  const rowStatus = new Map<string, RowStatus[]>(
    outputs.map((o) => [o.rows.targetStructureId, [...o.rowStatus]]),
  );
  const structures = new Map<string, TargetStructure>(
    (model.targetDefinition?.structures ?? []).map((s) => [s.id, s]),
  );
  const bump = (structureId: string, row: number, status: RowStatus): void => {
    const list = rowStatus.get(structureId);
    if (list) list[row - 1] = worse(list[row - 1] ?? 'ready', status);
  };

  for (const out of outputs) {
    const s = structures.get(out.rows.targetStructureId);
    if (!s) continue;
    const idx = new Map(out.rows.fieldIds.map((id, i) => [id as string, i]));
    const mapped = new Set(
      model.mappingDefinition.mappings
        .filter((m) => m.targetStructureId === s.id)
        .map((m) => m.targetFieldId as string),
    );
    const keys = s.fields.filter((f) => f.isKey);
    const keysMapped = keys.length > 0 && keys.every((k) => mapped.has(k.id));
    const seen = new Map<string, number>();

    out.rows.rows.forEach((row, n) => {
      const targetRow = n + 1;
      const base = {
        targetStructureId: s.id,
        targetRow,
        sourceRow: out.driverRows[n],
      } as Partial<Diagnostic>;
      for (const f of s.fields) {
        if ((!f.isKey && !f.required) || !mapped.has(f.id)) continue;
        if (!blank(row[idx.get(f.id)!])) continue;
        const code = f.isKey ? 'TARGET_KEY_BLANK' : 'TARGET_REQUIRED_BLANK';
        diagnostics.push(
          d(
            'error',
            code,
            `${f.isKey ? 'Key' : 'Required'} field "${f.displayName}" of "${s.name}" is blank in row ${targetRow}.`,
            { ...base, targetFieldId: f.id } as Partial<Diagnostic>,
          ),
        );
        bump(s.id, targetRow, 'error');
      }
      if (keysMapped) {
        const parts = keys.map((f) => row[idx.get(f.id)!]);
        if (!parts.some(blank)) {
          const key = JSON.stringify(parts);
          const first = seen.get(key);
          if (first === undefined) seen.set(key, targetRow);
          else {
            diagnostics.push(
              d(
                'error',
                'TARGET_DUPLICATE_KEY',
                `Row ${targetRow} of "${s.name}" repeats the key (${parts.join(', ')}) already used by row ${first}.`,
                {
                  ...base,
                  technicalDetails: `key fields: ${keys.map((k) => k.displayName).join(', ')}; first row ${first}`,
                },
              ),
            );
            bump(s.id, targetRow, 'error');
          }
        }
      }
    });
  }

  for (const out of outputs) {
    const s = structures.get(out.rows.targetStructureId);
    if (!s?.parent) continue;
    const parentOut = outputs.find((o) => o.rows.targetStructureId === s.parent!.parentStructureId);
    const parent = structures.get(s.parent.parentStructureId);
    if (!parentOut || !parent) {
      diagnostics.push(
        d(
          'info',
          'TARGET_PARENT_CHECK_SKIPPED',
          `The parent structure of "${s.name}" was not part of this run, so parent links were not checked.`,
          { targetStructureId: s.id } as Partial<Diagnostic>,
        ),
      );
      continue;
    }
    if (parentOut.sampledRowCount < parentOut.driverRowCount) {
      diagnostics.push(
        d(
          'info',
          'TARGET_PARENT_CHECK_SKIPPED',
          `Only ${parentOut.sampledRowCount} of ${parentOut.driverRowCount} rows of "${parent.name}" were run, so parent links of "${s.name}" were not checked.`,
          { targetStructureId: s.id } as Partial<Diagnostic>,
        ),
      );
      continue;
    }
    const mappedFields = (structureId: string): Set<string> =>
      new Set(
        model.mappingDefinition.mappings
          .filter((m) => m.targetStructureId === structureId)
          .map((m) => m.targetFieldId as string),
      );
    const childMapped = mappedFields(s.id);
    const parentMapped = mappedFields(parent.id);
    // Unmapped link fields are reported by pre-flight; checking them would only produce noise.
    if (
      !s.parent.keys.every(
        (k) => childMapped.has(k.childFieldId) && parentMapped.has(k.parentFieldId),
      )
    )
      continue;
    const pIdx = new Map(parentOut.rows.fieldIds.map((id, i) => [id as string, i]));
    const cIdx = new Map(out.rows.fieldIds.map((id, i) => [id as string, i]));
    const parentKeys = new Set(
      parentOut.rows.rows.map((r) =>
        JSON.stringify(s.parent!.keys.map((k) => r[pIdx.get(k.parentFieldId)!] ?? null)),
      ),
    );
    out.rows.rows.forEach((row, n) => {
      const parts = s.parent!.keys.map((k) => row[cIdx.get(k.childFieldId)!] ?? null);
      if (parts.some(blank) || parentKeys.has(JSON.stringify(parts))) return;
      const targetRow = n + 1;
      diagnostics.push(
        d(
          'error',
          'TARGET_PARENT_MISSING',
          `Row ${targetRow} of "${s.name}" has no parent row in "${parent.name}" for (${parts.join(', ')}).`,
          {
            targetStructureId: s.id,
            targetRow,
            sourceRow: out.driverRows[n],
          } as Partial<Diagnostic>,
        ),
      );
      bump(s.id, targetRow, 'error');
    });
  }
  return { diagnostics, rowStatus };
}
