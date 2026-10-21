import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { StageState } from '@mms/studio-model';
import { useRef, type ReactNode } from 'react';
import type { Notice } from '../lib/files';

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    marginBottom: tokens.spacingVerticalXL,
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
  },
  hint: { color: tokens.colorNeutralForeground3 },
});

export function Section({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const s = useStyles();
  return (
    <section className={s.section} aria-label={title}>
      <div className={s.sectionHead}>
        <div>
          <Text as="h2" weight="semibold" size={500} block>
            {title}
          </Text>
          {hint && (
            <Text className={s.hint} block>
              {hint}
            </Text>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A button that opens the file chooser. The input has a test id so tests can set files on it. */
export function FileButton({
  label,
  accept,
  multiple,
  onFiles,
  testId,
  appearance,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  testId: string;
  appearance?: 'primary' | 'secondary';
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button appearance={appearance ?? 'secondary'} onClick={() => ref.current?.click()}>
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        data-testid={testId}
        aria-label={label}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}

export function Notices({
  notices,
  onDismiss,
}: {
  notices: readonly Notice[];
  onDismiss: (id: string) => void;
}) {
  return (
    <>
      {notices.map((n) => (
        <MessageBar
          key={n.id}
          intent={n.severity === 'info' ? 'info' : n.severity === 'warning' ? 'warning' : 'error'}
        >
          <MessageBarBody>{n.text}</MessageBarBody>
          <Button
            size="small"
            appearance="transparent"
            onClick={() => onDismiss(n.id)}
            aria-label="Dismiss message"
          >
            Dismiss
          </Button>
        </MessageBar>
      ))}
    </>
  );
}

const STATE_LABEL: Record<StageState, string> = {
  notStarted: 'Not started',
  inProgress: 'In progress',
  attention: 'Needs attention',
  complete: 'Done',
};
const STATE_COLOR: Record<StageState, 'subtle' | 'warning' | 'danger' | 'success'> = {
  notStarted: 'subtle',
  inProgress: 'warning',
  attention: 'danger',
  complete: 'success',
};

export function StageBadge({ state }: { state: StageState }) {
  return (
    <Badge appearance="tint" color={STATE_COLOR[state]} size="small">
      {STATE_LABEL[state]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: 'error' | 'warning' | 'info' }) {
  return (
    <Badge
      appearance="filled"
      color={severity === 'error' ? 'danger' : severity === 'warning' ? 'warning' : 'informative'}
      size="small"
    >
      {severity === 'error' ? 'Error' : severity === 'warning' ? 'Warning' : 'Info'}
    </Badge>
  );
}
