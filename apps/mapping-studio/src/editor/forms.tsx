import {
  Button,
  Checkbox,
  Input,
  Select,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { DataType } from '@mms/mapping-core';
import { builtInRoutines, describeRoutine } from '@mms/routine-library';
import type {
  CompareOperator,
  FieldRef,
  MappingDraft,
  MissingDraft,
  OperandDraft,
  RuleDraft,
  StepDraft,
} from '@mms/studio-model';
import { useMemo, useState } from 'react';
import { useStudio } from '../context';
import { SourceSelect } from './SourceSelect';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalS,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  row: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center', flexWrap: 'wrap' },
  grow: { flexGrow: 1 },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

const DATATYPES: DataType[] = [
  'string',
  'integer',
  'decimal',
  'boolean',
  'date',
  'dateTime',
  'time',
  'uuid',
];

export const MISSING_OPTIONS: { value: MissingDraft['kind']; label: string }[] = [
  { value: 'error', label: 'Report an error' },
  { value: 'warning', label: 'Report a warning (blank value)' },
  { value: 'keepSource', label: 'Keep the source value' },
  { value: 'null', label: 'Leave blank' },
  { value: 'default', label: 'Use a default value' },
];

function MissingSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MissingDraft;
  onChange: (m: MissingDraft) => void;
}) {
  const s = useStyles();
  return (
    <div className={s.row}>
      <label>
        <Text block weight="semibold">
          {label}
        </Text>
        <Select
          aria-label={label}
          value={value.kind}
          onChange={(_, d) =>
            onChange(
              d.value === 'default'
                ? { kind: 'default', value: '' }
                : ({ kind: d.value } as MissingDraft),
            )
          }
        >
          {MISSING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>
      {value.kind === 'default' && (
        <Input
          aria-label="Default value"
          placeholder="Default value"
          value={value.value}
          onChange={(_, d) => onChange({ kind: 'default', value: d.value })}
        />
      )}
    </div>
  );
}

function OperandEditor({
  label,
  value,
  onChange,
  allow,
}: {
  label: string;
  value: OperandDraft | undefined;
  onChange: (o: OperandDraft | undefined) => void;
  allow: ('current' | 'field' | 'text' | 'none')[];
}) {
  const s = useStyles();
  const kind = value?.kind ?? 'none';
  return (
    <div className={s.row}>
      <Select
        aria-label={`${label} kind`}
        value={kind}
        onChange={(_, d) => {
          const k = d.value;
          onChange(
            k === 'none'
              ? undefined
              : k === 'current'
                ? { kind: 'current' }
                : k === 'field'
                  ? { kind: 'field', ref: undefined }
                  : { kind: 'text', value: '' },
          );
        }}
      >
        {allow.includes('current') && <option value="current">This value</option>}
        {allow.includes('field') && <option value="field">A source field</option>}
        {allow.includes('text') && <option value="text">Text</option>}
        {allow.includes('none') && <option value="none">Nothing</option>}
      </Select>
      {value?.kind === 'text' && (
        <Input
          aria-label={`${label} text`}
          value={value.value}
          onChange={(_, d) => onChange({ kind: 'text', value: d.value })}
        />
      )}
      {value?.kind === 'field' && (
        <SourceSelect
          label={`${label} field`}
          value={value.ref}
          onChange={(ref) => onChange({ kind: 'field', ref })}
        />
      )}
    </div>
  );
}

const OPERATORS: { value: CompareOperator; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'does not equal' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'notEmpty', label: 'is not empty' },
];

export function DirectForm({
  draft,
  onChange,
}: {
  draft: Extract<MappingDraft, { type: 'direct' }>;
  onChange: (d: MappingDraft) => void;
}) {
  return (
    <SourceSelect
      label="Source field"
      value={draft.source}
      onChange={(source) => onChange({ ...draft, source })}
    />
  );
}

