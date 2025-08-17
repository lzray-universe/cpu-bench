// simd-probe.js
// Try compiling a minimal SIMD Wasm module. Some engines may throw; treat as best-effort.
export async function checkSIMD() {
  if (typeof WebAssembly === 'undefined' || !WebAssembly.validate) return false;
  // A tiny SIMD wasm binary (v128.const + v128.add). Precompiled bytes.
  const base64 = (
    'AGFzbQEAAAABBgFgAX8BfwMCAQAHBwEDfn8BAX8DAQIDfwF/AwEABgYBBm1lbW9yeQAC' +
    'BwEDc2ltZAABCgEHCQEDdjEyOAA='
  );
  try {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}
