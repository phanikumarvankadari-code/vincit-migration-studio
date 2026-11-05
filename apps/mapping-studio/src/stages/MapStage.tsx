import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { computeCompleteness, type TargetStructure } from '@mms/mapping-core';
import type { RowFilter } from '@mms/studio-model';
import { useMemo, useRef, useState } from 'react';
import { stamp } from '@mms/workspace-files';
import { Section } from '../components/common';
import { useStudio } from '../context';
import { useOptionalWorkspace } from '../workspace';
import { MappingEditor } from '../editor/MappingEditor';
import { MappingTable } from './MappingTable';
import { AiMappingPanel } from './AiMappingPanel';
import { StructuresOverview } from './StructuresOverview';
import { UndoBar } from './UndoBar';
import { StructureSettings } from './StructureSettings';
import { VisualMapper } from './VisualMapper';

const useStyles = makeStyles({
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function MapStage() {
  const s = useStyles();
  const { state, rows, setStage } = useStudio();
  const [view, setView] = useState<'table' | 'visual'>('table');
  const [filter, setFilter] = useState<RowFilter>({});
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  // "Hard-code a value" opens the editor on the Constant type.
  const [preset, setPreset] = useState<'constant' | undefined>();
  const [settings, setSettings] = useState<TargetStructure | undefined>();
  const ws = useOptionalWorkspace();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingUpload, setPendingUpload] = useState<File | undefined>();
  const [fileMessage, setFileMessage] = useState<{ ok: boolean; text: string } | undefined>();
  const openObject = ws?.open;

  const downloadMapping = async () => {
    if (!ws || !openObject) return;
    const base = [openObject.customerName, openObject.object.name, stamp(new Date().toISOString())]
      .map((p) => p.replace(/[\\/:*?"<>|]+/g, '_'))
      .join('_');
    const r = await ws.downloadMapping(openObject.customerFolder, openObject.objectFolder, base);
    setFileMessage(r.ok ? undefined : { ok: false, text: r.message });
  };

  const uploadMapping = async () => {
    const file = pendingUpload;
    setPendingUpload(undefined);
    if (!ws || !openObject || !file) return;
    const r = await ws.uploadMapping(openObject.customerFolder, openObject.objectFolder, file);
    setFileMessage(
      r.ok
        ? { ok: true, text: `The mapping was replaced with "${file.name}".` }
        : { ok: false, text: r.message },
    );
  };
  const target = state.project.targetDefinition;
  const completeness = useMemo(
    () => (target ? computeCompleteness(target, state.project.mappingDefinition) : []),
    [target, state.project.mappingDefinition],
  );
  const selected = rows.find((r) => r.key === selectedKey);

  if (!target) {
    return (
      <Section title="Map" hint="Say where every target field comes from.">
        <MessageBar intent="info">
          <MessageBarBody>
            Load a target structure first, so there are fields to map.
          </MessageBarBody>
        </MessageBar>
        <div>
          <Button appearance="primary" onClick={() => setStage('target')}>
            Go to Target
          </Button>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Map"
      hint="Table and Visual Mapper are two views of the same mapping. Click a field to edit it."
    >
      <div className={s.cards} aria-label="Mapping completeness">
        {completeness.map((c) => {
          const st = target.structures.find((x) => x.id === c.targetStructureId)!;
          const open =
            c.unmappedRequired.length +
            c.unmappedKeys.filter((k) => !c.unmappedRequired.includes(k)).length;
          return (
            <div key={st.id} className={s.card} data-testid={`completeness-${st.name}`}>
              <div className={s.row}>
                <Text weight="semibold" size={400}>
                  {st.name}
                </Text>
                {c.ready ? (
                  <Badge color="success">Required fields mapped</Badge>
                ) : (
                  <Badge color="danger">{open} required open</Badge>
                )}
              </div>
              <ProgressBar
                value={c.totalFields === 0 ? 0 : c.mappedFields / c.totalFields}
                aria-label={`${st.name} mapped`}
              />
              <Text data-testid={`completeness-text-${st.name}`}>
                {c.mappedFields} of {c.totalFields} fields mapped ({c.percentMapped}%)
              </Text>
              <Text className={s.muted}>
                {st.generation
                  ? `Rows come from ${state.project.sourceDefinitions.flatMap((x) => x.datasets).find((d) => d.id === st.generation!.driverDatasetId)?.name ?? st.generation.driverDatasetId}`
                  : 'Rows: automatic'}
              </Text>
              <div className={s.row}>
                <Button
                  size="small"
                  onClick={() => setFilter({ structureId: st.id, status: 'requiredUnmapped' })}
                  disabled={c.unmappedRequired.length === 0}
                >
                  Show required open
                </Button>
                <Button size="small" onClick={() => setSettings(st)}>
                  Settings
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <UndoBar />
      <AiMappingPanel />
      <StructuresOverview />
      {openObject && (
        <div className={s.row}>
          <Button data-testid="download-mapping" onClick={() => void downloadMapping()}>
            Download mapping
          </Button>
          <Button data-testid="upload-mapping" onClick={() => fileInput.current?.click()}>
            Upload mapping
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            data-testid="upload-mapping-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) {
                setFileMessage(undefined);
                setPendingUpload(f);
              }
            }}
          />
        </div>
      )}
      {fileMessage && (
        <MessageBar intent={fileMessage.ok ? 'success' : 'error'}>
          <MessageBarBody>{fileMessage.text}</MessageBarBody>
        </MessageBar>
      )}
      <Dialog
        open={pendingUpload !== undefined}
        onOpenChange={(_, d) => !d.open && setPendingUpload(undefined)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Replace the mapping?</DialogTitle>
            <DialogContent>
              The whole mapping of this business object is replaced with the contents of "
              {pendingUpload?.name}".
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                data-testid="confirm-upload-mapping"
                onClick={() => void uploadMapping()}
              >
                Replace mapping
              </Button>
              <Button onClick={() => setPendingUpload(undefined)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <TabList
        selectedValue={view}
        onTabSelect={(_, d) => setView(d.value as 'table' | 'visual')}
        aria-label="Mapping view"
      >
        <Tab value="table">Mapping Table</Tab>
        <Tab value="visual">Visual Mapper</Tab>
      </TabList>

      {view === 'table' ? (
        <MappingTable
          rows={rows}
          structures={target.structures.map((x) => ({ id: x.id, name: x.name }))}
          filter={filter}
          onFilter={setFilter}
          selectedKey={selectedKey}
          onSelect={(r) => {
            setPreset(undefined);
            setSelectedKey(r.key);
          }}
          onHardCode={(r) => {
            setPreset('constant');
            setSelectedKey(r.key);
          }}
        />
      ) : (
        <VisualMapper
          onEditField={(structureId, fieldId, p) => {
            setPreset(p);
            setSelectedKey(`${structureId}/${fieldId}`);
          }}
        />
      )}

      {selected && (
        <MappingEditor
          row={selected}
          {...(preset ? { preset } : {})}
          onClose={() => {
            setSelectedKey(undefined);
            setPreset(undefined);
          }}
        />
      )}
      {settings && (
        <StructureSettings structure={settings} onClose={() => setSettings(undefined)} />
      )}
    </Section>
  );
}