export function ConstantForm({
  draft,
  onChange,
}: {
  draft: Extract<MappingDraft, { type: 'constant' }>;
  onChange: (d: MappingDraft) => void;
}) {
  const s = useStyles();
  return (
    <div className={s.stack}>
      <label>
        <Text block weight="semibold">
          Value
        </Text>
        <Input
          aria-label="Constant value"
          value={draft.value}
          disabled={draft.blank}
          onChange={(_, d) => onChange({ ...draft, value: d.value })}
        />
      </label>
      <div className={s.row}>
        <label>
          <Text block weight="semibold">
            Datatype
          </Text>
          <Select
            aria-label="Constant datatype"
            value={draft.datatype}
            onChange={(_, d) => onChange({ ...draft, datatype: d.value as DataType })}
          >
            {DATATYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </label>
        <Checkbox
          label="Blank (no value)"
          checked={draft.blank}
          onChange={(_, d) => onChange({ ...draft, blank: d.checked === true })}
        />
      </div>
    </div>
  );
}

export function LookupForm({
  draft,
  onChange,
}: {
  draft: Extract<MappingDraft, { type: 'lookup' }>;
  onChange: (d: MappingDraft) => void;
}) {
  const s = useStyles();
  const { state } = useStudio();
  const set = (entries: { key: string; value: string }[]) =>
    onChange({ ...draft, lookup: { ...draft.lookup, entries } });
  const fillFromSource = () => {
    if (!draft.source) return;
    const data = state.data[draft.source.datasetId];
    const col = data?.fieldIds.indexOf(draft.source.fieldId as never) ?? -1;
    if (!data || col < 0) return;
    const existing = new Set(draft.lookup.entries.map((e) => e.key));
    const keys = [
      ...new Set(
        data.rows
          .map((r) => r[col])
          .filter((v): v is string => v !== null && v !== undefined && v !== ''),
      ),
    ]
      .filter((k) => !existing.has(k))
      .slice(0, 100);
    set([
      ...draft.lookup.entries.filter((e) => e.key !== '' || e.value !== ''),
      ...keys.map((key) => ({ key, value: '' })),
    ]);
  };
  return (
    <div className={s.stack}>
      <SourceSelect
        label="Source field to look up"
        value={draft.source}
        onChange={(source) => onChange({ ...draft, source })}
      />
      <label>
        <Text block weight="semibold">
          Lookup name
        </Text>
        <Input
          aria-label="Lookup name"
          value={draft.lookup.name}
          onChange={(_, d) => onChange({ ...draft, lookup: { ...draft.lookup, name: d.value } })}
        />
      </label>
      <div className={s.card}>
        <div className={s.row}>
          <Text weight="semibold">Entries (source value → target value)</Text>
          <Button size="small" onClick={fillFromSource} disabled={!draft.source}>
            Add values from source
          </Button>
        </div>
        {draft.lookup.entries.map((e, i) => (
          <div key={i} className={s.row}>
            <Input
              aria-label={`Entry ${i + 1} key`}
              placeholder="Source value"
              value={e.key}
              onChange={(_, d) =>
                set(draft.lookup.entries.map((x, j) => (j === i ? { ...x, key: d.value } : x)))
              }
            />
            <Text>→</Text>
            <Input
              aria-label={`Entry ${i + 1} value`}
              placeholder="Target value"
              value={e.value}
              onChange={(_, d) =>
                set(draft.lookup.entries.map((x, j) => (j === i ? { ...x, value: d.value } : x)))
              }
            />
            <Button
              size="small"
              appearance="subtle"
              aria-label={`Remove entry ${i + 1}`}
              onClick={() => set(draft.lookup.entries.filter((_x, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="small"
            onClick={() => set([...draft.lookup.entries, { key: '', value: '' }])}
          >
            Add entry
          </Button>
        </div>
      </div>
      <MissingSelect
        label="When a value is not in the table"
        value={draft.missing}
        onChange={(missing) => onChange({ ...draft, missing })}
      />
    </div>
  );
}

export function ConditionForm({
  draft,
  onChange,
}: {
  draft: Extract<MappingDraft, { type: 'conditional' }>;
  onChange: (d: MappingDraft) => void;
}) {
  const s = useStyles();
  const setRule = (i: number, rule: RuleDraft) =>
    onChange({ ...draft, rules: draft.rules.map((r, j) => (j === i ? rule : r)) });
  return (
    <div className={s.stack}>
      <SourceSelect
        label="Source field (this value)"
        value={draft.source}
        onChange={(source) => onChange({ ...draft, source })}
      />
      {draft.rules.map((r, i) => (
        <div key={i} className={s.card} data-testid={`rule-${i + 1}`}>
          <Text weight="semibold">{i === 0 ? 'If' : 'Else if'}</Text>
          <OperandEditor
            label={`Rule ${i + 1} left`}
            value={r.left}
            onChange={(left) => left && setRule(i, { ...r, left })}
            allow={['current', 'field']}
          />
          <div className={s.row}>
            <Select
              aria-label={`Rule ${i + 1} operator`}
              value={r.operator}
              onChange={(_, d) => setRule(i, { ...r, operator: d.value as CompareOperator })}
            >
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {r.operator !== 'isEmpty' && r.operator !== 'notEmpty' && (
              <Input
                aria-label={`Rule ${i + 1} compared text`}
                placeholder="Text to compare with"
                value={r.right}
                onChange={(_, d) => setRule(i, { ...r, right: d.value })}
              />
            )}
          </div>
          <Text weight="semibold">then use</Text>
          <OperandEditor
            label={`Rule ${i + 1} result`}
            value={r.then}
            onChange={(then) => then && setRule(i, { ...r, then })}
            allow={['text', 'field', 'current']}
          />
          <div>
            <Button
              size="small"
              appearance="subtle"
              aria-label={`Remove rule ${i + 1}`}
              onClick={() => onChange({ ...draft, rules: draft.rules.filter((_x, j) => j !== i) })}
            >
              Remove rule
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button
          size="small"
          onClick={() =>
            onChange({
              ...draft,
              rules: [
                ...draft.rules,
                {
                  left: { kind: 'current' },
                  operator: 'eq',
                  right: '',
                  then: { kind: 'text', value: '' },
                },
              ],
            })
          }
        >
          Add rule
        </Button>
      </div>
      <div className={s.card}>
        <Text weight="semibold">Otherwise use</Text>
        <OperandEditor
          label="Otherwise"
          value={draft.otherwise}
          onChange={(otherwise) => onChange({ ...draft, otherwise })}
          allow={['text', 'field', 'current', 'none']}
        />
      </div>
    </div>
  );
}

const DATE_FORMAT_DEFAULT = {
  inputFormat: 'yyyyMMdd',
  outputFormat: 'yyyy-MM-dd',
  invalidValueBehavior: 'blank',
  specialValues: { '00000000': '' },
};

function readJson(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Date Format settings as form fields. The settings stay JSON text in the draft, so nothing else changes. */
function DateFormatFields({
  step,
  index,
  onChange,
}: {
  step: Extract<StepDraft, { kind: 'routine' }>;
  index: number;
  onChange: (configuration: string) => void;
}) {
  const s = useStyles();
  const { registry } = useStudio();
  const [sample, setSample] = useState('20261105');
  const cfg = readJson(step.configuration);
  const special = (cfg['specialValues'] ?? {}) as Record<string, string>;
  const specialText = Object.entries(special)
    .map(([k, v]) => `${k} -> ${v}`)
    .join('\n');
  const [specialDraft, setSpecialDraft] = useState(specialText);
  const set = (key: string, value: unknown) =>
    onChange(JSON.stringify({ ...cfg, [key]: value }, null, 2));
  const setSpecial = (text: string) => {
    setSpecialDraft(text);
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const at = line.indexOf('->');
      if (at < 0) continue;
      const key = line.slice(0, at).trim();
      if (key) out[key] = line.slice(at + 2).trim();
    }
    set('specialValues', out);
  };
  const impl = registry['date.convert'];
  const result = impl?.({
    value: sample === '' ? null : sample,
    inputs: [sample],
    configuration: cfg as never,
  });
  return (
    <div className={s.stack} data-testid={`date-format-${index + 1}`}>
      <label>
        <Text block>Input format</Text>
        <Input
          aria-label={`Step ${index + 1} input format`}
          value={String(cfg['inputFormat'] ?? '')}
          onChange={(_, d) => set('inputFormat', d.value)}
        />
      </label>
      <label>
        <Text block>Output format</Text>
        <Input
          aria-label={`Step ${index + 1} output format`}
          value={String(cfg['outputFormat'] ?? '')}
          onChange={(_, d) => set('outputFormat', d.value)}
        />
      </label>
      <label>
        <Text block>Special values (one per line: input -&gt; result, empty result = blank)</Text>
        <Textarea
          aria-label={`Step ${index + 1} special values`}
          rows={2}
          style={{ fontFamily: 'monospace' }}
          value={specialDraft}
          onChange={(_, d) => setSpecial(d.value)}
        />
      </label>
      <label>
        <Text block>Invalid value behavior</Text>
        <Select
          aria-label={`Step ${index + 1} invalid value behavior`}
          value={String(cfg['invalidValueBehavior'] ?? 'error')}
          onChange={(_, d) => set('invalidValueBehavior', d.value)}
        >
          <option value="blank">Blank</option>
          <option value="keep">Keep original</option>
          <option value="error">Error</option>
        </Select>
      </label>
      <div className={s.card} data-testid={`date-format-preview-${index + 1}`}>
        <label>
          <Text block>Source value</Text>
          <Input
            aria-label={`Step ${index + 1} sample value`}
            value={sample}
            onChange={(_, d) => setSample(d.value)}
          />
        </label>
        <Text weight="semibold">
          Result:{' '}
          <span data-testid={`date-format-result-${index + 1}`}>
            {!result ? '' : result.ok ? (result.value ?? '(blank)') : `Error: ${result.message}`}
          </span>
        </Text>
      </div>
    </div>
  );
}

/** A starting point for a routine's settings: every required setting with an empty value of the right type. */
export function settingsTemplate(routineId: string): string {
  if (routineId === 'date.convert') return JSON.stringify(DATE_FORMAT_DEFAULT, null, 2);
  const d = describeRoutine(routineId);
  const schema = d?.configuration as
    { properties?: Record<string, { type?: string }>; required?: string[] } | undefined;
  const out: Record<string, unknown> = {};
  for (const key of schema?.required ?? []) {
    const t = schema?.properties?.[key]?.type;
    out[key] = t === 'number' || t === 'integer' ? 0 : t === 'boolean' ? false : '';
  }
  return JSON.stringify(out, null, 2);
}

function settingNames(routineId: string): string {
  const d = describeRoutine(routineId);
  const schema = d?.configuration as
    { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const names = Object.keys(schema?.properties ?? {});
  return names.length === 0
    ? 'No settings.'
    : `Settings: ${names.map((n) => (schema?.required?.includes(n) ? `${n} (required)` : n)).join(', ')}.`;
}

export function RoutineForm({
  draft,
  onChange,
}: {
  draft: Extract<MappingDraft, { type: 'routine' }>;
  onChange: (d: MappingDraft) => void;
}) {
  const s = useStyles();
  const { state } = useStudio();
  const families = useMemo(() => {
    const out = new Map<string, { id: string; name: string }[]>();
    for (const r of builtInRoutines())
      out.set(r.family, [...(out.get(r.family) ?? []), { id: r.id, name: r.name }]);
    return [...out.entries()];
  }, []);
  const setStep = (i: number, step: StepDraft) =>
    onChange({ ...draft, steps: draft.steps.map((x, j) => (j === i ? step : x)) });
  const move = (i: number, by: number) => {
    const steps = [...draft.steps];
    const [item] = steps.splice(i, 1);
    steps.splice(i + by, 0, item!);
    onChange({ ...draft, steps });
  };
  return (
    <div className={s.stack}>
      <SourceSelect
        label="Source field"
        value={draft.source}
        onChange={(source) => onChange({ ...draft, source })}
      />
      <Text weight="semibold">Steps (run from top to bottom)</Text>
      {draft.steps.map((step, i) => (
        <div key={i} className={s.card} data-testid={`step-${i + 1}`}>
          <div className={s.row}>
            <Text weight="semibold">{i + 1}.</Text>
            {step.kind === 'routine' ? (
              <Select
                aria-label={`Step ${i + 1} routine`}
                value={step.routineId}
                onChange={(_, d) =>
                  setStep(i, {
                    ...step,
                    routineId: d.value,
                    configuration: settingsTemplate(d.value),
                  })
                }
              >
                {families.map(([family, list]) => (
                  <optgroup key={family} label={family[0]!.toUpperCase() + family.slice(1)}>
                    {list.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            ) : (
              <Select
                aria-label={`Step ${i + 1} lookup`}
                value={step.lookupId}
                onChange={(_, d) => setStep(i, { ...step, lookupId: d.value })}
              >
                {state.project.lookups.map((l) => (
                  <option key={l.id} value={l.id}>
                    Lookup: {l.name}
                  </option>
                ))}
              </Select>
            )}
            <div className={s.grow} />
            <Button
              size="small"
              appearance="subtle"
              aria-label={`Move step ${i + 1} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              Up
            </Button>
            <Button
              size="small"
              appearance="subtle"
              aria-label={`Move step ${i + 1} down`}
              disabled={i === draft.steps.length - 1}
              onClick={() => move(i, 1)}
            >
              Down
            </Button>
            <Button
              size="small"
              appearance="subtle"
              aria-label={`Remove step ${i + 1}`}
              onClick={() => onChange({ ...draft, steps: draft.steps.filter((_x, j) => j !== i) })}
            >
              Remove
            </Button>
          </div>
          {step.kind === 'routine' ? (
            <>
              <Text className={s.muted}>{describeRoutine(step.routineId)?.description}</Text>
              {step.routineId === 'date.convert' ? (
                <DateFormatFields
                  step={step}
                  index={i}
                  onChange={(configuration) => setStep(i, { ...step, configuration })}
                />
              ) : (
                <>
                  <Text className={s.muted}>{settingNames(step.routineId)}</Text>
                  <Textarea
                    aria-label={`Step ${i + 1} settings`}
                    rows={4}
                    style={{ fontFamily: 'monospace' }}
                    value={step.configuration}
                    onChange={(_, d) => setStep(i, { ...step, configuration: d.value })}
                  />
                </>
              )}
              <label>
                <Text block>If this step fails</Text>
                <Select
                  aria-label={`Step ${i + 1} on error`}
                  value={step.onError}
                  onChange={(_, d) =>
                    setStep(i, { ...step, onError: d.value as 'stop' | 'continue' })
                  }
                >
                  <option value="stop">Stop and report an error</option>
                  <option value="continue">Skip the step and report a warning</option>
                </Select>
              </label>
            </>
          ) : (
            <MissingSelect
              label={`Step ${i + 1} when not found`}
              value={step.missing}
              onChange={(missing) => setStep(i, { ...step, missing })}
            />
          )}
        </div>
      ))}
      <div className={s.row}>
        <Button
          onClick={() =>
            onChange({
              ...draft,
              steps: [
                ...draft.steps,
                { kind: 'routine', routineId: 'text.trim', configuration: '{}', onError: 'stop' },
              ],
            })
          }
        >
          Add routine step
        </Button>
        <Button
          data-testid="add-date-format-step"
          onClick={() =>
            onChange({
              ...draft,
              steps: [
                ...draft.steps,
                {
                  kind: 'routine',
                  routineId: 'date.convert',
                  configuration: settingsTemplate('date.convert'),
                  onError: 'stop',
                },
              ],
            })
          }
        >
          Add Date Format
        </Button>
        <Button
          disabled={state.project.lookups.length === 0}
          onClick={() =>
            onChange({
              ...draft,
              steps: [
                ...draft.steps,
                {
                  kind: 'lookup',
                  lookupId: state.project.lookups[0]!.id,
                  missing: { kind: 'error' },
                },
              ],
            })
          }
        >
          Add lookup step
        </Button>
      </div>
    </div>
  );
}

export type { FieldRef };
