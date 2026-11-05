import { Button, Input, MessageBar, MessageBarBody, Text } from '@fluentui/react-components';
import { useState } from 'react';
import { useWorkspace } from '../workspace';
import {
  BrowserCustomersBanner,
  OpenWorkspaceButton,
  Page,
  TopBar,
  WorkspaceNoticeBar,
} from './shared';

const STEPS = [
  ['1', 'Add a project', 'The migration engagement that everything below belongs to.'],
  [
    '2',
    'Add business objects',
    'Profit Center, Cost Center, Vendor: one mapping each, with its own files.',
  ],
  [
    '3',
    'Map, test and export',
    'Suggested mappings, tests on real rows, and transformed files saved in the object’s output folder.',
  ],
] as const;

/** First run: no customer yet. */
export function Welcome() {
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [where, setWhere] = useState<'folder' | 'browser'>(
    ws.canChooseFolder ? 'folder' : 'browser',
  );
  const [message, setMessage] = useState<string | undefined>();

  const submit = async () => {
    setMessage(undefined);
    if (name.trim() === '') {
      setMessage('Give the project a name.');
      return;
    }
    if (where === 'folder' && ws.connection.kind !== 'folder') {
      const c = await ws.chooseFolder();
      if (!c.ok) return setMessage(c.message);
      if (!c.chosen)
        return setMessage('No folder was chosen. Choose one, or keep the files in this browser.');
    }
    const r = await ws.addCustomer(name, '');
    if (!r.ok) setMessage(r.message);
  };

  return (
    <Page testId="home">
      <TopBar />
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 64,
          alignItems: 'flex-start',
          maxWidth: 1344,
          width: '100%',
          boxSizing: 'border-box',
          margin: '0 auto',
          padding: '64px 48px',
        }}
      >
        <div style={{ flex: '1 1 100%', marginBottom: -32 }}>
          <WorkspaceNoticeBar />
          <BrowserCustomersBanner />
        </div>
        <div
          style={{
            flex: '1 1 520px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
            }}
          >
            Getting started
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: 44,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: '-0.025em',
            }}
          >
            Plan, map and test every migration object in one place
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 17,
              lineHeight: 1.6,
              color: 'var(--ink-2)',
              maxWidth: 540,
            }}
          >
            Vincit Migration Studio keeps each project’s source files, mappings, test results and
            transformed output together in a folder your team already shares.
          </p>
          <ol
            style={{
              margin: '8px 0 0',
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              maxWidth: 540,
            }}
          >
            {STEPS.map(([n, title, text]) => (
              <li key={n} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'var(--brand-soft)',
                    color: 'var(--brand)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    flex: 'none',
                  }}
                >
                  {n}
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{title}</div>
                  <div
                    style={{ fontSize: 14, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}
                  >
                    {text}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div
          className="mms-panel"
          style={{
            flex: '0 1 500px',
            minWidth: 300,
            padding: 32,
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
            boxShadow: '0 8px 28px rgba(21,24,30,.08)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Create your first project</h2>
          {message && (
            <MessageBar intent="error" data-testid="home-message">
              <MessageBarBody>{message}</MessageBarBody>
            </MessageBar>
          )}
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Project name
            <Input
              aria-label="Project name"
              placeholder="For example, Vincit"
              value={name}
              onChange={(_, d) => setName(d.value)}
            />
          </label>
          <fieldset
            style={{
              border: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <legend style={{ fontSize: 14, fontWeight: 600, padding: '0 0 8px' }}>
              Where should the files be kept?
            </legend>
            {ws.canChooseFolder && (
              <label
                style={{
                  display: 'flex',
                  gap: 14,
                  alignItems: 'flex-start',
                  padding: '14px 16px',
                  borderRadius: 8,
                  border:
                    where === 'folder' ? '2px solid var(--brand)' : '1px solid var(--line-strong)',
                  background: where === 'folder' ? '#F5F7FE' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="where"
                  checked={where === 'folder'}
                  onChange={() => setWhere('folder')}
                  style={{ marginTop: 4, accentColor: '#1F3A8A' }}
                />
                <span>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>
                    A OneDrive folder{' '}
                    <span
                      className="mms-tag"
                      style={{ background: '#DCE4FB', color: '#1F3A8A', marginLeft: 6 }}
                    >
                      Recommended
                    </span>
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13,
                      color: 'var(--ink-2)',
                      marginTop: 4,
                      lineHeight: 1.5,
                    }}
                  >
                    Choose a folder inside your synced OneDrive. Your team sees the same projects
                    and OneDrive keeps the version history.
                  </span>
                </span>
              </label>
            )}
            <label
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
                padding: '14px 16px',
                borderRadius: 8,
                border:
                  where === 'browser' ? '2px solid var(--brand)' : '1px solid var(--line-strong)',
                background: where === 'browser' ? '#F5F7FE' : '#fff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="where"
                checked={where === 'browser'}
                onChange={() => setWhere('browser')}
                style={{ marginTop: 4, accentColor: '#1F3A8A' }}
              />
              <span>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>
                  This browser only
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 13,
                    color: 'var(--ink-2)',
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  Suitable for a first look. Files stay on this computer.
                </span>
              </span>
            </label>
          </fieldset>
          <Button appearance="primary" size="large" onClick={() => void submit()}>
            {where === 'folder' ? 'Choose folder and create project' : 'Create project'}
          </Button>
          <div
            style={{
              borderTop: '1px solid var(--line)',
              paddingTop: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
            data-testid="open-existing"
          >
            <Text weight="semibold">Already have a workspace in OneDrive?</Text>
            <Text size={200} className="mms-muted">
              Open the folder that holds your projects. Everything in it loads, and you land on All
              projects.
            </Text>
            <div>
              <OpenWorkspaceButton onMessage={setMessage} />
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            The application does not sign in to Microsoft and never deletes your files. Removed
            items are moved to an archive folder.
          </p>
        </div>
      </main>
    </Page>
  );
}
