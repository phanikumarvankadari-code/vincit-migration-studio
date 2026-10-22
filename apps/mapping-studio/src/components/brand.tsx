import type { ObjectSummary } from '@mms/studio-model';
import type { CSSProperties, ReactNode } from 'react';

export const PRODUCT_NAME = 'Vincit Migration Studio';
export const LOGO_SRC = '/vincit-logo.jpeg';

/** The Vincit logo and the product name, as in every page header. */
export function Brand({ size = 40 }: { size?: number }) {
  return (
    <div className="mms-brand">
      <img src={LOGO_SRC} alt="Vincit logo" width={size} height={size} />
      <span>{PRODUCT_NAME}</span>
    </div>
  );
}

export type ProjectState = ObjectSummary['state'];

export const STATE_STYLE: Record<ProjectState, { label: string; bg: string; color: string }> = {
  draft: { label: 'Draft', bg: '#EEF0F4', color: '#3F4655' },
  ready: { label: 'Ready', bg: '#FFF1CC', color: '#6B4700' },
  approved: { label: 'Approved', bg: '#DDF3E7', color: '#12603A' },
};

/** Status as a labelled tag, never colour alone. */
export function StatusTag({ state, testId }: { state: ProjectState; testId?: string }) {
  const s = STATE_STYLE[state];
  return (
    <span className="mms-tag" style={{ background: s.bg, color: s.color }} data-testid={testId}>
      {s.label}
    </span>
  );
}

export function Tag({
  children,
  bg,
  color,
  testId,
}: {
  children: ReactNode;
  bg: string;
  color: string;
  testId?: string;
}) {
  return (
    <span className="mms-tag" style={{ background: bg, color }} data-testid={testId}>
      {children}
    </span>
  );
}

export function Bar({
  pct,
  color = 'var(--brand)',
  style,
}: {
  pct: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <div className="mms-bar" style={style} role="presentation">
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export const pctOf = (mapped: number, fields: number): number =>
  fields === 0 ? 0 : Math.round((mapped / fields) * 100);

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/** The step a business object is at, from what its project holds. */
export const STEPS = ['Sources', 'Target', 'Map', 'Test', 'Ready'] as const;
export function currentStep(sum: ObjectSummary | undefined): number {
  if (!sum || sum.datasets === 0) return 0;
  if (sum.structures === 0) return 1;
  if (sum.mapped < sum.fields) return 2;
  if (sum.snapshots === 0) return 3;
  return 4;
}
