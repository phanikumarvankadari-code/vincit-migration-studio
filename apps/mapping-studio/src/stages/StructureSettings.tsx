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
  Select,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { ParentLink, RowGeneration, TargetStructure } from '@mms/mapping-core';
import { suggestDrivers } from '@mms/test-engine';
import { useMemo, useState } from 'react';
import { useStudio } from '../context';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  row: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center', flexWrap: 'wrap' },
  muted: { color: tokens.colorNeutralForeground3 },
});

interface Pair {
  child: string;
  parent: string;
}

/** Where the rows of a structure come from, and how it links to a parent structure. */
export function StructureSettings({
  structure,
  onClose,
}: {
  structure: TargetStructure;
  onClose: () => void;
}) {
  const s = useStyles();
  const { state, send } = useStudio();
  const target = state.project.targetDefinition!;
  const datasets = state.project.sourceDefinitions.flatMap((x) => x.datasets);
  const [driver, setDriver] = useState<string>(structure.generation?.driverDatasetId ?? '');
  const [parentId, setParentId] = useState<string>(structure.parent?.parentStructureId ?? '');
  const [pairs, setPairs] = useState<Pair[]>(
    structure.parent?.keys.map((k) => ({ child: k.childFieldId, parent: k.parentFieldId })) ?? [],
  );
  const suggestions = useMemo(
    () => suggestDrivers(state.project, structure.id),
    [state.project, structure.id],
  );
  const parent = target.structures.find((x) => x.id === parentId);
  const complete = !parentId || (pairs.length > 0 && pairs.every((p) => p.child && p.parent));

  const save = () => {
    const generation: RowGeneration | null = driver
      ? { driverDatasetId: driver as RowGeneration['driverDatasetId'] }
      : null;
    const link: ParentLink | null = parentId
      ? {
          parentStructureId: parentId as ParentLink['parentStructureId'],
          keys: pairs.map((p) => ({
            childFieldId: p.child as never,
            parentFieldId: p.parent as never,
          })),
        }
      : null;
    send({ type: 'structureSettings', structureId: structure.id, generation, parent: link });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface aria-label={`Settings for ${structure.name}`}>
        <DialogBody>
          <DialogTitle>Settings for {structure.name}</DialogTitle>
          <DialogContent>
            <div className={s.stack}>
              <div>
                <label>
                  <Text block weight="semibold">
                    Rows come from
                  </Text>
                  <Select
                    aria-label="Driver dataset"
                    value={driver}
                    onChange={(_, d) => setDriver(d.value)}
                  >
                    <option value="">Automatic (the one dataset the mappings read)</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <Text className={s.muted} block>
                  One row is made for each row of this dataset. For example, choose the company-code
                  dataset to get one Company Codes row per assignment.
                </Text>
                {suggestions[0] && (
                  <div className={s.row}>
                    <Badge appearance="tint" color="brand">
                      Suggested
                    </Badge>
                    <Text data-testid="driver-suggestion">
                      {datasets.find((d) => d.id === suggestions[0]!.datasetId)?.name ??
                        suggestions[0].datasetId}
                      : {suggestions[0].reason}
                    </Text>
                    <Button size="small" onClick={() => setDriver(suggestions[0]!.datasetId)}>
                      Use suggestion
                    </Button>
                  </div>
                )}
              </div>

              <div>
                <label>
                  <Text block weight="semibold">
                    Parent structure
                  </Text>
                  <Select
                    aria-label="Parent structure"
                    value={parentId}
                    onChange={(_, d) => {
                      setParentId(d.value);
                      setPairs(d.value ? [{ child: '', parent: '' }] : []);
                    }}
                  >
                    <option value="">None</option>
                    {target.structures
                      .filter((x) => x.id !== structure.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </Select>
                </label>
                <Text className={s.muted} block>
                  Every row of this structure must have a matching row in the parent. The test run
                  checks this.
                </Text>
              </div>
              {parent &&
                pairs.map((p, i) => (
                  <div key={i} className={s.row}>
                    <Select
                      aria-label={`Link ${i + 1} field in ${structure.name}`}
                      value={p.child}
                      onChange={(_, d) =>
                        setPairs(pairs.map((x, j) => (j === i ? { ...x, child: d.value } : x)))
                      }
                    >
                      <option value="">— field in {structure.name} —</option>
                      {structure.fields.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.displayName}
                        </option>
                      ))}
                    </Select>
                    <Text>=</Text>
                    <Select
                      aria-label={`Link ${i + 1} field in ${parent.name}`}
                      value={p.parent}
                      onChange={(_, d) =>
                        setPairs(pairs.map((x, j) => (j === i ? { ...x, parent: d.value } : x)))
                      }
                    >
                      <option value="">— field in {parent.name} —</option>
                      {parent.fields.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.displayName}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="small"
                      appearance="subtle"
                      aria-label={`Remove link ${i + 1}`}
                      onClick={() => setPairs(pairs.filter((_x, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              {parent && (
                <div>
                  <Button
                    size="small"
                    onClick={() => setPairs([...pairs, { child: '', parent: '' }])}
                  >
                    Add key pair
                  </Button>
                </div>
              )}
              {parentId && !complete && (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    Choose both fields for every key pair, or remove the parent.
                  </MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!complete} onClick={save}>
              Save settings
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
