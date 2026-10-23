const tag = {
  display: 'inline-block',
  fontSize: 12,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
} as const;

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
