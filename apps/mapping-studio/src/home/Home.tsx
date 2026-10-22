import { Button, MessageBar, MessageBarBody, Spinner } from '@fluentui/react-components';
import { useState } from 'react';
import { Brand } from '../components/brand';
import { useWorkspace } from '../workspace';
import { CustomerHome } from './CustomerHome';
import { Customers } from './Customers';
import { Welcome } from './Welcome';
import { NewCustomerDialog, Page, StorageDialog, TopBar, WorkspaceChoiceDialog } from './shared';

/** The workspace pages: first run, All customers, or one customer. */
function HomePages() {
  const ws = useWorkspace();
  // The New customer dialog lives here, so it stays mounted when a new customer opens its home page.
  const [showNew, setShowNew] = useState(false);

  if (ws.phase === 'loading')
    return (
      <Page testId="home-loading">
        <header className="mms-topbar">
          <Brand />
        </header>
        <Spinner label="Opening the workspace" style={{ paddingTop: 80 }} />
      </Page>
    );

  if (ws.phase === 'error')
    return (
      <Page>
        <TopBar />
        <main className="mms-main">
          <MessageBar intent="error" data-testid="workspace-error">
            <MessageBarBody>{ws.error}</MessageBarBody>
          </MessageBar>
        </main>
      </Page>
    );

  if (ws.connection.kind === 'needsPermission')
    return (
      <Page>
        <TopBar />
        <main className="mms-main">
          <div
            className="mms-panel"
            style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 12 }}
            data-testid="reconnect"
          >
            <h1 className="mms-h2">Reconnect your folder</h1>
            <p className="mms-muted" style={{ margin: 0 }}>
              The browser needs your permission again to use the folder “{ws.connection.name}”. Your
              files in it are untouched.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Button appearance="primary" onClick={() => void ws.reconnectFolder()}>
                Reconnect folder
              </Button>
              <Button onClick={() => void ws.useBrowserStorage()}>
                Use browser storage instead
              </Button>
            </div>
          </div>
        </main>
      </Page>
    );

  if (ws.customers.length === 0) return <Welcome />;
  return (
    <>
      {ws.customerFolder ? <CustomerHome /> : <Customers onNewCustomer={() => setShowNew(true)} />}
      <NewCustomerDialog open={showNew} onClose={() => setShowNew(false)} />
    </>
  );
}

/** The workspace pages, with the dialogs that must outlive a page change. */
export function Home() {
  const ws = useWorkspace();
  return (
    <>
      <HomePages />
      <StorageDialog open={ws.storageDialog} onClose={() => ws.setStorageDialog(false)} />
      <WorkspaceChoiceDialog />
    </>
  );
}
