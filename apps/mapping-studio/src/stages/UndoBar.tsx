import { Button, MessageBar, MessageBarBody } from '@fluentui/react-components';
import { useStudio } from '../context';

/** After a delete: what was removed, with Undo. */
export function UndoBar() {
  const { lastDeleted, undoDelete, dismissUndo } = useStudio();
  if (!lastDeleted) return null;
  return (
    <MessageBar intent="info" data-testid="undo-bar">
      <MessageBarBody>{lastDeleted.message}</MessageBarBody>
      <Button size="small" appearance="primary" onClick={undoDelete}>
        Undo
      </Button>
      <Button size="small" appearance="transparent" onClick={dismissUndo}>
        Dismiss
      </Button>
    </MessageBar>
  );
}
