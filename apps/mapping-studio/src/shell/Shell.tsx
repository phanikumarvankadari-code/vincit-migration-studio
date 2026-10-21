import {
  Badge,
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
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { STAGES, STAGE_LABELS } from '@mms/studio-model';
import { useState } from 'react';
import { FileButton, StageBadge } from '../components/common';
import { useStudio } from '../context';
import { MapStage } from '../stages/MapStage';
import { ReadyStage } from '../stages/ReadyStage';
import { SourcesStage } from '../stages/SourcesStage';
import { TargetStage } from '../stages/TargetStage';
import { TestStage } from '../stages/TestStage';

const useStyles = makeStyles({
  app: {
    display: 'grid',
    gridTemplateRows: 'auto auto 1fr',
    height: '100vh',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXL,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXL}`,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  headerTitle: { display: 'flex', flexDirection: 'column' },
  headerFacts: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    marginLeft: 'auto',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  headerActions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  body: { display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: 0 },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowY: 'auto',
  },
  navItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: tokens.spacingVerticalXXS,
    padding: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusMedium,
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    width: '100%',
    font: 'inherit',
    color: 'inherit',
  },
  navItemActive: {
    backgroundColor: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke1}`,
  },
  navTop: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, width: '100%' },
  main: { overflowY: 'auto', padding: tokens.spacingVerticalXL, minWidth: 0 },
  editRow: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center' },
});

const ORDER_HELP: Record<string, string> = {
  sources: 'Load the files you migrate from.',
  target: 'Load or describe what you migrate to.',
  map: 'Say where every target field comes from.',
  test: 'Try the mapping on real rows.',
  ready: 'Check everything before you save.',
};

