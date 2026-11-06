/**
 * PDF statement layout (pure): positioned text items → the same `Grid` a spreadsheet produces,
 * so PDF imports go through the normal profile detection, mapping wizard and `parseGrid`.
 *
 * Steps per page: items → lines (by baseline) → find the table header (keyword line, plus a
 * second header line directly below it) → column boundaries halfway between header cells →
 * every item goes to the column holding its centre. Pages without a header reuse the last one's
 * columns. Wrapped cells (a line with only text, right under a transaction row) are joined onto
 * that row here, because some banks wrap mid-word at a fixed character count and joining those
 * with a space would break VPAs and refs. Without any header, columns come from vertical gaps
 * shared by the amount-bearing lines.
 */
import type { Grid } from './mapping';
import { BANK_PROFILES, GENERIC_PROFILE } from './profiles';

export interface PdfTextItem {
  str: string;
  /** Left edge, in PDF points from the page's left. */
  x: number;
  /** Baseline, in points from the page's top (grows downwards). */
  y: number;
  width: number;
  /** Font height in points. */
  height: number;
}
export interface PdfPage {
  items: PdfTextItem[];
}

interface Line {
  y: number;
  h: number;
  items: PdfTextItem[];
}
interface Column {
  x0: number;
  x1: number;
  text: string;
}

const AMOUNT = /\d[\d,]*\.\d{2}\b/;
const DATE = /\b\d{1,2}[/\-. ](\d{1,2}|[A-Za-z]{3,9})[/\-. ,]{1,2}\d{2,4}\b/;
const HEADER_WORD =
  /date|^dt$|valuedt|narration|description|particulars|remarks|details|withdrawal|deposit|debit|credit|^dr$|^cr$|balance|^bal$|amount|^amt|chq|cheque|ref/;
