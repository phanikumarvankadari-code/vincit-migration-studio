import type { DataType } from '@mms/mapping-core';

/**
 * How a target definition file is laid out. Column settings name a header of the imported table
 * (case-insensitive). A wizard can fill this in; `detectTargetLayout` proposes one.
 */
export interface TargetLayout {
  /**
   * sectionRows: one table where a row holding only a structure name starts a new structure.
   * column: every field row names its structure in a column.
   * perSheet: each dataset (sheet) is one structure.
   */
  mode: 'sectionRows' | 'column' | 'perSheet';
  /** Dataset name to read for sectionRows and column modes. Default: the first dataset. */
  dataset?: string;
  columns: {
    /** Required for sectionRows and column modes. */
    structure?: string;
    group?: string;
    displayName: string;
    importance?: string;
    type?: string;
    length?: string;
    decimals?: string;
    technicalStructure?: string;
    technicalField?: string;
    key?: string;
  };
  /** Group values that mark key fields. A group applies to the rows below it until the next group. Default: ["Key"]. */
  keyGroups?: string[];
  /** Importance text that makes a field required. Default: starts with "mandatory" or "required". */
  requiredPattern?: RegExp;
  /** Type text (lower case) to datatype. Merged over the defaults. */
  typeMap?: Record<string, DataType>;
}

export const DEFAULT_TYPE_MAP: Record<string, DataType> = {
  text: 'string',
  string: 'string',
  char: 'string',
  character: 'string',
  varchar: 'string',
  date: 'date',
  time: 'time',
  datetime: 'dateTime',
  timestamp: 'dateTime',
  number: 'decimal',
  numeric: 'decimal',
  decimal: 'decimal',
  amount: 'decimal',
  quantity: 'decimal',
  integer: 'integer',
  int: 'integer',
  boolean: 'boolean',
  flag: 'boolean',
  uuid: 'uuid',
};
