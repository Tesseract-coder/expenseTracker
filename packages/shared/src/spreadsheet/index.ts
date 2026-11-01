/**
 * Spreadsheet reading (browser + Node tests). Exposed as a separate entry point
 * (`@kharcha/shared/spreadsheet`) so the Worker and the main web bundle never pull in SheetJS.
 *
 * CSV/TXT go through PapaParse so every cell stays a raw string (no number/date coercion that
 * would drop leading zeros from reference numbers or flip day/month). XLS/XLSX go through SheetJS
 * with real date cells converted to ISO dates and numbers to plain decimal strings.
 */
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { Grid } from '../import/mapping';

export type SpreadsheetKind = 'csv' | 'xlsx';

export function kindFromFileName(name: string): SpreadsheetKind | null {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'xls' || ext === 'xlsx') return 'xlsx';
  return null;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // SheetJS builds Dates in local time; read them back with local getters.
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'number')
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v).trim();
}

function decodeText(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  // UTF-16LE BOM (some bank "xls" exports are actually UTF-16 text)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

function parseDelimited(text: string): Grid {
  const result = Papa.parse<string[]>(text, { delimiter: '', skipEmptyLines: false });
  return result.data.map((r) => r.map((c) => (c ?? '').trim()));
}

/** Read the first sheet (or the CSV) into a grid of trimmed strings. */
export function readSpreadsheet(data: ArrayBuffer, fileName: string): Grid {
  const kind = kindFromFileName(fileName);
  if (kind === 'csv') return parseDelimited(decodeText(data));
  if (kind !== 'xlsx') throw new Error('Unsupported file type. Use CSV, TXT, XLS or XLSX.');

  const head = new Uint8Array(data.slice(0, 8));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf;
  if (!isZip && !isOle) {
    // Many banks serve tab-separated text or HTML with an .xls extension.
    const text = decodeText(data);
    if (!/<table/i.test(text)) return parseDelimited(text);
  }
  const wb = XLSX.read(data, { type: 'array', cellDates: true, dense: true });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: true,
  });
  return rows.map((r) => r.map(cellToString));
}
