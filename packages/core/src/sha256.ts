/**
 * Pure synchronous SHA-256 for runtime-portable fingerprints.
 *
 * `node:crypto`'s `createHash` is unavailable on edge runtimes without
 * compatibility flags, and Web Crypto's `subtle.digest` is asynchronous,
 * which does not fit the synchronous summary paths that need a digest
 * (signal payload summaries, per-project store keys). This implementation
 * follows FIPS 180-4 and produces output identical to
 * `createHash('sha256').update(text).digest('hex')`.
 */

/* oxlint-disable no-bitwise, unicorn/prefer-math-trunc, unicorn/number-literal-case -- SHA-256 is defined over 32-bit words: rotations, xor, and `>>> 0` unsigned wrapping are the specified operations, and `Math.trunc()` is not equivalent to `>>> 0` (it neither wraps to 32 bits nor coerces to unsigned). number-literal-case is disabled because oxfmt normalizes hex digits to lowercase, which the rule rejects — the formatter wins. */

// FIPS 180-4 §4.2.2: first 32 bits of the fractional parts of the cube
// roots of the first 64 primes.
const K = Uint32Array.from([
  0x42_8a_2f_98, 0x71_37_44_91, 0xb5_c0_fb_cf, 0xe9_b5_db_a5, 0x39_56_c2_5b,
  0x59_f1_11_f1, 0x92_3f_82_a4, 0xab_1c_5e_d5, 0xd8_07_aa_98, 0x12_83_5b_01,
  0x24_31_85_be, 0x55_0c_7d_c3, 0x72_be_5d_74, 0x80_de_b1_fe, 0x9b_dc_06_a7,
  0xc1_9b_f1_74, 0xe4_9b_69_c1, 0xef_be_47_86, 0x0f_c1_9d_c6, 0x24_0c_a1_cc,
  0x2d_e9_2c_6f, 0x4a_74_84_aa, 0x5c_b0_a9_dc, 0x76_f9_88_da, 0x98_3e_51_52,
  0xa8_31_c6_6d, 0xb0_03_27_c8, 0xbf_59_7f_c7, 0xc6_e0_0b_f3, 0xd5_a7_91_47,
  0x06_ca_63_51, 0x14_29_29_67, 0x27_b7_0a_85, 0x2e_1b_21_38, 0x4d_2c_6d_fc,
  0x53_38_0d_13, 0x65_0a_73_54, 0x76_6a_0a_bb, 0x81_c2_c9_2e, 0x92_72_2c_85,
  0xa2_bf_e8_a1, 0xa8_1a_66_4b, 0xc2_4b_8b_70, 0xc7_6c_51_a3, 0xd1_92_e8_19,
  0xd6_99_06_24, 0xf4_0e_35_85, 0x10_6a_a0_70, 0x19_a4_c1_16, 0x1e_37_6c_08,
  0x27_48_77_4c, 0x34_b0_bc_b5, 0x39_1c_0c_b3, 0x4e_d8_aa_4a, 0x5b_9c_ca_4f,
  0x68_2e_6f_f3, 0x74_8f_82_ee, 0x78_a5_63_6f, 0x84_c8_78_14, 0x8c_c7_02_08,
  0x90_be_ff_fa, 0xa4_50_6c_eb, 0xbe_f9_a3_f7, 0xc6_71_78_f2,
]);

const rotr = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

/**
 * Total array accessor: every read in the compression loop is provably in
 * range, so the fallback never fires — it only satisfies
 * `noUncheckedIndexedAccess` without an assertion.
 */
const wordAt = (words: Uint32Array, index: number): number => words[index] ?? 0;

const padMessage = (bytes: Uint8Array): Uint8Array => {
  const bitLength = bytes.length * 8;
  // Message + 0x80 marker, padded to 56 mod 64, then a 64-bit big-endian
  // bit length. Message sizes here are far below 2^32 bits, so the high
  // word of the length is derived from the float division.
  const paddedLength = (Math.floor((bytes.length + 8) / 64) + 1) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_00_00_00_00));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  return padded;
};

const fillSchedule = (w: Uint32Array, view: DataView, offset: number): void => {
  for (let i = 0; i < 16; i += 1) {
    w[i] = view.getUint32(offset + i * 4);
  }
  for (let i = 16; i < 64; i += 1) {
    const w15 = wordAt(w, i - 15);
    const w2 = wordAt(w, i - 2);
    const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
    const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
    w[i] = (wordAt(w, i - 16) + s0 + wordAt(w, i - 7) + s1) >>> 0;
  }
};

// oxlint-disable-next-line max-statements -- the FIPS 180-4 compression loop reads more clearly as one block than split across helpers
const digestHex = (padded: Uint8Array): string => {
  // FIPS 180-4 §5.3.3 initial hash value.
  let h0 = 0x6a_09_e6_67;
  let h1 = 0xbb_67_ae_85;
  let h2 = 0x3c_6e_f3_72;
  let h3 = 0xa5_4f_f5_3a;
  let h4 = 0x51_0e_52_7f;
  let h5 = 0x9b_05_68_8c;
  let h6 = 0x1f_83_d9_ab;
  let h7 = 0x5b_e0_cd_19;

  const view = new DataView(padded.buffer);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    fillSchedule(w, view, offset);

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + wordAt(K, i) + wordAt(w, i)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
};

/**
 * SHA-256 of the UTF-8 encoding of `text`, as lowercase hex.
 *
 * Output-identical to `createHash('sha256').update(text).digest('hex')`.
 */
export const sha256Hex = (text: string): string =>
  digestHex(padMessage(new TextEncoder().encode(text)));
