/**
 * Generates the PDF statement fixtures (run: node scripts/generate-pdf-fixtures.ts from
 * packages/shared). Output is committed and byte-stable; regenerate only when changing a fixture.
 *
 * The PDFs are written by hand (no PDF library): one text item per table cell, like bank
 * statement generators produce, with right-aligned amounts, wrapped narrations, repeated page
 * headers and a two-line header. `hdfc/savings-protected.pdf` uses the PDF Standard security
 * handler (RC4 128-bit, revision 3) with the user password below, so the password path of the
 * importer is tested against a real encrypted file.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const HDFC_PDF_PASSWORD = 'SAMPLE1234';

const out = (p: string) => fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url));

// ---------------------------------------------------------------------------------------------
// Text layout helpers (Helvetica metrics for the characters we right-align).
const WIDTHS: Record<string, number> = { ',': 278, '.': 278, '-': 333, ' ': 278 };
const textWidth = (s: string, size: number) =>
  ([...s].reduce((w, ch) => w + (WIDTHS[ch] ?? (/\d/.test(ch) ? 556 : 600)), 0) * size) / 1000;

interface Cell {
  text: string;
  x: number;
  align?: 'left' | 'right';
}
type Line = { y: number; cells: Cell[]; size?: number };

const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

function contentStream(lines: Line[]): string {
  const ops: string[] = [];
  for (const line of lines) {
    const size = line.size ?? 8;
    for (const c of line.cells) {
      if (!c.text) continue;
      const x = c.align === 'right' ? c.x - textWidth(c.text, size) : c.x;
      ops.push(`BT /F1 ${size} Tf ${x.toFixed(2)} ${line.y.toFixed(2)} Td (${esc(c.text)}) Tj ET`);
    }
  }
  return ops.join('\n');
}

// ---------------------------------------------------------------------------------------------
// RC4 + Standard security handler (PDF 1.7 §7.6.3, algorithms 1, 2, 3 and 5; R = 3, 128-bit).
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...parts: Buffer[]) => {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return h.digest();
};
function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  const at = (i: number) => s[i] ?? 0;
  const swap = (a: number, b: number) => {
    const t = at(a);
    s[a] = at(b);
    s[b] = t;
  };
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + at(i) + (key[i % key.length] ?? 0)) & 255;
    swap(i, j);
  }
  const outBuf = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + at(i)) & 255;
    swap(i, j);
    outBuf[n] = (data[n] ?? 0) ^ at((at(i) + at(j)) & 255);
  }
  return outBuf;
}
const padPw = (pw: string) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);
const xorKey = (key: Buffer, i: number) => Buffer.from(key.map((b) => b ^ i));

function standardSecurity(userPw: string, ownerPw: string, fileId: Buffer, perms: number) {
  // Algorithm 3: O entry.
  let ok = md5(padPw(ownerPw));
  for (let i = 0; i < 50; i++) ok = md5(ok);
  let o = rc4(ok, padPw(userPw));
  for (let i = 1; i <= 19; i++) o = rc4(xorKey(ok, i), o);
  // Algorithm 2: file key.
  const p = Buffer.alloc(4);
  p.writeInt32LE(perms);
  let key = md5(padPw(userPw), o, p, fileId);
  for (let i = 0; i < 50; i++) key = md5(key);
  // Algorithm 5: U entry.
  let u = rc4(key, md5(PAD, fileId));
  for (let i = 1; i <= 19; i++) u = rc4(xorKey(key, i), u);
  return { key, o, u: Buffer.concat([u, Buffer.alloc(16)]) };
}
function objectKey(key: Buffer, num: number) {
  const suffix = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]);
  return md5(key, suffix).subarray(0, Math.min(key.length + 5, 16));
}

// ---------------------------------------------------------------------------------------------
// Minimal PDF writer: catalog, pages, Helvetica, one content stream per page.
function writePdf(path: string, pages: Line[][], encrypt?: { userPw: string }) {
  const fileId = md5(Buffer.from(`kharcha-fixture:${path}`));
  const perms = -3904; // print + copy allowed, everything else denied
  const sec = encrypt ? standardSecurity(encrypt.userPw, 'owner-only', fileId, perms) : null;

  const objs: (string | Buffer)[] = [];
  const add = (body: string | Buffer) => objs.push(body) as number; // returns object number
  const pageNums = pages.map((_, i) => 4 + i * 2);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(
    `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  pages.forEach((lines, i) => {
    const contentNum = 5 + i * 2;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`,
    );
    let data = Buffer.from(contentStream(lines), 'latin1');
    if (sec) data = rc4(objectKey(sec.key, contentNum), data);
    add(
      Buffer.concat([
        Buffer.from(`<< /Length ${data.length} >>\nstream\n`),
        data,
        Buffer.from('\nendstream'),
      ]),
    );
  });
  let encryptNum = 0;
  if (sec) {
    encryptNum = add(
      `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${perms} /O <${sec.o.toString('hex')}> /U <${sec.u.toString('hex')}> >>`,
    );
  }

  const header = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
  const chunks: Buffer[] = [header];
  let offset = header.length;
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    const buf = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
      Buffer.from('\nendobj\n'),
    ]);
    offsets.push(offset);
    offset += buf.length;
    chunks.push(buf);
  });
  const xref = [
    'xref',
    `0 ${objs.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objs.length + 1} /Root 1 0 R${sec ? ` /Encrypt ${encryptNum} 0 R` : ''} /ID [<${fileId.toString('hex')}> <${fileId.toString('hex')}>] >>`,
    'startxref',
    String(offset),
    '%%EOF',
    '',
  ].join('\n');
  chunks.push(Buffer.from(xref, 'latin1'));
  writeFileSync(out(path), Buffer.concat(chunks));
}

// ---------------------------------------------------------------------------------------------
// HDFC savings, password-protected, two pages. Narrations wrap at the column width.
type HdfcRow = [date: string, narration: string, ref: string, wd: string, dep: string, bal: string];
const HDFC_ROWS: HdfcRow[] = [
  [
    '01/10/26',
    'NEFT CR-HDFC0000123-ACME TECH PVT LTD-SALARY OCT 2026',
    'N274262626000001',
    '',
    '95,000.00',
    '1,45,000.00',
  ],
  [
    '02/10/26',
    'UPI-SWIGGY LIMITED-SWIGGY.INSTAMART@YBL-YESB0YBLUPI-427512345678-PAYMENT FROM PHONE',
    '0000427512345678',
    '450.50',
    '',
    '1,44,549.50',
  ],
  [
    '02/10/26',
    'UPI-CHAI POINT-CHAIWALA@PAYTM-PYTM0123456-427512345600-UPI',
    '0000427512345600',
    '20.00',
    '',
    '1,44,529.50',
  ],
  [
    '02/10/26',
    'UPI-CHAI POINT-CHAIWALA@PAYTM-PYTM0123456-427512345600-UPI',
    '0000427512345600',
    '20.00',
    '',
    '1,44,509.50',
  ],
  [
    '05/10/26',
    'CC 000485498XXXXXX4321 AUTOPAY SI-TAD',
    '0000000000000000',
    '18,500.00',
    '',
    '1,26,009.50',
  ],
  [
    '07/10/26',
    'POS 416021XXXXXX1234 DMART AVENUE SUPE',
    '0000627512345611',
    '1,560.00',
    '',
    '1,24,449.50',
  ],
  [
    '15/10/26',
    'IMPS-427598761234-SELF-KKBK0000123-XXXXXX5678-TO KOTAK',
    '0000427598761234',
    '20,000.00',
    '',
    '1,04,449.50',
  ],
  [
    '20/10/26',
    'NWD-416021XXXXXX1234-S1AW0123-PUNE',
    '0000629312345678',
    '5,000.00',
    '',
    '99,449.50',
  ],
  [
    '28/10/26',
    'UPI-AMAZON PAY INDIA-AMAZONPAY@APL-UTIB0000100-430112345678-REFUND',
    '0000430112345678',
    '',
    '1,299.00',
    '1,00,748.50',
  ],
];

function wrap(text: string, width: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += width) parts.push(text.slice(i, i + width));
  return parts;
}

const HDFC_COLS = { date: 40, narr: 82, ref: 262, vdt: 340, wd: 440, dep: 500, bal: 565 };
function hdfcHeader(y: number): Line {
  return {
    y,
    cells: [
      { text: 'Date', x: HDFC_COLS.date },
      { text: 'Narration', x: HDFC_COLS.narr },
      { text: 'Chq./Ref.No.', x: HDFC_COLS.ref },
      { text: 'Value Dt', x: HDFC_COLS.vdt },
      { text: 'Withdrawal Amt.', x: HDFC_COLS.wd, align: 'right' },
      { text: 'Deposit Amt.', x: HDFC_COLS.dep, align: 'right' },
      { text: 'Closing Balance', x: HDFC_COLS.bal, align: 'right' },
    ],
  };
}
function hdfcPage(rows: HdfcRow[], first: boolean, last: boolean, pageNo: number): Line[] {
  const lines: Line[] = [];
  let y = 800;
  if (first) {
    lines.push({ y, size: 12, cells: [{ text: 'HDFC BANK Ltd.', x: 40 }] });
    y -= 18;
    lines.push({
      y,
      cells: [
        { text: 'MR A SAMPLE', x: 40 },
        { text: 'Account No : 50100012345678', x: 360 },
      ],
    });
    y -= 12;
    lines.push({
      y,
      cells: [
        { text: '12 SAMPLE NAGAR, PUNE', x: 40 },
        { text: 'Statement From : 01/10/2026 To : 31/10/2026', x: 360 },
      ],
    });
    y -= 24;
  }
  lines.push(hdfcHeader(y));
  y -= 14;
  for (const [date, narration, ref, wd, dep, bal] of rows) {
    const narr = wrap(narration, 34);
    lines.push({
      y,
      cells: [
        { text: date, x: HDFC_COLS.date },
        { text: narr[0] ?? '', x: HDFC_COLS.narr },
        { text: ref, x: HDFC_COLS.ref },
        { text: date, x: HDFC_COLS.vdt },
        { text: wd, x: HDFC_COLS.wd, align: 'right' },
        { text: dep, x: HDFC_COLS.dep, align: 'right' },
        { text: bal, x: HDFC_COLS.bal, align: 'right' },
      ],
    });
    y -= 10;
    for (const more of narr.slice(1)) {
      lines.push({ y, cells: [{ text: more, x: HDFC_COLS.narr }] });
      y -= 10;
    }
    y -= 2;
  }
  if (last) {
    y -= 16;
    lines.push({ y, cells: [{ text: 'STATEMENT SUMMARY :-', x: 40 }] });
    y -= 12;
    lines.push({
      y,
      cells: [
        { text: 'Opening Balance', x: 40 },
        { text: 'Dr Count', x: 160 },
        { text: 'Cr Count', x: 240 },
        { text: 'Debits', x: 340 },
        { text: 'Credits', x: 440 },
        { text: 'Closing Bal', x: 540 },
      ],
    });
    y -= 12;
    lines.push({
      y,
      cells: [
        { text: '50,000.00', x: 40 },
        { text: '7', x: 160 },
        { text: '2', x: 240 },
        { text: '45,550.50', x: 340 },
        { text: '96,299.00', x: 440 },
        { text: '1,00,748.50', x: 540 },
      ],
    });
  }
  lines.push({ y: 30, size: 7, cells: [{ text: `Page No .: ${pageNo}`, x: 500 }] });
  return lines;
}

writePdf(
  'hdfc/savings-protected.pdf',
  [hdfcPage(HDFC_ROWS.slice(0, 5), true, false, 1), hdfcPage(HDFC_ROWS.slice(5), false, true, 2)],
  { userPw: HDFC_PDF_PASSWORD },
);

// ---------------------------------------------------------------------------------------------
// ICICI savings, unencrypted, one page with a two-line header and a serial-number column.
const ICICI_COLS = { sno: 40, date: 62, remarks: 130, wd: 430, dep: 500, bal: 565 };
const iciciLines: Line[] = [
  { y: 800, size: 11, cells: [{ text: 'DETAILED STATEMENT', x: 40 }] },
  { y: 784, cells: [{ text: 'Account Number : XXXXXXXX0123 ( INR ) - MR A SAMPLE', x: 40 }] },
  { y: 772, cells: [{ text: 'Transaction Period : From 01/10/2026 To 31/10/2026', x: 40 }] },
  {
    y: 748,
    cells: [
      { text: 'S No.', x: ICICI_COLS.sno },
      { text: 'Transaction', x: ICICI_COLS.date },
      { text: 'Transaction Remarks', x: ICICI_COLS.remarks },
      { text: 'Withdrawal Amount', x: ICICI_COLS.wd, align: 'right' },
      { text: 'Deposit Amount', x: ICICI_COLS.dep, align: 'right' },
      { text: 'Balance', x: ICICI_COLS.bal, align: 'right' },
    ],
  },
  {
    y: 739,
    cells: [
      { text: 'Date', x: ICICI_COLS.date },
      { text: '(INR )', x: ICICI_COLS.wd, align: 'right' },
      { text: '(INR )', x: ICICI_COLS.dep, align: 'right' },
      { text: '(INR )', x: ICICI_COLS.bal, align: 'right' },
    ],
  },
];
const ICICI_ROWS: [string, string, string, string, string][] = [
  ['01/10/2026', 'NEFT-CITIN26274123456-ACME TECH PVT LTD-SALARY', '', '82,000.00', '1,32,000.00'],
  [
    '03/10/2026',
    'UPI/427612345678/ZOMATO LTD/zomato@hdfcbank/Paid via app',
    '612.00',
    '',
    '1,31,388.00',
  ],
  ['09/10/2026', 'ATM/CASH WDL/S1CN1234/PUNE', '3,000.00', '', '1,28,388.00'],
  ['18/10/2026', 'BIL/ONL/000123456/BESCOM/ELECTRICITY BILL', '1,845.00', '', '1,26,543.00'],
];
let iy = 724;
ICICI_ROWS.forEach(([date, remarks, wd, dep, bal], i) => {
  iciciLines.push({
    y: iy,
    cells: [
      { text: String(i + 1), x: ICICI_COLS.sno },
      { text: date, x: ICICI_COLS.date },
      { text: remarks, x: ICICI_COLS.remarks },
      { text: wd, x: ICICI_COLS.wd, align: 'right' },
      { text: dep, x: ICICI_COLS.dep, align: 'right' },
      { text: bal, x: ICICI_COLS.bal, align: 'right' },
    ],
  });
  iy -= 12;
});
iciciLines.push({
  y: 30,
  size: 7,
  cells: [{ text: 'This is a system-generated statement.', x: 40 }],
});
writePdf('icici/savings.pdf', [iciciLines]);