export function Shell() {
  const s = useStyles();
  const {
    state,
    send,
    statuses,
    stage,
    setStage,
    saveStatus,
    startup,
    dismissStartup,
    newProject,
    saveProjectFile,
    openProjectFile,
  } = useStudio();
  const [confirmNew, setConfirmNew] = useState(false);
  const [openError, setOpenError] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [entity, setEntity] = useState('');
  const datasets = state.project.sourceDefinitions.flatMap((d) => d.datasets).length;
  const structures = state.project.targetDefinition?.structures.length ?? 0;
  const hasWork =
    datasets > 0 ||
    structures > 0 ||
    state.snapshots.length > 0 ||
    state.project.mappingDefinition.mappings.length > 0;
  const savedTime = saveStatus.at ? new Date(saveStatus.at).toLocaleTimeString() : undefined;

  return (
    <div className={s.app}>
      <header className={s.header}>
        <div className={s.headerTitle}>
          <Text size={200}>Migration Mapping Studio</Text>
          {editing ? (
            <div className={s.editRow}>
              <Input aria-label="Project name" value={name} onChange={(_, d) => setName(d.value)} />
              <Input
                aria-label="Business entity"
                value={entity}
                onChange={(_, d) => setEntity(d.value)}
              />
              <Button
                appearance="primary"
                onClick={() => {
                  send({
                    type: 'projectRenamed',
                    name: name.trim() || state.project.name,
                    businessEntity: entity.trim() || state.project.businessEntity,
                  });
                  setEditing(false);
                }}
              >
                Save
              </Button>
              <Button onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          ) : (
            <Text as="h1" size={500} weight="semibold" data-testid="project-name">
              {state.project.name}
            </Text>
          )}
        </div>
        {!editing && (
          <Button
            appearance="subtle"
            style={{ color: 'inherit' }}
            onClick={() => {
              setName(state.project.name);
              setEntity(state.project.businessEntity);
              setEditing(true);
            }}
          >
            Rename
          </Button>
        )}
        <div className={s.headerActions} aria-label="Project file actions">
          <Button
            size="small"
            appearance="outline"
            style={{ color: 'inherit', borderColor: 'rgba(255,255,255,0.6)' }}
            onClick={() => (hasWork ? setConfirmNew(true) : newProject())}
          >
            New project
          </Button>
          <Button
            size="small"
            appearance="outline"
            style={{ color: 'inherit', borderColor: 'rgba(255,255,255,0.6)' }}
            onClick={saveProjectFile}
          >
            Save project file
          </Button>
          <FileButton
            label="Open project file"
            accept=".json,.mms.json"
            testId="project-file-input"
            onFiles={(f) => {
              void openProjectFile(f[0]!).then(setOpenError);
            }}
          />
        </div>
        <div className={s.headerFacts} aria-label="Project context">
          <Text size={200} data-testid="autosave-status" style={{ color: 'inherit' }}>
            {saveStatus.state === 'saved'
              ? `Autosaved ${savedTime}`
              : saveStatus.state === 'error'
                ? `Not saved: ${saveStatus.message}`
                : 'Autosave on'}
          </Text>
          <Badge appearance="filled" color="informative" data-testid="project-entity">
            {state.project.businessEntity}
          </Badge>
          <Badge appearance="filled" color="informative">
            {datasets} {datasets === 1 ? 'dataset' : 'datasets'}
          </Badge>
          <Badge appearance="filled" color="informative">
            {structures} {structures === 1 ? 'structure' : 'structures'}
          </Badge>
        </div>
      </header>
      <div>
        {startup.kind === 'ok' && (
          <MessageBar intent="info" data-testid="restored-banner">
            <MessageBarBody>
              Project “{startup.workspace.project.name}” was restored. Source rows are not saved, so
              add the source files again (Sources) before you test or run.
            </MessageBarBody>
            <Button
              size="small"
              onClick={() => {
                setStage('sources');
                dismissStartup();
              }}
            >
              Go to Sources
            </Button>
            <Button size="small" appearance="transparent" onClick={dismissStartup}>
              Dismiss
            </Button>
          </MessageBar>
        )}
        {startup.kind === 'unreadable' && (
          <MessageBar intent="warning" data-testid="unreadable-banner">
            <MessageBarBody>
              The project saved in this browser could not be read and was not loaded:{' '}
              {startup.reason}
            </MessageBarBody>
            <Button size="small" appearance="transparent" onClick={dismissStartup}>
              Dismiss
            </Button>
          </MessageBar>
        )}
        {openError && (
          <MessageBar intent="error" data-testid="open-error">
            <MessageBarBody>The project file was not opened: {openError}</MessageBarBody>
            <Button size="small" appearance="transparent" onClick={() => setOpenError(undefined)}>
              Dismiss
            </Button>
          </MessageBar>
        )}
      </div>
      <div className={s.body}>
        <nav className={s.nav} aria-label="Stages">
          {STAGES.map((id, i) => (
            <button
              key={id}
              type="button"
              className={`${s.navItem} ${stage === id ? s.navItemActive : ''}`}
              aria-current={stage === id ? 'step' : undefined}
              onClick={() => setStage(id)}
              data-testid={`stage-${id}`}
            >
              <span className={s.navTop}>
                <Text weight="semibold">
                  {i + 1}. {STAGE_LABELS[id]}
                </Text>
                <span style={{ marginLeft: 'auto' }}>
                  <StageBadge state={statuses[id].state} />
                </span>
              </span>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
                data-testid={`stage-${id}-summary`}
              >
                {statuses[id].summary}
              </Text>
              {stage === id && (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  {ORDER_HELP[id]}
                </Text>
              )}
            </button>
          ))}
        </nav>
        <main className={s.main}>
          {stage === 'sources' && <SourcesStage />}
          {stage === 'target' && <TargetStage />}
          {stage === 'map' && <MapStage />}
          {stage === 'test' && <TestStage />}
          {stage === 'ready' && <ReadyStage />}
        </main>
      </div>
      <Dialog open={confirmNew} onOpenChange={(_, d) => setConfirmNew(d.open)}>
        <DialogSurface aria-label="Start a new project">
          <DialogBody>
            <DialogTitle>Start a new project?</DialogTitle>
            <DialogContent>
              The current project, including its snapshots, is replaced. Save a project file first
              if you want to keep it.
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={() => {
                  setConfirmNew(false);
                  newProject();
                }}
              >
                Start new project
              </Button>
              <Button onClick={() => setConfirmNew(false)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
