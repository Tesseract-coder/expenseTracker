import type { AccountType, Channel } from '../schemas/enums';
import { counterpartyKey } from '../text/counterparty';

/**
 * Counterparty normalization for Indian bank narrations (spec §6.1).
 *
 *   UPI/DR/412345678901/SWIGGY LIMITED/YESB/swiggy.instamart@ybl/Payment
 *   UPI-SWIGGY LIMITED-SWIGGY.INSTAMART@YBL-YESB0YBLUPI-427512345678-PAYMENT FROM PHONE
 *   NEFT CR-HDFC0000123-ACME TECH PVT LTD-SALARY OCT
 *   POS 4111XXXX1234 AMAZON PAY IN GROCE
 *
 * Pure and allocation-light: it runs once per imported row inside the Worker's CPU budget.
 */
export interface NormalizedNarration {
  channel: Channel;
  /** Lower-cased UPI VPA, e.g. `swiggy.instamart@ybl`. */
  vpa: string | null;
  /** First four letters of an IFSC (or a UPI bank code), e.g. `HDFC`. */
  ifscPrefix: string | null;
  /** UPI RRN / IMPS / NEFT UTR found in the narration (statement ref columns take precedence). */
  refNo: string | null;
  /** Human display name, e.g. `Swiggy`, `Acme Tech`, `Ramesh K`. */
  payee: string | null;
  /** Free-text remark such as `SALARY OCT` or `gift`. */
  remark: string | null;
  /** Canonical counterparty key: the VPA when present, else the cleaned payee name. */
  counterpartyKey: string | null;
}

const MAX_NAME = 80;

// Ordered: payment rails first (a UPI narration may contain the word "charges" in its remark),
// then charges before ATM ("ATM WDL CHARGES" is a fee, not a withdrawal).
const CHANNEL_PATTERNS: readonly (readonly [Channel, RegExp])[] = [
  ['upi', /(?:^|[^A-Z])UPI(?:[^A-Z]|$)/],
  ['neft', /NEFT/],
  ['rtgs', /RTGS/],
  ['imps', /IMPS|(?:^|[^A-Z])MMT[/ -]/],
  ['nach', /NACH/],
  ['ach', /(?:^|[^A-Z])ACH(?:[^A-Z]|DR|CR|$)/],
  ['ecs', /(?:^|[^A-Z])ECS(?:[^A-Z]|$)/],
  ['charges', /(?:^|[^A-Z])(?:CHARGES?|CHRGS?|CHGS?|FEES?|AMC|GST)(?:[^A-Z]|$)/],
  ['atm', /(?:^|[^A-Z])(?:ATM|NWD|ATW|EAW)(?:[^A-Z]|$)|CASH W(?:DL|ITHDRAWAL)/],
  ['pos', /(?:^|[^A-Z])(?:POS|PCD)(?:[^A-Z]|$)/],
  ['card', /ECOM PUR|(?:^|[^A-Z])ECOM(?:[^A-Z]|$)/],
  [
    'interest',
    /INTEREST|(?:^|[^A-Z])INT\.? ?(?:PD|CR|PAID)(?:[^A-Z]|$)|(?:^|[^A-Z])SB INT(?:[^A-Z]|$)/,
  ],
];

/** Channels whose narration names no counterparty. */
const NO_COUNTERPARTY: ReadonlySet<Channel> = new Set(['atm', 'interest', 'charges']);

const VPA_RE = /([a-z0-9][a-z0-9._]{0,63})@([a-z]{2,20})(?![a-z0-9.])/i;
const IFSC_RE = /(?:^|[^A-Z0-9])([A-Z]{4})0[A-Z0-9]{6}(?![A-Z0-9])/;
const RRN_RE = /(?:^|\D)(\d{12})(?!\d)/;
const UTR_RE = /(?:^|[^A-Z0-9])([A-Z]{4}[A-Z0-9]?\d{10,})(?![A-Z0-9])/;

/** Bank codes that appear as their own segment in UPI narrations (`.../MOM/HDFC/mom@okhdfcbank`). */
// prettier-ignore
const BANK_CODES = new Set([
  'HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK', 'YESB', 'PYTM', 'BARB', 'PUNB', 'CNRB', 'UBIN', 'IDIB',
  'IOBA', 'INDB', 'FDRL', 'IDFB', 'AIRP', 'KARB', 'BKID', 'MAHB', 'CBIN', 'UCBA', 'CIUB', 'KVBL',
  'SIBL', 'TMBL', 'DBSS', 'SCBL', 'CITI', 'HSBC', 'AUBL', 'ESFB', 'JAKA', 'RATN', 'DLXB', 'PSIB',
  'ICICI', 'AXIS', 'SBI', 'KOTAK', 'YES',
]);

