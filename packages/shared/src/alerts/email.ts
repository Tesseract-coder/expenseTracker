import { type ParseAlertOptions, type ParsedAlert, parseAlerts } from './parse';

/**
 * Plain text from a bank alert e-mail (spec §3.4). Bank alerts are often HTML-only; forwarded
 * mail adds a header block. The result goes to `parseAlerts`, which splits on blank lines, so
 * block-level HTML elements become paragraph breaks.
 */
const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  rupee: '₹',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|table|h[1-6]|li|blockquote)>/gi, '\n\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const FORWARD_HEADER =
  /^(?:-{2,}\s*(?:forwarded message|original message)\s*-{2,}|(?:from|sent|date|to|cc|subject):\s.*|begin forwarded message:?)$/i;

/** Body text of an alert e-mail: prefers text/plain, falls back to HTML; drops forward headers. */
export function emailToText(email: { text?: string | null; html?: string | null }): string {
  const body = email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : '';
  return body
    .split(/\r?\n/)
    .map((l) => l.replace(/^>+\s?/, '').trim())
    .map((l) => (FORWARD_HEADER.test(l) ? '' : l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20_000);
}

/**
 * Alerts in one e-mail. Paragraph breaks are folded so a reference number in its own paragraph
 * ("Your UPI transaction reference number is …") stays with the alert; lines that each look like
 * an alert (digest e-mails) are still split.
 */
export function parseEmailAlerts(
  email: { text?: string | null; html?: string | null },
  opts: ParseAlertOptions,
): ParsedAlert[] {
  return parseAlerts(emailToText(email).replace(/\n\s*\n/g, '\n'), opts).alerts;
}
