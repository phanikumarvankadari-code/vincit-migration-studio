import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { StudioProvider } from './context';
import { Shell } from './shell/Shell';

export function App() {
  return (
    <FluentProvider theme={webLightTheme} style={{ height: '100%' }}>
      <StudioProvider>
        <Shell />
      </StudioProvider>
    </FluentProvider>
  );
}
