/**
 * MurmurHash3 x86_128 (Austin Appleby, public domain), over UTF-8 bytes, as 32 hex chars.
 * Used for dedup fingerprints: fast and synchronous (no per-call WebCrypto overhead, which matters
 * inside the Workers Free-plan CPU budget). Not a security primitive.
 */
const imul = Math.imul;
const rotl = (x: number, r: number) => (x << r) | (x >>> (32 - r));

function fmix(h: number): number {
  h ^= h >>> 16;
  h = imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const encoder = new TextEncoder();
let buffer = new Uint8Array(1024); // reused across calls; grown on demand

function utf8(input: string): Uint8Array {
  if (input.length * 3 > buffer.length) buffer = new Uint8Array(input.length * 3);
  const { written } = encoder.encodeInto(input, buffer);
  return buffer.subarray(0, written);
}

export function murmur128Hex(input: string, seed = 0): string {
  const data = utf8(input);
  const len = data.length;
  const blocks = len >>> 4;
  let h1 = seed >>> 0;
  let h2 = seed >>> 0;
  let h3 = seed >>> 0;
  let h4 = seed >>> 0;
  const c1 = 0x239b961b;
  const c2 = 0xab0e9789;
  const c3 = 0x38b34ae5;
  const c4 = 0xa1e38b93;
  const byte = (i: number) => data[i] ?? 0;
  const word = (i: number) =>
    byte(i) | (byte(i + 1) << 8) | (byte(i + 2) << 16) | (byte(i + 3) << 24);

  for (let b = 0; b < blocks; b++) {
    const i = b * 16;
    let k1 = word(i);
    let k2 = word(i + 4);
    let k3 = word(i + 8);
    let k4 = word(i + 12);
    k1 = imul(rotl(imul(k1, c1), 15), c2);
    h1 ^= k1;
    h1 = rotl(h1, 19) + h2;
    h1 = (imul(h1, 5) + 0x561ccd1b) | 0;
    k2 = imul(rotl(imul(k2, c2), 16), c3);
    h2 ^= k2;
    h2 = rotl(h2, 17) + h3;
    h2 = (imul(h2, 5) + 0x0bcaa747) | 0;
    k3 = imul(rotl(imul(k3, c3), 17), c4);
    h3 ^= k3;
    h3 = rotl(h3, 15) + h4;
    h3 = (imul(h3, 5) + 0x96cd1c35) | 0;
    k4 = imul(rotl(imul(k4, c4), 18), c1);
    h4 ^= k4;
    h4 = rotl(h4, 13) + h1;
    h4 = (imul(h4, 5) + 0x32ac3b17) | 0;
  }

  // Tail: up to 15 remaining bytes, little-endian into k1..k4 (equivalent to the reference
  // implementation's fall-through switch, written without fall-through).
  const tail = blocks * 16;
  const rem = len & 15;
  const tailWord = (from: number, count: number) => {
    let k = 0;
    for (let j = count - 1; j >= 0; j--) k = (k << 8) | byte(tail + from + j);
    return k;
  };
  if (rem > 12) {
    const k4 = imul(rotl(imul(tailWord(12, rem - 12), c4), 18), c1);
    h4 ^= k4;
  }
  if (rem > 8) {
    const k3 = imul(rotl(imul(tailWord(8, Math.min(rem - 8, 4)), c3), 17), c4);
    h3 ^= k3;
  }
  if (rem > 4) {
    const k2 = imul(rotl(imul(tailWord(4, Math.min(rem - 4, 4)), c2), 16), c3);
    h2 ^= k2;
  }
  if (rem > 0) {
    const k1 = imul(rotl(imul(tailWord(0, Math.min(rem, 4)), c1), 15), c2);
    h1 ^= k1;
  }

  h1 ^= len;
  h2 ^= len;
  h3 ^= len;
  h4 ^= len;
  h1 = (h1 + h2 + h3 + h4) | 0;
  h2 = (h2 + h1) | 0;
  h3 = (h3 + h1) | 0;
  h4 = (h4 + h1) | 0;
  h1 = fmix(h1);
  h2 = fmix(h2);
  h3 = fmix(h3);
  h4 = fmix(h4);
  h1 = (h1 + h2 + h3 + h4) | 0;
  h2 = (h2 + h1) | 0;
  h3 = (h3 + h1) | 0;
  h4 = (h4 + h1) | 0;
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}
