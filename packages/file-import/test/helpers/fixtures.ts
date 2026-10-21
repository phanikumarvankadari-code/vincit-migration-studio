import { readFileSync } from 'node:fs';

const root = new URL('../../../../test-data/profit-center/', import.meta.url);
export const readInputText = (name: string): string =>
  readFileSync(new URL(`input/${name}`, root), 'utf8');
export const readTargetBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`target/${name}`, root)));
