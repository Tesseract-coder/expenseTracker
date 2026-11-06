import { describe, expect, it, vi } from 'vitest';
import { MAX_PDF_PAGES, type PdfJsLike, readPdfStatement } from './pdfRead';

function fakePdfjs(pages: { items: unknown[] }[], numPages = pages.length) {
  const destroy = vi.fn(async () => {});
  const lib: PdfJsLike = {
    getDocument: () => ({
      destroy,
      promise: Promise.resolve({
        numPages,
        getPage: async (n: number) => ({
          // A4 portrait: flip y so the origin is top-left
          getViewport: () => ({ height: 842, transform: [1, 0, 0, -1, 0, 842] }),
          getTextContent: async () => pages[n - 1] ?? { items: [] },
        }),
      }),
    }),
  };
  return { lib, destroy };
}

const item = (str: string, x: number, yFromBottom: number) => ({
  str,
  transform: [8, 0, 0, 8, x, yFromBottom],
  width: str.length * 4.4,
  height: 8,
});

describe('readPdfStatement', () => {
  it('converts pdf.js coordinates to top-down lines and always releases the document', async () => {
    const { lib, destroy } = fakePdfjs([
      { items: [item('second', 40, 700), item('first', 40, 800), { str: 'no transform' }] },
    ]);
    expect(await readPdfStatement(lib, new ArrayBuffer(4))).toEqual([['first'], ['second']]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rejects scans without text and very long PDFs', async () => {
    const scan = fakePdfjs([{ items: [item(' ', 40, 800)] }]);
    await expect(readPdfStatement(scan.lib, new ArrayBuffer(4))).rejects.toMatchObject({
      reason: 'no_text',
    });
    expect(scan.destroy).toHaveBeenCalledOnce();
    const long = fakePdfjs([], MAX_PDF_PAGES + 1);
    await expect(readPdfStatement(long.lib, new ArrayBuffer(4))).rejects.toMatchObject({
      reason: 'too_many_pages',
    });
  });

  it('maps pdf.js password errors', async () => {
    const failing = (code: number): PdfJsLike => ({
      getDocument: () => ({
        destroy: async () => {},
        promise: Promise.reject(
          Object.assign(new Error('pw'), { name: 'PasswordException', code }),
        ),
      }),
    });
    await expect(readPdfStatement(failing(1), new ArrayBuffer(4))).rejects.toMatchObject({
      reason: 'password_needed',
    });
    await expect(readPdfStatement(failing(2), new ArrayBuffer(4))).rejects.toMatchObject({
      reason: 'password_incorrect',
    });
  });
});
