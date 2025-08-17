// worker.js
import { runFloat, runInt, runMem } from './workloads.js';

self.onmessage = async (e) => {
  const { cmd, test, targetMs, opts } = e.data;
  if (cmd !== 'run') return;

  const t0 = performance.now();
  let iters = 0, ops = 0, bytes = 0, checksum = 0;

  const tick = () => {
    const elapsed = performance.now() - t0;
    self.postMessage({ type: 'progress', doneRatio: Math.min(1, elapsed/targetMs) });
  };

  const stepMs = Math.min(250, targetMs/10);
  let nextTick = performance.now() + stepMs;

  const runBlock = (blockFn) => {
    while (performance.now() - t0 < targetMs) {
      const r = blockFn();
      iters += r.iters;
      ops += r.ops;
      bytes += r.bytes || 0;
      checksum ^= r.checksum >>> 0;
      if (performance.now() >= nextTick) {
        tick();
        nextTick += stepMs;
      }
    }
  };

  if (test === 'float') {
    runBlock(() => runFloat(opts));
  } else if (test === 'int') {
    runBlock(() => runInt(opts));
  } else if (test === 'mem') {
    runBlock(() => runMem(opts));
  }

  const ms = performance.now() - t0;
  self.postMessage({ type: 'done', iters, ops, bytes, checksum, ms });
};
