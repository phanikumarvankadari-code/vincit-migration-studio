import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { useEffect } from 'react';
import { StudioProvider, useStudio } from './context';
import { readSourceFiles } from './lib/files';
import { Home } from './home/Home';
import { browserStorageSupported } from './lib/handle-port';
import { Shell } from './shell/Shell';
import { WorkspaceProvider, useWorkspace } from './workspace';

/** Classic single-project mode: one project in this browser, no customers. Kept for browsers without file storage. */
const classic = (): boolean =>
  new URLSearchParams(window.location.search).has('legacy') || !browserStorageSupported();

/** Reads the object's source files again, so its rows are back without the user adding them. */
function Reattach() {
  const { send } = useStudio();
  const ws = useWorkspace();
  const { readSources, markRowsLoaded } = ws;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const files = await readSources();
      const { imported } = await readSourceFiles(files);
      if (cancelled) return;
      for (const i of imported) send({ type: 'rowsAttached', imported: i });
      markRowsLoaded();
    })();
    return () => {
      cancelled = true;
    };
  }, [readSources, markRowsLoaded, send]);
  return null;
}

function Workspaces() {
  const ws = useWorkspace();
  if (!ws.open) return <Home />;
  return (
    <StudioProvider
      key={`${ws.open.customerFolder}/${ws.open.objectFolder}/${ws.openNonce}`}
      initial={ws.open.workspace}
      persist={ws.persist}
      registerFlush={ws.registerFlush}
    >
      <Reattach />
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
