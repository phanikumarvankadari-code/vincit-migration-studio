import type { Diagnostic } from '@mms/mapping-core';

export interface DiagnosticGroup {
  code: string;
  severity: Diagnostic['severity'];
  count: number;
  /** One example message, for the list. */
  message: string;
  targetStructureId?: string;
  targetFieldId?: string;
  firstTargetRow?: number;
  firstSourceRow?: number;
}

const order: Record<Diagnostic['severity'], number> = { error: 0, warning: 1, info: 2 };

/**
 * Collapses repeated diagnostics (the same code on the same structure and field) into one line with a count, worst
 * first. This is the data for a diagnostics list that links to the rows in the result grid.
 */
export function summarizeDiagnostics(diagnostics: readonly Diagnostic[]): DiagnosticGroup[] {
  const groups = new Map<string, DiagnosticGroup>();
  for (const x of diagnostics) {
    const key = [x.severity, x.code, x.targetStructureId ?? '', x.targetFieldId ?? ''].join('|');
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (g.firstTargetRow === undefined && x.targetRow !== undefined)
        g.firstTargetRow = x.targetRow;
      continue;
    }
    groups.set(key, {
      code: x.code,
      severity: x.severity,
      count: 1,
      message: x.message,
      ...(x.targetStructureId ? { targetStructureId: x.targetStructureId } : {}),
      ...(x.targetFieldId ? { targetFieldId: x.targetFieldId } : {}),
      ...(x.targetRow !== undefined ? { firstTargetRow: x.targetRow } : {}),
      ...(x.sourceRow !== undefined ? { firstSourceRow: x.sourceRow } : {}),
    });
  }
  return [...groups.values()].sort(
    (a, b) =>
      order[a.severity] - order[b.severity] || b.count - a.count || a.code.localeCompare(b.code),
  );
}

/** The diagnostics of one output row, to show next to it in the grid. */
export function diagnosticsForRow(
  diagnostics: readonly Diagnostic[],
  targetStructureId: string,
  targetRow: number,
): Diagnostic[] {
  return diagnostics.filter(
    (x) => x.targetStructureId === targetStructureId && x.targetRow === targetRow,
  );
}

/** The output rows a diagnostic belongs to are found by its structure and row, so the list can jump to the grid. */
export const rowOf = (
  x: Diagnostic,
): { targetStructureId: string; targetRow: number } | undefined =>
  x.targetStructureId && x.targetRow !== undefined
    ? { targetStructureId: x.targetStructureId, targetRow: x.targetRow }
    : undefined;
