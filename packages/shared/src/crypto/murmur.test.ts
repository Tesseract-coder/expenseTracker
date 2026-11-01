import { describe, expect, it } from 'vitest';
import { murmur128Hex } from './murmur';

// Reference vectors for MurmurHash3_x86_128 (seed 0) over UTF-8 bytes, cross-checked against the
// independent `murmurhash3js-revisited` implementation. Includes the 15/16/17-byte block boundaries.
describe('murmur128Hex', () => {
  it.each([
    ['', '00000000000000000000000000000000'],
    ['hello', '2b2444a0db91def79adb31b69adb31b6'],
    ['The quick brown fox jumps over the lazy dog', '2f1583c3ecee2c675d7bf66ce5e91d2c'],
    ['₹ UPI', 'b862081141896b25b9f445fbb9f445fb'],
    ['x'.repeat(15), '82fa43b5781c405b548d3393159d871b'],
    ['x'.repeat(16), '704be03d8792ddda072bbec09e77c845'],
    ['x'.repeat(17), 'f6a9086c393fa3d68a824e4676d8cbd9'],
  ])('%j', (input, hex) => expect(murmur128Hex(input)).toBe(hex));

  it('covers every tail length and is sensitive to each byte', () => {
    const seen = new Set<string>();
    for (let n = 0; n <= 33; n++) seen.add(murmur128Hex('x'.repeat(n)));
    expect(seen.size).toBe(34);
    expect(murmur128Hex('a', 1)).not.toBe(murmur128Hex('a'));
  });
});
