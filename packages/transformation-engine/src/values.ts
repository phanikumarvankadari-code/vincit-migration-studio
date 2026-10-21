import type { ConstantValue, SourceValue } from '@mms/mapping-core';

/** Target cells are text. Constants keep their configured value: numbers and booleans become plain text. */
export function constantText(c: ConstantValue): SourceValue {
  return c.value === null ? null : typeof c.value === 'string' ? c.value : String(c.value);
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Comparison used by conditions. eq/ne compare exact text (a blank equals a blank). Ordering compares as numbers
 * when both sides are plain numbers, otherwise as text. An empty value (null or empty string) is never greater
 * or smaller than anything.
 */
export function compareValues(
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte',
  left: SourceValue,
  right: SourceValue,
): boolean {
  if (operator === 'eq') return left === right;
  if (operator === 'ne') return left !== right;
  if (isEmptyValue(left) || isEmptyValue(right)) return false;
  const l = left as string;
  const r = right as string;
  const order =
    NUMBER.test(l) && NUMBER.test(r) ? Number(l) - Number(r) : l < r ? -1 : l > r ? 1 : 0;
  switch (operator) {
    case 'gt':
      return order > 0;
    case 'gte':
      return order >= 0;
    case 'lt':
      return order < 0;
    default:
      return order <= 0;
  }
}

/** A value is empty when it is blank (null) or an empty string. Spaces are a value. */
export const isEmptyValue = (v: SourceValue): boolean => v === null || v === '';
