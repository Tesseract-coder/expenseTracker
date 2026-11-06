/**
 * Reads a (possibly password-protected) PDF statement into a Grid with pdf.js. pdf.js itself is
 * passed in, so this module stays dependency-free: the web app lazy-loads `pdfjs-dist` and the
 * tests use its Node build. Runs only on the device; the password is used for this one call and
 * never stored, logged or sent anywhere.
 */
import type { Grid } from './mapping';
import { type PdfPage, type PdfTextItem, pdfPagesToGrid } from './pdfLayout';

/** The parts of the pdf.js API we use. */
export interface PdfJsLike {
  getDocument(params: Record<string, unknown>): {
    promise: Promise<PdfDocumentLike>;
    destroy(): Promise<void>;
  };
}
interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { height: number; transform: number[] };
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
}

export type PdfErrorReason =
  'password_needed' | 'password_incorrect' | 'no_text' | 'too_many_pages';

export class PdfReadError extends Error {
  constructor(
    public readonly reason: PdfErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'PdfReadError';
  }
}

export const MAX_PDF_PAGES = 200;

interface RawItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

function toItem(raw: RawItem, view: number[]): PdfTextItem | null {
  const t = raw.transform;
  if (typeof raw.str !== 'string' || !t || t.length < 6) return null;
  // Text matrix → viewport (top-left origin, y down): handles page rotation and cropping.
  const [a, b, c, d, e, f] = view as [number, number, number, number, number, number];
  const x = a * (t[4] as number) + c * (t[5] as number) + e;
  const y = b * (t[4] as number) + d * (t[5] as number) + f;
  const height = Math.hypot(t[2] as number, t[3] as number) || raw.height || 0;
  return { str: raw.str, x, y, width: raw.width ?? 0, height };
}

export async function readPdfStatement(
  pdfjs: PdfJsLike,
  data: ArrayBuffer,
  opts: { password?: string } = {},
): Promise<Grid> {
  const task = pdfjs.getDocument({
    // pdf.js transfers the buffer to its worker; give it a copy so callers can retry.
    data: new Uint8Array(data.slice(0)),
    password: opts.password,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc: PdfDocumentLike;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy();
    const e = err as { name?: string; code?: number };
    if (e?.name === 'PasswordException') {
      // pdf.js: code 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
      throw e.code === 2
        ? new PdfReadError('password_incorrect', 'That password is not right. Try again.')
        : new PdfReadError('password_needed', 'This PDF is password-protected.');
    }
    throw new Error("This PDF couldn't be opened. Download it again from net banking.", {
      cause: err,
    });
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES)
      throw new PdfReadError(
        'too_many_pages',
        `This PDF has ${doc.numPages} pages; import statements of up to ${MAX_PDF_PAGES} pages.`,
      );
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const view = page.getViewport({ scale: 1 }).transform;
      const content = await page.getTextContent();
      const items = (content.items as RawItem[])
        .map((i) => toItem(i, view))
        .filter((i): i is PdfTextItem => i !== null);
      pages.push({ items });
    }
    if (pages.every((p) => p.items.every((i) => !i.str.trim())))
      throw new PdfReadError(
        'no_text',
        'This PDF has no readable text (it may be a scan). Download the CSV or Excel statement instead.',
      );
    return pdfPagesToGrid(pages);
  } finally {
    await task.destroy();
  }
}
