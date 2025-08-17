// workloads.js
// Returns small blocks so the worker can time-slice until targetMs
// Each function returns { iters, ops, bytes?, checksum }

function unrollFloatStep(u, a, b, c, d) {
  // do u cycles; each cycle ~8 FLOPs (mul + add combos)
  for (let i=0; i<u; i++) {
    a = a * 1.000000119 + b;
    b = b * 0.999999941 + c;
    c = c * 1.000000059 + d;
    d = d * 0.999999970 + a;
    a = a + c * 1.000000001;
    b = b + d * 0.999999999;
    c = c + a * 1.000000003;
    d = d + b * 0.999999997;
  }
  return [a,b,c,d];
}

export function runFloat(opts) {
  const u = Math.max(2, opts.unroll|0);
  const block = 20000; // cycles per block
  let a = 1.1, b = 1.2, c = 1.3, d = 1.4;
  const [na, nb, nc, nd] = unrollFloatStep(u, a, b, c, d);
  a=na; b=nb; c=nc; d=nd;
  let ops = 0;
  for (let i=0; i<block; i++) {
    const r = unrollFloatStep(u, a, b, c, d);
    a=r[0]; b=r[1]; c=r[2]; d=r[3];
    ops += u * 16; // each unroll ~16 FLOPs accounted
  }
  const checksum = (a*13 ^ b*17 ^ c*19 ^ d*23) | 0;
  return { iters: block, ops, checksum };
}

export function runInt(opts) {
  const block = 500000; // iterations per block
  let x = 0x1234567 ^ (opts.unroll||4);
  let y = 0x9e3779b9 | 0;
  let sum = 0|0;
  for (let i=0; i<block; i++) {
    // xorshift-ish mix
    x ^= (x << 13);
    x ^= (x >>> 17);
    x ^= (x << 5);
    // extra integer mixes to raise ALU pressure
    x = (x + y) | 0;
    x ^= (x << 7) | (x >>> 25);
    y = (y + 0x6d2b79f5) | 0;
    sum ^= x;
  }
  const ops = block * 12; // approx operations per iter
  const checksum = (sum ^ x ^ y) | 0;
  return { iters: block, ops, checksum };
}

let memBuf = null, fa = null;
function ensureArrayMiB(mib) {
  const bytes = Math.max(8, Math.floor(mib)) * 1024 * 1024;
  const len = (bytes / 8) | 0;
  if (!memBuf || fa.length !== len) {
    memBuf = new ArrayBuffer(len * 8);
    fa = new Float64Array(memBuf);
    for (let i=0; i<fa.length; i+= 1024) fa[i] = i * 1.000001; // sparse init
  }
  return fa;
}

export function runMem(opts) {
  const stride = Math.max(1, opts.stride|0);
  const arr = ensureArrayMiB(opts.arrMB || 48);
  const n = arr.length;
  let sum = 0.0;
  let bytes = 0;
  // one block: walk through array with stride in two passes (read+write) to exercise bandwidth
  for (let i=0; i<n; i+=stride) {
    sum += arr[i];
    arr[i] = sum * 1.0000001;
    bytes += 16; // read + write of Float64
  }
  const checksum = (sum * 2654435761) | 0;
  return { iters: n/stride|0, ops: 0, bytes, checksum };
}
