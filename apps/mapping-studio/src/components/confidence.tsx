import { confidenceBand, type ConfidenceBand, type MappingSuggestion } from '@mms/mapping-suggest';

export const BAND_STYLE: Record<
  ConfidenceBand,
  { label: string; bg: string; color: string; line: string }
> = {
  high: { label: 'High', bg: '#DDF3E7', color: '#12603A', line: '#1E8A52' },
  medium: { label: 'Medium', bg: '#FFF1CC', color: '#6B4700', line: '#B36B00' },
  low: { label: 'Low', bg: '#EEF0F4', color: '#3F4655', line: '#6B7080' },
};

export const ORIGIN_LABEL: Record<MappingSuggestion['origin'], string> = {
  rules: 'Rules',
  ai: 'AI',
  both: 'Rules and AI',
};

const tag = {
  display: 'inline-block',
  fontSize: 12,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
} as const;

/** The confidence of a suggestion as a percentage and a band word, never colour alone. */
export function ConfidenceTag({ score, testId }: { score: number; testId?: string }) {
  const b = BAND_STYLE[confidenceBand(score)];
  return (
    <span style={{ ...tag, background: b.bg, color: b.color }} data-testid={testId}>
      {Math.round(score * 100)}% {b.label}
    </span>
  );
}

export function OriginTag({
  origin,
  testId,
}: {
  origin: MappingSuggestion['origin'];
  testId?: string;
}) {
  return (
    <span
      style={{
        ...tag,
        background: origin === 'rules' ? '#EEF0F4' : '#E5EAFB',
        color: origin === 'rules' ? '#3F4655' : '#1F3A8A',
      }}
      data-testid={testId}
    >
      {ORIGIN_LABEL[origin]}
    </span>
  );
}

export function ConflictTag({
  count,
  testId,
  title,
}: {
  count: number;
  testId?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{ ...tag, background: '#FDEBD9', color: '#7A3A00' }}
      data-testid={testId}
    >
      ⚠ {count} {count === 1 ? 'conflict' : 'conflicts'}
    </span>
  );
}
