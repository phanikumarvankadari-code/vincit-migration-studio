import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
} from '@fluentui/react-components';
import { useState } from 'react';
import { listModels, saveAiSettings, type AiProvider, type AiSettings } from '../lib/ai-client';

const SUGGESTED_ANTHROPIC = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'];

/** Which AI gives the suggestions, and how to reach it. Kept in this browser only. */
export function AiSettingsDialog({
  open,
  settings,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: AiSettings;
  onClose: () => void;
  onSave: (s: AiSettings) => void;
}) {
  const [provider, setProvider] = useState<AiProvider>(settings.provider);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);
  const [models, setModels] = useState<string[]>(settings.model ? [settings.model] : []);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | undefined>();
  const [busy, setBusy] = useState(false);

  const current = (): AiSettings => ({ provider, baseUrl, model, apiKey });

  const test = async () => {
    setBusy(true);
    try {
      const found = await listModels(current());
      const list = provider === 'anthropic' && found.length === 0 ? SUGGESTED_ANTHROPIC : found;
      setModels(list);
      if (list.length === 0) {
        setStatus({
          ok: false,
          text: 'Connected, but no model is installed. Run: ollama pull llama3.1',
        });
      } else {
        if (!list.includes(model)) setModel(list[0]!);
        setStatus({
          ok: true,
          text: `Connected. ${list.length} ${list.length === 1 ? 'model' : 'models'} available.`,
        });
      }
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : 'Could not connect.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface aria-label="AI settings">
        <DialogBody>
          <DialogTitle>AI settings</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label>
                <Text block>AI provider</Text>
                <Select
                  aria-label="AI provider"
                  value={provider}
                  onChange={(_, d) => {
                    setProvider(d.value as AiProvider);
                    setModels([]);
                    setModel('');
                    setStatus(undefined);
                  }}
                >
                  <option value="ollama">Local model (Ollama): nothing leaves this computer</option>
                  <option value="anthropic">Anthropic API: your own API key</option>
                </Select>
              </label>
              <Text data-testid="ai-privacy">
                {provider === 'ollama' ? (
                  <>
                    Only field names, technical names, types, lengths, key and required flags and
                    descriptions are sent, to a model running on this computer.{' '}
                    <b>No row values are sent.</b>
                  </>
                ) : (
                  <>
                    Only field names, technical names, types, lengths, key and required flags and
                    descriptions are sent, to Anthropic’s API. <b>No row values are sent.</b> The
                    key is kept in this browser only; anyone using this browser profile can use it.
                  </>
                )}
              </Text>
              {provider === 'ollama' ? (
                <label>
                  <Text block>Ollama address</Text>
                  <Input
                    aria-label="Ollama address"
                    value={baseUrl}
                    onChange={(_, d) => setBaseUrl(d.value)}
                  />
                </label>
              ) : (
                <label>
                  <Text block>API key</Text>
                  <Input
                    aria-label="API key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(_, d) => setApiKey(d.value)}
                  />
                </label>
              )}
              <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
                <label style={{ flex: '1 1 220px' }}>
                  <Text block>Model</Text>
                  <Select aria-label="Model" value={model} onChange={(_, d) => setModel(d.value)}>
                    {models.length === 0 && (
                      <option value="">Test the connection to list models</option>
                    )}
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button onClick={() => void test()} disabled={busy}>
                  {busy ? 'Testing…' : 'Test connection'}
                </Button>
              </div>
              {status && (
                <MessageBar intent={status.ok ? 'success' : 'error'} data-testid="ai-status">
                  <MessageBarBody>{status.text}</MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              onClick={() => {
                const next = { ...current(), baseUrl: baseUrl.trim() || settings.baseUrl };
                saveAiSettings(next);
                onSave(next);
                onClose();
              }}
            >
              Save
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