/** Whole segments that are rail/format markers, never names. */
// prettier-ignore
const MARKER_SEGMENTS = new Set([
  'UPI', 'DR', 'CR', 'P2A', 'P2M', 'P2P', 'NEFT', 'NEFT CR', 'NEFT DR', 'IMPS', 'RTGS', 'ACH',
  'NACH', 'ECS', 'BY TRANSFER', 'TO TRANSFER', 'TRANSFER', 'MMT', 'INB', 'BIL', 'ONL', 'BPAY',
  'POS', 'ECOM', 'ECOM PUR', 'DEBIT', 'CREDIT', 'CHQ PAID', 'CHQ DEP', 'MICR CLG', 'CLG',
  'ACH D', 'ACH C', 'PAYMENT', 'PAY', 'PAYMENT FROM PHONE', 'COLLECT', 'NA', 'UPI LITE',
  'UPI INTENT', 'SENT USING PAYTM UPI', 'PAID VIA CRED', 'NO REMARKS', 'OK',
]);

/** Words dropped inside a segment (rail prefixes glued to names). */
// prettier-ignore
const MARKER_WORDS = new Set([
  'POS', 'ECOM', 'ACHDR', 'ACHCR', 'ACH', 'NACH', 'INB', 'UPI', 'IMPS', 'NEFT', 'RTGS', 'MMT', 'PCD',
]);

/** Words that never identify a payee on their own; trailing ones are dropped from display names. */
// prettier-ignore
const NAME_NOISE = new Set([
  'PVT', 'PRIVATE', 'LTD', 'LIMITED', 'LLP', 'INC', 'CO', 'CORP', 'CORPORATION', 'COMPANY', 'THE',
  'INDIA', 'IND', 'PAYMENT', 'PAYMENTS', 'UPI', 'SERVICES', 'SERVICE', 'TECHNOLOGIES',
  'TECHNOLOGY', 'SOLUTIONS', 'SYSTEMS', 'ENTERPRISES', 'COM', 'RECEIVED', 'THANK', 'YOU', 'BBPS',
  'IN',
]);

/** Trailing locations on card/POS descriptors ("SWIGGY BANGALORE", "IRCTC WEB NEW DELHI IN"). */
// prettier-ignore
const TRAILING_PLACES = [
  'NEW DELHI', 'NAVI MUMBAI', 'MUMBAI', 'BANGALORE', 'BENGALURU', 'BANGLORE', 'GURGAON', 'GURUGRAM',
  'DELHI', 'NOIDA', 'PUNE', 'CHENNAI', 'HYDERABAD', 'KOLKATA', 'AHMEDABAD', 'THANE', 'JAIPUR',
  'LUCKNOW', 'CHANDIGARH', 'KOCHI', 'INDORE', 'NAGPUR', 'SURAT', 'VADODARA', 'GOA', 'MUM', 'BLR',
  'DEL', 'IN', 'IND', 'INDIA',
];
const SINGLE_PLACES = new Set(TRAILING_PLACES.filter((p) => !p.includes(' ')));
const PLACE_PAIRS = new Set(TRAILING_PLACES.filter((p) => p.includes(' ')));

/** Payment-gateway VPAs shared by many merchants; key by name instead. */
// prettier-ignore
const GATEWAY_VPA_LOCALS = new Set([
  'razorpay', 'payu', 'billdesk', 'cashfree', 'ccavenue', 'paytm', 'phonepe', 'gpay', 'bharatpe',
  'juspay', 'instamojo', 'easebuzz', 'paypal',
]);

const isRefWord = (w: string) => {
  let digits = 0;
  for (let i = 0; i < w.length; i++) {
    const c = w.charCodeAt(i);
    if (c >= 48 && c <= 57) digits++;
  }
  return digits === w.length || (digits >= 5 && w.length >= 6);
};
const isMasked = (w: string) => w.includes('XX') && /\d/.test(w);
const PUNCT = new Set(['.', ',', ';', '(', ')', '#', "'", '"']);
const isIfsc = (w: string) =>
  w.length === 11 && w.charCodeAt(4) === 48 && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(w);
function trimPunct(w: string): string {
  let a = 0;
  let b = w.length;
  while (a < b && PUNCT.has(w[a] as string)) a++;
  while (b > a && PUNCT.has(w[b - 1] as string)) b--;
  return a === 0 && b === w.length ? w : w.slice(a, b);
}

export function detectChannel(upper: string, accountType?: AccountType): Channel {
  for (const [channel, re] of CHANNEL_PATTERNS) if (re.test(upper)) return channel;
  return accountType === 'credit_card' ? 'card' : 'other';
}

/** Words of a segment with refs, masked numbers, IFSCs and rail markers removed. */
function cleanSegment(segment: string): string[] {
  const out: string[] = [];
  for (const raw of segment.split(' ')) {
    const w = trimPunct(raw);
    if (!w || MARKER_WORDS.has(w) || isRefWord(w) || isMasked(w) || isIfsc(w)) continue;
    out.push(w);
  }
  return out;
}

