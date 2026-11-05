import { Badge, Button, Checkbox, Select, Text } from '@fluentui/react-components';
import { applyPairings } from '@mms/studio-model';
import { Section } from '../components/common';
import { useStudio } from '../context';

/**
 * Which source table feeds which target structure. One main table per structure, and optional extra tables. A pairing
 * that came from the AI is "suggested" until the user accepts it; changing a row by hand confirms it.
 */
export function StructuresOverview() {
  const { state, send } = useStudio();
  const project = state.project;
  const structures = project.targetDefinition?.structures ?? [];
  const datasets = project.sourceDefinitions.flatMap((s) => s.datasets);
  if (structures.length === 0 || datasets.length === 0) return null;
  const suggested = structures.filter((s) => s.generation?.status === 'suggested');
  const name = (id: string): string => datasets.find((d) => d.id === id)?.displayName ?? id;

  const set = (
    structureId: string,
    main: string,
    extras: readonly string[],
    status: 'suggested' | 'confirmed',
  ) =>
    send({
      type: 'projectEdited',
      project: applyPairings(
        project,
        [{ structureId, driverDatasetId: main, helperDatasetIds: extras, status }],
        new Date().toISOString(),
      ),
    });

  const acceptAll = () =>
    send({
      type: 'projectEdited',
      project: applyPairings(
        project,
        suggested.map((s) => ({
          structureId: s.id,
          driverDatasetId: s.generation!.driverDatasetId,
          helperDatasetIds: s.generation!.helperDatasetIds ?? [],
          status: 'confirmed' as const,
        })),
        new Date().toISOString(),
      ),
    });

  return (
    <Section
      title="Structures and their source tables"
      hint="Each target structure takes its rows from one main source table. Extra tables are optional and only help when a join is confirmed."
      actions={
        suggested.length > 0 ? (
          <Button appearance="primary" data-testid="pairing-accept-all" onClick={acceptAll}>
            Accept all suggested ({suggested.length})
          </Button>
        ) : undefined
      }
    >
      <div data-testid="structures-overview" style={{ overflowX: 'auto' }}>
        <table className="data" aria-label="Structures and source tables">
          <thead>
            <tr>
              <th>Structure</th>
              <th>Main source table</th>
              <th>Extra tables</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {structures.map((s) => {
              const g = s.generation;
              const extras = g?.helperDatasetIds ?? [];
              return (
                <tr key={s.id} data-testid={`pairing-row-${s.name}`}>
                  <td>{s.name}</td>
                  <td>
                    <Select
                      aria-label={`Main source table of ${s.name}`}
                      data-testid={`pairing-main-${s.name}`}
                      value={g?.driverDatasetId ?? ''}
                      onChange={(_, d) => {
                        if (d.value === '')
                          send({
                            type: 'structureSettings',
                            structureId: s.id,
                            generation: null,
                            parent: s.parent ?? null,
                          });
                        else
                          set(
                            s.id,
                            d.value,
                            extras.filter((x) => x !== d.value),
                            'confirmed',
                          );
                      }}
                    >
                      <option value="">— not set (automatic) —</option>
                      {datasets.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.displayName}
                          {d.description ? ` — ${d.description}` : ''}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td>
                    {g ? (
                      <details>
                        <summary>
                          {extras.length > 0 ? extras.map(name).join(', ') : 'none'}
                        </summary>
                        {datasets
                          .filter((d) => d.id !== g.driverDatasetId)
                          .map((d) => (
                            <div key={d.id}>
                              <Checkbox
                                label={d.displayName}
                                checked={extras.includes(d.id)}
                                onChange={(_, c) =>
                                  set(
                                    s.id,
                                    g.driverDatasetId,
                                    c.checked
                                      ? [...extras, d.id]
                                      : extras.filter((x) => x !== d.id),
                                    'confirmed',
                                  )
                                }
                              />
                            </div>
                          ))}
                      </details>
                    ) : (
                      <Text>—</Text>
                    )}
                  </td>
                  <td data-testid={`pairing-status-${s.name}`}>
                    {!g ? (
                      <Badge appearance="outline">No table</Badge>
                    ) : g.status === 'suggested' ? (
                      <Badge color="warning">Suggested</Badge>
                    ) : (
                      <Badge color="success">Confirmed</Badge>
                    )}
                  </td>
                  <td>
                    {g?.status === 'suggested' && (
                      <Button
                        size="small"
                        data-testid={`pairing-accept-${s.name}`}
                        onClick={() =>
                          set(s.id, g.driverDatasetId, g.helperDatasetIds ?? [], 'confirmed')
                        }
                      >
                        Accept
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
