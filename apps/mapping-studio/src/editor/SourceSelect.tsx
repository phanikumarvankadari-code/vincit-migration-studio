import { Select, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { FieldRef } from '@mms/studio-model';
import { useStudio } from '../context';

const useStyles = makeStyles({
  samples: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

const encode = (r: FieldRef | undefined): string => (r ? `${r.datasetId}|${r.fieldId}` : '');
const decode = (v: string): FieldRef | undefined => {
  const [datasetId, fieldId] = v.split('|');
  return datasetId && fieldId ? { datasetId, fieldId } : undefined;
};

/** The first few distinct values of a source field, to help choose the right one. */
export function useSampleValues(ref: FieldRef | undefined, limit = 5): string[] {
  const { state } = useStudio();
  if (!ref) return [];
  const data = state.data[ref.datasetId];
  const col = data?.fieldIds.indexOf(ref.fieldId as never) ?? -1;
  if (!data || col < 0) return [];
  const seen = new Set<string>();
  for (const row of data.rows) {
    const v = row[col];
    if (v !== null && v !== undefined && v !== '') seen.add(v);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

export function SourceSelect({
  label,
  value,
  onChange,
  allowNone,
}: {
  label: string;
  value: FieldRef | undefined;
  onChange: (r: FieldRef | undefined) => void;
  allowNone?: boolean;
}) {
  const s = useStyles();
  const { state } = useStudio();
  const samples = useSampleValues(value);
  return (
    <div>
      <label>
        <Text block weight="semibold">
          {label}
        </Text>
        <Select
          aria-label={label}
          value={encode(value)}
          onChange={(_, d) => onChange(decode(d.value))}
        >
          <option value="">{allowNone ? '— none —' : '— choose a source field —'}</option>
          {state.project.sourceDefinitions.flatMap((src) =>
            src.datasets.map((ds) => (
              <optgroup key={ds.id} label={ds.name}>
                {ds.fields.map((f) => (
                  <option key={f.id} value={`${ds.id}|${f.id}`}>
                    {ds.name}.{f.displayName}
                  </option>
                ))}
              </optgroup>
            )),
          )}
        </Select>
      </label>
      {value && (
        <Text className={s.samples} block data-testid="source-samples">
          Sample values: {samples.length > 0 ? samples.join(', ') : '(all blank)'}
        </Text>
      )}
    </div>
  );
}
