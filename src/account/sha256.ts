// SHA-256 of a file's bytes, as hex. Uses the browser's crypto when it has it; phones opening Fretwise at the
// Wi-Fi address (plain http) don't, so there is a small JS version too.

const hex = (words: ArrayLike<number>) => Array.from(words, (w) => (w >>> 0).toString(16).padStart(8, '0')).join('')

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (subtle) {
    const d = new DataView(await subtle.digest('SHA-256', data))
    const words: number[] = []
    for (let i = 0; i < 32; i += 4) words.push(d.getUint32(i))
    return hex(words)
  }
  return jsSha256(new Uint8Array(data))
}

// prettier-ignore
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** Pure JS SHA-256; yields to the page every few MB so a big recording doesn't freeze it. */
export async function jsSha256(data: Uint8Array): Promise<string> {
  const H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const W = new Int32Array(64)
  const block = (b: Uint8Array, off: number) => {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4
      W[i] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]
    }
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15]
      const y = W[i - 2]
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0
    }
    let a = H[0]
    let b1 = H[1]
    let c = H[2]
    let d = H[3]
    let e = H[4]
    let f = H[5]
    let g = H[6]
    let h = H[7]
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b1) ^ (a & c) ^ (b1 & c)
      const t2 = (S0 + maj) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b1
      b1 = a
      a = (t1 + t2) | 0
    }
    H[0] = (H[0] + a) | 0
    H[1] = (H[1] + b1) | 0
    H[2] = (H[2] + c) | 0
    H[3] = (H[3] + d) | 0
    H[4] = (H[4] + e) | 0
    H[5] = (H[5] + f) | 0
    H[6] = (H[6] + g) | 0
    H[7] = (H[7] + h) | 0
  }

  const n = data.length
  const full = n - (n % 64)
  const SLICE = 4 * 1024 * 1024
  for (let off = 0; off < full; off += 64) {
    block(data, off)
    if (off % SLICE === SLICE - 64) await new Promise((r) => setTimeout(r, 0))
  }
  const rest = n - full
  const tail = new Uint8Array(rest < 56 ? 64 : 128)
  tail.set(data.subarray(full))
  tail[rest] = 0x80
  const view = new DataView(tail.buffer)
  view.setUint32(tail.length - 8, Math.floor(n / 0x20000000))
  view.setUint32(tail.length - 4, (n * 8) >>> 0)
  block(tail, 0)
  if (tail.length === 128) block(tail, 64)
  return hex(H)
}
