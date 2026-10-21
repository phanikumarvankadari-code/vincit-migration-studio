import { Select, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useState } from 'react';
import { JoinsPicture } from './JoinsPicture';
import { MapperPanel } from './MapperPanel';

const useStyles = makeStyles({
  bar: { margin: `${tokens.spacingVerticalM} 0` },
});

/** The Visual Mapper tab: the two-panel mapper, and a picture of the joins between datasets. */
export function VisualMapper({
  onEditField,
}: {
  onEditField: (structureId: string, fieldId: string) => void;
}) {
  const s = useStyles();
  const [mode, setMode] = useState<'mapping' | 'relationships'>('mapping');
  return (
    <div>
      <div className={s.bar}>
        <label>
          <Text block>Picture</Text>
          <Select
            aria-label="Picture"
            value={mode}
            onChange={(_, d) => setMode(d.value as 'mapping' | 'relationships')}
          >
            <option value="mapping">Mapping</option>
            <option value="relationships">Joins between datasets</option>
          </Select>
        </label>
      </div>
      {mode === 'mapping' ? <MapperPanel onEditField={onEditField} /> : <JoinsPicture />}
    </div>
  );
}
