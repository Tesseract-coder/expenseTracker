import type { Grid } from '@kharcha/shared';

/** Reads a statement file into a grid. SheetJS/PapaParse load on demand (separate chunk). */
export async function readStatementFile(file: File): Promise<Grid> {
  const { readSpreadsheet } = await import('@kharcha/shared/spreadsheet');
  const grid = readSpreadsheet(await file.arrayBuffer(), file.name);
  // Normalise ragged rows so column pickers can index safely.
  const width = Math.max(0, ...grid.slice(0, 200).map((r) => r.length));
  return grid.map((r) =>
    r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r,
  );
}

export const columnLetter = (i: number) => {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
