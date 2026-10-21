import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import { STAGE_LABELS, readinessChecklist } from '@mms/studio-model';
import { Section, StageBadge } from '../components/common';
import { useStudio } from '../context';

const useStyles = makeStyles({
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalS,
  },
  mark: { width: '24px', textAlign: 'center', fontWeight: 700 },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function ReadyStage() {
  const s = useStyles();
  const { state, preflight, statuses, setStage } = useStudio();
  const items = readinessChecklist(state, preflight);
  const done = items.filter((i) => i.done).length;
  return (
    <Section title="Ready" hint="Everything that has to be true before this mapping is trusted.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Text weight="semibold" size={400} data-testid="ready-summary">
          {done} of {items.length} checks done
        </Text>
        <StageBadge state={statuses.ready.state} />
        <Text className={s.muted}>{statuses.ready.summary}</Text>
      </div>
      <ul className={s.list} aria-label="Readiness checklist">
        {items.map((i) => (
          <li key={i.label} className={s.item} data-testid={`check-${i.done ? 'done' : 'open'}`}>
            <span className={s.mark} style={{ color: i.done ? '#1e6b34' : '#a4262c' }} aria-hidden>
              {i.done ? '✓' : '○'}
            </span>
            <Text>{i.label}</Text>
            <span style={{ marginLeft: 'auto' }}>
              {!i.done && (
                <Button size="small" onClick={() => setStage(i.stage)}>
                  Go to {STAGE_LABELS[i.stage]}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <Text className={s.muted}>
        Saving a named snapshot and writing output files are not available in this version yet.
      </Text>
    </Section>
  );
}
