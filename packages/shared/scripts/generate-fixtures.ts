/**
 * Generates the XLSX statement fixtures (run: node scripts/generate-fixtures.ts from packages/shared).
 * Output is committed; regenerate only when intentionally changing a fixture.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const out = (p: string) => fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url));

function write(path: string, rows: unknown[][], dateFormat?: string) {
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: dateFormat });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Statement');
  // Fixed metadata so the binary output is stable across runs.
  wb.Props = { Title: 'Fixture', CreatedDate: new Date(Date.UTC(2026, 10, 1)) };
  writeFileSync(out(path), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }));
}

// HDFC: text dates (dd/mm/yy), preamble, **** separator, wrapped narration, identical ₹20 rows, summary footer.
write('hdfc/savings.xlsx', [
  ['HDFC BANK Ltd.', '', '', '', '', '', ''],
  ['MR A SAMPLE', '', '', '', '', 'Account No :', '50100012345678'],
  ['12 SAMPLE NAGAR, PUNE', '', '', '', '', 'Statement From :', '01/10/2026 To : 31/10/2026'],
  ['', '', '', '', '', '', ''],
  [
    'Date',
    'Narration',
    'Chq./Ref.No.',
    'Value Dt',
    'Withdrawal Amt.',
    'Deposit Amt.',
    'Closing Balance',
  ],
  ['********', '********', '********', '********', '********', '********', '********'],
  [
    '01/10/26',
    'NEFT CR-HDFC0000123-ACME TECH PVT LTD-SALARY OCT 2026',
    'N274262626000001',
    '01/10/26',
    '',
    '95,000.00',
    '1,45,000.00',
  ],
  [
    '02/10/26',
    'UPI-SWIGGY LIMITED-SWIGGY.INSTAMART@YBL-YESB0YBLUPI-427512345678-',
    '0000427512345678',
    '02/10/26',
    '450.50',
    '',
    '1,44,549.50',
  ],
  ['', 'PAYMENT FROM PHONE', '', '', '', '', ''],
  [
    '02/10/26',
    'UPI-CHAI POINT-CHAIWALA@PAYTM-PYTM0123456-427512345600-UPI',
    '0000427512345600',
    '02/10/26',
    '20.00',
    '',
    '1,44,529.50',
  ],
  [
    '02/10/26',
    'UPI-CHAI POINT-CHAIWALA@PAYTM-PYTM0123456-427512345600-UPI',
    '0000427512345600',
    '02/10/26',
    '20.00',
    '',
    '1,44,509.50',
  ],
  [
    '05/10/26',
    'CC 000485498XXXXXX4321 AUTOPAY SI-TAD',
    '0000000000000000',
    '05/10/26',
    '18,500.00',
    '',
    '1,26,009.50',
  ],
  [
    '07/10/26',
    'POS 416021XXXXXX1234 DMART AVENUE SUPE',
    '0000627512345611',
    '07/10/26',
    '1,560.00',
    '',
    '1,24,449.50',
  ],
  [
    '15/10/26',
    'IMPS-427598761234-SELF-KKBK0000123-XXXXXX5678-TO KOTAK',
    '0000427598761234',
    '15/10/26',
    '20,000.00',
    '',
    '1,04,449.50',
  ],
  [
    '31/10/26',
    'INTEREST PAID TILL 31-OCT-2026',
    '0000000000000000',
    '31/10/26',
    '',
    '402.00',
    '1,04,851.50',
  ],
  ['', '', '', '', '', '', ''],
  ['STATEMENT SUMMARY :-', '', '', '', '', '', ''],
  ['Opening Balance', 'Dr Count', 'Cr Count', 'Debits', 'Credits', 'Closing Bal', ''],
  ['50,000.00', '6', '2', '40,550.50', '95,402.00', '1,04,851.50', ''],
]);

// ICICI: genuine Excel date cells and numeric amounts.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
write(
  'icici/savings.xlsx',
  [
    ['DETAILED STATEMENT', '', '', '', '', '', '', ''],
    ['Account Number', '000401234567 ( INR ) - MR A SAMPLE', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    [
      'S No.',
      'Value Date',
      'Transaction Date',
      'Cheque Number',
      'Transaction Remarks',
      'Withdrawal Amount (INR )',
      'Deposit Amount (INR )',
      'Balance (INR )',
    ],
    [
      1,
      d(2026, 10, 1),
      d(2026, 10, 1),
      '-',
      'NEFT-HDFCN52026100112345-ACME TECH PVT LTD-SALARY',
      0,
      95000,
      120000,
    ],
    [
      2,
      d(2026, 10, 3),
      d(2026, 10, 3),
      '-',
      'UPI/427512340001/ZEPTO/zepto.payu@hdfcbank/Payment',
      812.45,
      0,
      119187.55,
    ],
    [
      3,
      d(2026, 10, 4),
      d(2026, 10, 4),
      '-',
      'BIL/ONL/000123456789/MSEDCL/ELECTRICITY',
      1890,
      0,
      117297.55,
    ],
    [4, d(2026, 10, 6), d(2026, 10, 6), '000123', 'CLG/RENT OCT/LANDLORD NAME', 25000, 0, 92297.55],
    [
      5,
      d(2026, 10, 15),
      d(2026, 10, 15),
      '-',
      'ACH/GROWW-SIP/ICIC7012345678901',
      5000,
      0,
      87297.55,
    ],
  ],
  'dd/mm/yyyy',
);

console.info('fixtures written');
