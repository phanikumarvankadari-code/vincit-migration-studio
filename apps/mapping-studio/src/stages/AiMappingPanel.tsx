import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  Text,
  Textarea,
} from '@fluentui/react-components';
import { buildKit, importAiResult, reportToText, type ImportReport } from '@mms/ai-kit';
import { toZip, utf8Bytes } from '@mms/file-export';
import { useRef, useState } from 'react';
import { useStudio } from '../context';
import { MIME, downloadFile } from '../lib/storage';

const safe = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'project';

/** A first mapping with the help of a chat AI: a kit to give to the AI, and a place to bring its answer back. */
export function AiMappingPanel() {
  const { state, send } = useStudio();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [report, setReport] = useState<ImportReport | undefined>();
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const hasTarget = (state.project.targetDefinition?.structures.length ?? 0) > 0;
  const hasSources = state.project.sourceDefinitions.length > 0;

  const createKit = () => {
    const files = buildKit(state.project, state.data);
    const zip = toZip(files.map((f) => ({ name: f.name, data: utf8Bytes(f.content) })));
    downloadFile(
      `${safe(state.project.businessEntity || state.project.name)} - AI mapping kit.zip`,
      zip,
      MIME['zip']!,
    );
  };

  const run = () => {
    const out = importAiResult(state.project, text, new Date().toISOString());
    setReport(out.report);
    setCopied(false);
    const r = out.report;
    if (
      r.imported.length > 0 ||
      r.lookupsAdded.length > 0 ||
      r.tableDescriptions > 0 ||
      r.fieldDescriptions > 0 ||
      r.pairings.length > 0
    )
      send({ type: 'projectEdited', project: out.project });
  };

  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(reportToText(report));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const close = () => {
    setOpen(false);
    setReport(undefined);
    setText('');
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          data-testid="create-ai-kit"
          disabled={!hasTarget || !hasSources}
          title={
            hasTarget && hasSources
              ? 'Files to give to a chat AI for a first mapping'
              : 'Load the sources and the target first'
          }
          onClick={createKit}
        >
          Create AI mapping kit
        </Button>
        <Button data-testid="import-ai-result" disabled={!hasTarget} onClick={() => setOpen(true)}>
          Import AI result
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(_, d) => !d.open && close()}>
        <DialogSurface aria-label="Import AI result" style={{ maxWidth: 760 }}>
          <DialogBody>
            <DialogTitle>Import AI result</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Text>
                  Paste the answer of the AI (the JSON may be inside other text). Valid mappings are
                  added as “needs review”. Nothing you already mapped is changed.
                </Text>
                <Textarea
                  aria-label="AI answer"
                  rows={10}
                  style={{ fontFamily: 'monospace' }}
                  value={text}
                  onChange={(_, d) => setText(d.value)}
                />
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,.txt,.md"
                  hidden
                  data-testid="ai-result-file"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) setText(await f.text());
                  }}
                />
                {report && (
                  <div
                    data-testid="ai-import-report"
                    style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                  >
                    {report.parseError ? (
                      <MessageBar intent="error">
                        <MessageBarBody>{report.parseError}</MessageBarBody>
                      </MessageBar>
                    ) : (
                      <MessageBar intent={report.skipped.length > 0 ? 'warning' : 'success'}>
                        <MessageBarBody>
                          <span data-testid="ai-import-summary">
                            {reportToText(report).split('\n')[0]} Skipped {report.skipped.length}.
                          </span>
                        </MessageBarBody>
                      </MessageBar>
                    )}
                    {report.skipped.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 20 }} data-testid="ai-import-skipped">
                        {report.skipped.map((s, i) => (
                          <li key={i}>
                            Item {s.item}: {s.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    {report.notes.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {report.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    )}
                    <Text>
                      Target fields without a mapping:{' '}
                      {report.unmapped.filter((u) => !u.manual).length} (dates:{' '}
                      {report.unmapped.filter((u) => u.manual).length}, yours to do).
                    </Text>
                  </div>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                data-testid="run-ai-import"
                disabled={!text.trim()}
                onClick={run}
              >
                Import
              </Button>
              <Button onClick={() => fileInput.current?.click()}>Choose a file</Button>
              <Button
                data-testid="copy-ai-report"
                disabled={!report}
                onClick={() => void copyReport()}
              >
                {copied ? 'Copied' : 'Copy report for the AI'}
              </Button>
              <Button onClick={close}>Close</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