function stripTrailing(words: string[]): string[] {
  let end = words.length;
  while (end > 1) {
    if (end > 2 && PLACE_PAIRS.has(`${words[end - 2]} ${words[end - 1]}`)) end -= 2;
    else if (SINGLE_PLACES.has(words[end - 1] as string)) end -= 1;
    else break;
  }
  return end === words.length ? words : words.slice(0, end);
}

/** Drop trailing noise ("PVT LTD", truncated "LI" of LIMITED) for display; keeps ≥1 word. */
function trimNoise(words: string[]): string[] {
  const w = [...words];
  while (w.length > 1) {
    const last = w[w.length - 1] as string;
    const truncatedNoise =
      last.length <= 3 && ['LIMITED', 'PRIVATE', 'PVT', 'LTD'].some((n) => n.startsWith(last));
    if (NAME_NOISE.has(last) || truncatedNoise) w.pop();
    else break;
  }
  while (w.length > 1 && w[0] === 'THE') w.shift();
  return w;
}

const titleCase = (words: string[]) =>
  words.map((w) => (w.length <= 1 ? w : w[0] + w.slice(1).toLowerCase())).join(' ');

const meaningful = (words: string[]) => words.some((w) => /[A-Z]/.test(w) && !NAME_NOISE.has(w));

export function normalizeNarration(
  narration: string | null | undefined,
  accountType?: AccountType,
): NormalizedNarration {
  const text = (narration ?? '').replace(/\s+/g, ' ').trim();
  const upper = text.toUpperCase();
  const channel = detectChannel(upper, accountType);

  const vpaMatch = text.includes('@') ? VPA_RE.exec(text) : null;
  const vpa = vpaMatch ? vpaMatch[0].toLowerCase() : null;
  const ifsc = IFSC_RE.exec(upper)?.[1] ?? null;
  const refNo = RRN_RE.exec(upper)?.[1] ?? UTR_RE.exec(upper)?.[1] ?? null;

  // Segment, remembering which side of the VPA each segment sits on.
  let working = upper.includes('(') ? upper.replace(/\([^)]*\)/g, ' ') : upper;
  if (vpaMatch) working = working.replace(vpaMatch[0].toUpperCase(), '/\u0001/');
  const segments: { words: string[]; afterVpa: boolean; raw: string }[] = [];
  let afterVpa = false;
  let bankCode: string | null = null;
  for (const rawSeg of working.split(/[/*|:,-]/)) {
    const seg = rawSeg.trim();
    if (!seg) continue;
    if (seg === '\u0001') {
      afterVpa = true;
      continue;
    }
    if (MARKER_SEGMENTS.has(seg)) continue;
    const words = cleanSegment(seg);
    if (words.length === 0) continue;
    const joined = words.join(' ');
    if (MARKER_SEGMENTS.has(joined)) continue;
    // A bare bank code right after a name is the payee's bank, not a name.
    if (segments.length > 0 && words.length === 1 && BANK_CODES.has(joined)) {
      bankCode ??= joined.slice(0, 4);
      continue;
    }
    segments.push({ words, afterVpa, raw: joined });
  }

  let payeeWords: string[] | null = null;
  let remark: string | null = null;
  if (!NO_COUNTERPARTY.has(channel)) {
    const named = segments.filter((s) => meaningful(s.words));
    const pick = named.find((s) => !s.afterVpa) ?? named[0];
    if (pick) {
      const words = trimNoise(stripTrailing(pick.words));
      payeeWords = meaningful(words) ? words : null;
      remark = named.find((s) => s !== pick && s.afterVpa === pick.afterVpa)?.raw ?? null;
      if (vpa && !pick.afterVpa) remark = named.find((s) => s.afterVpa)?.raw ?? remark;
    }
  }

  const payee = payeeWords ? titleCase(payeeWords).slice(0, MAX_NAME) : null;
  const vpaLocal = vpa?.split('@')[0] ?? '';
  const useVpa = vpa !== null && !GATEWAY_VPA_LOCALS.has(vpaLocal) && !NO_COUNTERPARTY.has(channel);
  let key: string | null = null;
  if (useVpa) key = vpa;
  else if (payee) {
    const k = counterpartyKey(payee);
    key = /[a-z]/.test(k) ? k : null;
  }

  return {
    channel,
    vpa,
    ifscPrefix: ifsc ?? bankCode,
    refNo,
    payee: payee ?? (useVpa ? vpa : null),
    remark: remark ? remark.slice(0, MAX_NAME) : null,
    counterpartyKey: key,
  };
}

/** Lower-case alphanumeric words used for keyword matching ("swiggy.instamart@ybl" -> swiggy instamart ybl). */
export function keywordWords(...parts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    for (const w of p.toLowerCase().split(/[^a-z0-9]+/)) if (w) out.push(w);
  }
  return out;
}
