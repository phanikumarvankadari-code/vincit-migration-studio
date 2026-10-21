import type { SourceValue } from '@mms/mapping-core';

export interface CsvTable {
  header: readonly string[];
  rows: readonly (readonly SourceValue[])[];
}

export interface CsvOptions {
  delimiter?: string;
  /** Default CRLF (RFC 4180). */
  lineEnding?: '\r\n' | '\n';
  /** Add a UTF-8 byte order mark, which helps Excel recognise the encoding. Default false. */
  bom?: boolean;
}

function field(value: SourceValue, delimiter: string): string {
  if (value === null) return '';
  // An empty string is written as "" so it stays different from a blank cell when the file is read back.
  if (value === '') return '""';
  return value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/**
 * Writes RFC 4180 CSV as text (the caller encodes it as UTF-8). Values are written exactly as they are: no trimming,
 * no number or date formatting. A blank (null) is an empty field; an empty string is `""`.
 */
export function toCsv(table: CsvTable, options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ',';
  const eol = options.lineEnding ?? '\r\n';
  const lines = [
    table.header.map((h) => (h === '' ? '""' : field(h, delimiter))).join(delimiter),
    ...table.rows.map((r) => r.map((v) => field(v, delimiter)).join(delimiter)),
  ];
  return (options.bom ? '﻿' : '') + lines.join(eol) + eol;
}
