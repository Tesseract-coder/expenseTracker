/**
 * pdf.js loader (lazy chunk). Only imported when a PDF statement is chosen, so the ~1.7 MB of
 * pdf.js never weighs on the main bundle or the service-worker precache.
 */
import { readPdfStatement } from '@kharcha/shared';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Decrypts (with the password, if any) and lays out the PDF on this device. */
export const readPdf = (data: ArrayBuffer, password?: string) =>
  readPdfStatement(pdfjs, data, password === undefined ? {} : { password });
