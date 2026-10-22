import { Button, MessageBar, MessageBarBody, Text } from '@fluentui/react-components';
import type { ValueSuggestion } from '@mms/mapping-suggest';
import { useState } from 'react';
import { ConfidenceTag, OriginTag } from '../components/confidence';
import { useStudio } from '../context';
import {
  AiError,
  aiReady,
  aiSuggestValue,
  loadAiSettings,
  ruleValueFor,
  type AiSettings,
} from '../lib/ai-client';
import { AiSettingsDialog } from './AiSettingsDialog';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Ideas for a hard-coded value: a rule where there is a safe one, and the AI when asked. A person picks. */
export function ValueSuggestions({
  structureId,
  fieldId,
  datatype,
  onUse,
}: {
  structureId: string;
  fieldId: string;
  datatype: string;
  onUse: (value: string) => void;
}) {
  const { state } = useStudio();
  const rule = ruleValueFor(state.project, structureId, fieldId);
  const [ai, setAi] = useState<ValueSuggestion | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  const [showSettings, setShowSettings] = useState(false);

  const ask = async () => {
    if (!aiReady(settings)) {
      setShowSettings(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setAi(
        await aiSuggestValue({
          project: state.project,
          structureId,
          fieldId,
          settings,
          today: new Date().toISOString().slice(0, 10),
        }),
      );
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'The AI suggestion failed.');
    } finally {
      setBusy(false);
    }
  };

  const card = (sg: ValueSuggestion, testId: string) => {
    const invalid = datatype === 'date' && !ISO_DATE.test(sg.value);
    return (
      <div
        key={testId}
        data-testid={testId}
        style={{
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: 12,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Text weight="semibold" style={{ fontFamily: 'monospace' }}>
          {sg.value}
        </Text>
        <ConfidenceTag score={sg.confidence} />
        <OriginTag origin={sg.origin} />
        <Text size={200} className="mms-muted" style={{ flex: '1 1 200px' }}>
          {sg.reason}
          {invalid ? ' This is not a valid date (YYYY-MM-DD), so it cannot be used.' : ''}
        </Text>
        <Button
          size="small"
          appearance="primary"
          disabled={invalid}
          onClick={() => onUse(sg.value)}
        >
          Use this value
        </Button>
      </div>
    );
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      data-testid="value-suggestions"
    >
      <Text weight="semibold">Suggested values</Text>
      {rule && card(rule, 'value-rule')}
      {ai && card(ai, 'value-ai')}
      {!rule && !ai && (
        <Text size={200} className="mms-muted">
          No rule applies to this field. Ask the AI, which sees the field’s name, type and
          description and its sibling fields, never data.
        </Text>
      )}
      {error && (
        <MessageBar intent="error" data-testid="value-error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="small" onClick={() => void ask()} disabled={busy} data-testid="ask-ai-value">
          {busy ? 'Asking…' : 'Ask AI for a value'}
        </Button>
        <Button size="small" appearance="subtle" onClick={() => setShowSettings(true)}>
          AI settings
        </Button>
      </div>
      <AiSettingsDialog
        key={showSettings ? 'open' : 'closed'}
        open={showSettings}
        settings={settings}
        onClose={() => setShowSettings(false)}
        onSave={setSettings}
      />
    </div>
  );
}
