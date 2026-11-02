import { describe, expect, it } from 'vitest';
import { emailToText, htmlToText, parseEmailAlerts } from './email';

const HDFC_HTML = `<html><head><style>p{color:red}</style></head><body>
<table><tr><td>Dear Customer,</td></tr>
<tr><td><p>Rs.649.00 has been debited from account **1234 to VPA netflix.upi@hdfcbank NETFLIX on 30-10-26.</p>
<p>Your UPI transaction reference number is 430312345678.</p></td></tr>
<tr><td>If you did not authorize this transaction, please call 18002586161.<br>Warm Regards,<br>HDFC&nbsp;Bank</td></tr></table>
<!-- tracking --></body></html>`;

describe('htmlToText', () => {
  it('keeps paragraphs, drops styles/comments, decodes entities', () => {
    const t = htmlToText(HDFC_HTML);
    expect(t).not.toContain('color:red');
    expect(t).not.toContain('tracking');
    expect(t).toContain('HDFC Bank');
    expect(t).toContain('\n\nYour UPI transaction reference number is 430312345678.');
    expect(htmlToText('&#8377;500 &#x20B9;5 &amp; &bogus; &#0;')).toBe('₹500 ₹5 & &bogus; &#0;');
  });
});

describe('emailToText', () => {
  it('prefers text/plain and strips forward headers and quote marks', () => {
    const text = [
      '---------- Forwarded message ---------',
      'From: HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
      'Date: Fri, 30 Oct 2026 at 10:15',
      'Subject: You have done a UPI txn',
      'To: <me@example.com>',
      '',
      '> Rs.649.00 has been debited from account **1234 to VPA netflix.upi@hdfcbank on 30-10-26.',
    ].join('\n');
    expect(emailToText({ text, html: '<p>ignored</p>' })).toBe(
      'Rs.649.00 has been debited from account **1234 to VPA netflix.upi@hdfcbank on 30-10-26.',
    );
  });

  it('falls back to HTML and yields one alert with its reference number', () => {
    const alerts = parseEmailAlerts(
      { text: '  ', html: HDFC_HTML },
      { fallbackDate: '2026-11-02' },
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      amountPaise: 64900,
      direction: 'out',
      last4: '1234',
      txnDate: '2026-10-30',
      refNo: '430312345678',
      vpa: 'netflix.upi@hdfcbank',
    });
  });

  it('splits digest e-mails with one alert per line', () => {
    const text = 'Rs 10 debited from A/c XX1234 to A\n\nRs 20 debited from A/c XX1234 to B';
    expect(parseEmailAlerts({ text }, { fallbackDate: '2026-11-02' })).toHaveLength(2);
  });

  it('handles an empty message', () => {
    expect(emailToText({})).toBe('');
  });
});
