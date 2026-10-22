import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { StudioProvider } from './context';
import { Home } from './home/Home';
import { browserStorageSupported } from './lib/handle-port';
import { Shell } from './shell/Shell';
import { WorkspaceProvider, useWorkspace } from './workspace';

/** Classic single-project mode: one project in this browser, no customers. Kept for browsers without file storage. */
const classic = (): boolean =>
  new URLSearchParams(window.location.search).has('legacy') || !browserStorageSupported();

function Workspaces() {
  const ws = useWorkspace();
  if (!ws.open) return <Home />;
  return (
    <StudioProvider
      key={`${ws.open.customerFolder}/${ws.open.objectFolder}`}
      initial={ws.open.workspace}
      persist={ws.persist}
      registerFlush={ws.registerFlush}
    >
      <Shell />
    </StudioProvider>
  );
}

export function App() {
  return (
    <FluentProvider theme={webLightTheme} style={{ height: '100%' }}>
      {classic() ? (
        <StudioProvider>
          <Shell />
        </StudioProvider>
      ) : (
        <WorkspaceProvider>
          <Workspaces />
        </WorkspaceProvider>
      )}
    </FluentProvider>
  );
}
