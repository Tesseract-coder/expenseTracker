import type { Grid } from '@kharcha/shared';

export const isPdf = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

/**
 * Reads a statement file into a grid, on the device. SheetJS/PapaParse and pdf.js load on demand
 * (separate chunks). A PDF password is used for this call only and never stored or uploaded.
 */
export async function readStatementFile(file: File, password?: string): Promise<Grid> {
  let grid: Grid;
  if (isPdf(file)) {
    const { readPdf } = await import('./readPdf');
    grid = await readPdf(await file.arrayBuffer(), password);
  } else {
    const { readSpreadsheet } = await import('@kharcha/shared/spreadsheet');
    grid = readSpreadsheet(await file.arrayBuffer(), file.name);
  }
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