const PAGE_FURNITURE = /^(page\s*(no\.?)?\s*[.:]*\s*\d+(\s*(of|\/)\s*\d+)?|\d+\s*(of|\/)\s*\d+)$/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function toLines(items: PdfTextItem[]): Line[] {
  const sorted = items.filter((i) => i.str.trim() !== '').sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines.at(-1);
    const tol = Math.max(1.5, 0.45 * Math.max(it.height, last?.h ?? 0));
    if (last && Math.abs(it.y - last.y) <= tol) {
      last.items.push(it);
      last.h = Math.max(last.h, it.height);
    } else {
      lines.push({ y: it.y, h: it.height || 8, items: [it] });
    }
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** Join items left to right; items touching each other are one word. */
function joinItems(items: PdfTextItem[]): string {
  let out = '';
  let prevEnd: number | null = null;
  for (const it of items) {
    const gap = prevEnd === null ? 0 : it.x - prevEnd;
    const str = it.str.trim();
    out += prevEnd === null || gap < 0.15 * (it.height || 8) ? str : ` ${str}`;
    prevEnd = it.x + it.width;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const lineText = (l: Line) => joinItems(l.items);

/** Header cells: label words grouped by small horizontal gaps. */
function headerCells(line: Line): Column[] {
  const cells: { items: PdfTextItem[]; x0: number; x1: number }[] = [];
  for (const it of line.items) {
    const last = cells.at(-1);
    if (last && it.x - last.x1 < 0.3 * (it.height || line.h)) {
      last.items.push(it);
      last.x1 = Math.max(last.x1, it.x + it.width);
    } else cells.push({ items: [it], x0: it.x, x1: it.x + it.width });
  }
  return cells.flatMap((c) =>
    splitHeaderCell({ x0: c.x0, x1: c.x1, text: joinItems(c.items) }, line.h),
  );
}

const hasDateOrAmount = (l: Line) => {
  const t = lineText(l);
  return AMOUNT.test(t) || DATE.test(t);
};

/**
 * The table header at `lines[i]`, merged with a second header line right below it when there
 * is one ("Withdrawal Amount" / "(INR)"). Null when this isn't a header line.
 */
function headerAt(lines: Line[], i: number): { cols: Column[]; consumed: number } | null {
  const line = lines[i] as Line;
  if (hasDateOrAmount(line)) return null;
  let cols = headerCells(line);
  let consumed = 1;
  const below = lines[i + 1];
  if (below && below.y - line.y <= 1.8 * line.h && !hasDateOrAmount(below)) {
    cols = mergeHeaderLine(cols, below);
    consumed = 2;
  }
  const hits = cols.filter((c) => HEADER_WORD.test(norm(c.text))).length;
  return hits >= 3 && cols.some((c) => /date|^dt$/.test(norm(c.text))) ? { cols, consumed } : null;
}

/** Merge a second header line ("(INR)", "Date") into the cells above it. */
function mergeHeaderLine(cols: Column[], line: Line): Column[] {
  const next = cols.map((c) => ({ ...c }));
  for (const it of line.items) {
    const x0 = it.x;
    const x1 = it.x + it.width;
    let best = -1;
    let bestScore = -Infinity;
    next.forEach((c, i) => {
      const overlap = Math.min(x1, c.x1) - Math.max(x0, c.x0);
      const score = overlap > 0 ? overlap : -Math.abs((x0 + x1) / 2 - (c.x0 + c.x1) / 2);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    const c = next[best];
    if (!c) continue;
    c.text = `${c.text} ${it.str.trim()}`.trim();
    c.x0 = Math.min(c.x0, x0);
    c.x1 = Math.max(c.x1, x1);
  }
  return next;
}

/** Every alias the built-in profiles know, normalized ("withdrawalamt", "valuedt", …). */
const ALIASES: ReadonlySet<string> = new Set(
  [...BANK_PROFILES, GENERIC_PROFILE].flatMap((p) => {
    const c = p.columns as Record<string, unknown>;
    return Object.values(c).flatMap((v) => (Array.isArray(v) ? v.flat() : [])) as string[];
  }),
);

/** Split an item into words with x-ranges estimated by character count. */
function splitWords(it: PdfTextItem): PdfTextItem[] {
  const str = it.str;
  const perChar = str.length ? it.width / str.length : 0;
  const words: PdfTextItem[] = [];
  const re = /\S+/g;
  for (let m = re.exec(str); m; m = re.exec(str)) {
    words.push({
      ...it,
      str: m[0],
      x: it.x + m.index * perChar,
      width: m[0].length * perChar,
    });
  }
  return words;
}

/** Serial-number columns aren't profile columns but are common in PDF tables. */
const EXTRA_HEADERS = ['sno', 'srno', 'slno', 'serialno'];
const ALIAS_LIST = [...ALIASES, ...EXTRA_HEADERS];

/** 0 for a known header (or the start of one: "Transaction" above "Date"), else 1. */
function phraseCost(words: PdfTextItem[]): number {
  const n = norm(words.map((w) => w.str).join(''));
  if (ALIAS_LIST.includes(n)) return 0;
  return n.length >= 3 && ALIAS_LIST.some((a) => a.startsWith(n)) ? 0 : 1;
}

/**
 * pdf.js merges text runs separated by about one space, so two tight header labels can arrive as
 * one item ("Value Dt Withdrawal Amt."). Split such a cell into known header phrases when that
 * explains it better than keeping it whole (fewest unknown phrases, then fewest parts).
 */
function splitHeaderCell(cell: Column, height: number): Column[] {
  const words = splitWords({ str: cell.text, x: cell.x0, y: 0, width: cell.x1 - cell.x0, height });
  if (words.length < 2 || phraseCost(words) === 0 || words.length > 12) return [cell];
  // best[i] = cheapest segmentation of words[i..]
  const best: { cost: number; cut: number }[] = [];
  best[words.length] = { cost: 0, cut: words.length };
  for (let i = words.length - 1; i >= 0; i--) {
    let pick = { cost: Infinity, cut: i + 1 };
    for (let j = i + 1; j <= words.length; j++) {
      const cost = phraseCost(words.slice(i, j)) + 0.01 + (best[j] as { cost: number }).cost;
      if (cost < pick.cost) pick = { cost, cut: j };
    }
    best[i] = pick;
  }
  if ((best[0] as { cost: number }).cost >= 1) return [cell];
  const parts: Column[] = [];
  for (let i = 0; i < words.length;) {
    const j = (best[i] as { cut: number }).cut;
    const ws = words.slice(i, j);
    const lastW = ws.at(-1) as PdfTextItem;
    parts.push({
      x0: (ws[0] as PdfTextItem).x,
      x1: lastW.x + lastW.width,
      text: ws.map((w) => w.str).join(' '),
    });
    i = j;
  }
  return parts;
}

const overlap = (x0: number, x1: number, c: Column) => Math.min(x1, c.x1) - Math.max(x0, c.x0);

function bestColumn(x0: number, x1: number, cols: Column[]): number {
  let best = 0;
  let bestScore = -Infinity;
  cols.forEach((c, i) => {
    const o = overlap(x0, x1, c);
    const score = o > 0 ? o : -Math.min(Math.abs(x0 - c.x1), Math.abs(c.x0 - x1));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const NUMERIC_TOKEN = /^(\d[\d,]*\.\d{2}(cr|dr)?|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})$/i;

/** Amounts and dates become their own pieces; runs of other words stay together. */
function splitRuns(it: PdfTextItem): PdfTextItem[] {
  const runs: PdfTextItem[] = [];
  let textRun: PdfTextItem | null = null;
  for (const w of splitWords(it)) {
    if (NUMERIC_TOKEN.test(w.str)) {
      textRun = null;
      runs.push(w);
    } else if (textRun) {
      textRun.str += ` ${w.str}`;
      textRun.width = w.x + w.width - textRun.x;
    } else {
      textRun = { ...w };
      runs.push(textRun);
    }
  }
  return runs;
}

/**
 * Each item goes to the column whose header it overlaps most (or the nearest). An item that
 * overlaps several headers was merged by pdf.js ("02/10/26 450.50"), so its words are placed
 * one by one.
 */
function assign(line: Line, cols: Column[]): PdfTextItem[][] {
  const cells: PdfTextItem[][] = cols.map(() => []);
  for (const it of line.items) {
    const x1 = it.x + it.width;
    const hits = cols.filter((c) => overlap(it.x, x1, c) > 0).length;
    const pieces = hits >= 2 && /\s/.test(it.str.trim()) ? splitRuns(it) : [it];
    for (const p of pieces) (cells[bestColumn(p.x, p.x + p.width, cols)] as PdfTextItem[]).push(p);
  }
  return cells;
}

/** Column boundaries from x-ranges that no amount-bearing line covers (no header found). */
function gapColumns(lines: Line[]): Column[] {
  const rows = lines.filter((l) => AMOUNT.test(lineText(l)) && l.items.length >= 3);
  if (rows.length < 2) return [];
  const minX = Math.floor(Math.min(...rows.flatMap((l) => l.items.map((i) => i.x))));
  const maxX = Math.ceil(Math.max(...rows.flatMap((l) => l.items.map((i) => i.x + i.width))));
  const cover = new Array<number>(maxX + 2).fill(0);
  for (const l of rows) {
    const seen = new Uint8Array(maxX + 2);
    for (const it of l.items)
      for (let x = Math.floor(it.x); x <= Math.ceil(it.x + it.width); x++) seen[x] = 1;
    seen.forEach((v, x) => (cover[x] = (cover[x] as number) + v));
  }
  const limit = Math.max(1, rows.length * 0.1);
  const bounds: number[] = [];
  let gapStart: number | null = null;
  let seenInk = false;
  for (let x = 0; x < cover.length; x++) {
    const empty = (cover[x] as number) < limit;
    if (empty && gapStart === null && seenInk) gapStart = x;
    if (!empty) {
      if (gapStart !== null && x - gapStart >= 3) bounds.push((gapStart + x) / 2);
      gapStart = null;
      seenInk = true;
    }
  }
  if (bounds.length === 0) return [];
  const edges = [minX, ...bounds, maxX];
  return edges.slice(1).map((x1, i) => ({ x0: edges[i] as number, x1, text: '' }));
}

interface OutRow {
  /** Fragments per column; wrapped cells have several. */
  parts: string[][];
  data: boolean;
  y: number;
  h: number;
}

/**
 * Fixed-width wrapping: when most wrapped cells break at the same character count, a fragment of
 * exactly that length was cut mid-word (join without a space). Returns that length, or null.
 */
function wrapWidth(rows: OutRow[], col: number): number | null {
  const firstLens = rows
    .map((r) => r.parts[col] ?? [])
    .filter((p) => p.length > 1)
    .map((p) => (p[0] as string).length);
  if (firstLens.length < 2) return null;
  const counts = new Map<number, number>();
  for (const n of firstLens) counts.set(n, (counts.get(n) ?? 0) + 1);
  const [mode, freq] = [...counts].sort((a, b) => b[1] - a[1])[0] as [number, number];
  return mode >= 12 && freq / firstLens.length >= 0.6 ? mode : null;
}

function joinParts(parts: string[], width: number | null): string {
  const ps = parts.filter(Boolean);
  let out = ps[0] ?? '';
  for (let i = 1; i < ps.length; i++) {
    const prev = ps[i - 1] as string;
    out += (width !== null && prev.length === width ? '' : ' ') + (ps[i] as string);
  }
  return out;
}

export function pdfPagesToGrid(pages: PdfPage[]): Grid {
  const out: OutRow[] = [];
  let cols: Column[] | null = null;

  const allLines = pages.map((p) => toLines(p.items));
  const anyHeader = allLines.some((ls) => ls.some((_, i) => headerAt(ls, i) !== null));
  if (!anyHeader) {
    const gc = gapColumns(allLines.flat());
    if (gc.length > 1) cols = gc;
  }

  for (const lines of allLines) {
    let prev: OutRow | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as Line;
      const text = lineText(line);
      if (PAGE_FURNITURE.test(text)) continue;

      const header = anyHeader ? headerAt(lines, i) : null;
      if (header) {
        i += header.consumed - 1;
        cols = header.cols;
        out.push({ parts: cols.map((c) => [c.text]), data: false, y: line.y, h: line.h });
        prev = null;
        continue;
      }

      if (!cols) {
        out.push({ parts: [[text]], data: false, y: line.y, h: line.h }); // preamble
        continue;
      }

      const cells = assign(line, cols).map(joinItems);
      const isData = DATE.test(text) && AMOUNT.test(text);
      const wrapped =
        !isData &&
        prev?.data === true &&
        line.y - prev.y <= 1.7 * Math.max(line.h, prev.h) &&
        !AMOUNT.test(text) &&
        !DATE.test(text);
      if (wrapped && prev) {
        cells.forEach((c, col) => {
          if (!c) return;
          const p = (prev as OutRow).parts;
          p[col] = [...(p[col] ?? []).filter(Boolean), c];
        });
        prev.y = line.y;
        continue;
      }
      const row: OutRow = { parts: cells.map((c) => [c]), data: isData, y: line.y, h: line.h };
      out.push(row);
      prev = row;
    }
  }

  const width = Math.max(1, ...out.map((r) => r.parts.length));
  const wraps = Array.from({ length: width }, (_, c) => wrapWidth(out, c));
  return out.map((r) =>
    Array.from({ length: width }, (_, c) => joinParts(r.parts[c] ?? [], wraps[c] ?? null)),
  );
}
