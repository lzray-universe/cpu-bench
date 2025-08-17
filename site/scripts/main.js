// main.js
import { prettyBytes, gmean, formatNum, resultsToCSV } from './util.js';

const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const etaEl = document.getElementById('eta');
const envArch = document.getElementById('arch');
const envCores = document.getElementById('cores');
const envWasm = document.getElementById('wasm');
const envSimd = document.getElementById('simd');
const envXoi  = document.getElementById('xoi');
const optUnroll = document.getElementById('opt-unroll');
const optStride = document.getElementById('opt-stride');
const optThreads = document.getElementById('opt-threads');

const btnQuick = document.getElementById('btn-quick');
const btnExt = document.getElementById('btn-extended');
const btnCancel = document.getElementById('btn-cancel');
const btnCopy = document.getElementById('btn-copy');
const btnDL = document.getElementById('btn-dl');
const btnCSV = document.getElementById('btn-csv');
const resultsEl = document.getElementById('results');

let abortFlag = false;

function detectEnv() {
  const cores = navigator.hardwareConcurrency || 1;
  envCores.textContent = String(cores);

  const wasmOK = typeof WebAssembly !== 'undefined';
  envWasm.textContent = wasmOK ? '支持' : '不支持';

  // SIMD feature detect (best-effort—some engines lack a simple probe)
  (async () => {
    try {
      // Try to compile a tiny SIMD module (binary prebuilt in util.js)
      const simdOK = await import('./simd-probe.js').then(m => m.checkSIMD());
      envSimd.textContent = simdOK ? '可能支持' : '未知/不支持';
    } catch {
      envSimd.textContent = '未知/不支持';
    }
  })();

  envXoi.textContent = self.crossOriginIsolated ? '是' : '否';

  // UA-CH
  let arch = '未知';
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      const data = await navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'model', 'platform', 'platformVersion']);
      arch = [data.architecture, data.bitness].filter(Boolean).join(' / ') || arch;
    } else {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('arm') || ua.includes('aarch64') || ua.includes('apple m')) arch = 'ARM/Apple Silicon';
      else if (ua.includes('x86_64') || ua.includes('win64') || ua.includes('x86') || ua.includes('amd64') || ua.includes('intel')) arch = 'x86_64/Intel/AMD(推测)';
      else arch = '未知';
    }
  } catch {}
  envArch.textContent = arch;

  // Auto opts
  const isARM = /arm|apple silicon|aarch64/i.test(arch);
  const unroll = isARM ? 8 : 4;
  const stride = isARM ? 2 : 1;
  const threads = Math.min(cores || 1, 32);
  optUnroll.textContent = String(unroll);
  optStride.textContent = String(stride);
  optThreads.textContent = String(threads);
  return { arch, isARM, unroll, stride, threads, cores };
}

function setButtons(running) {
  btnQuick.disabled = running;
  btnExt.disabled = running;
  btnCancel.classList.toggle('hidden', !running);
}

function setProgress(p, etaText) {
  progressEl.style.width = Math.max(0, Math.min(100, p)) + '%';
  if (etaText) etaEl.textContent = 'ETA ' + etaText;
}

function msToHMS(ms) {
  const s = Math.max(0, Math.round(ms/1000));
  const m = Math.floor(s/60);
  const r = s % 60;
  return (m>0 ? `${m}m` : '') + `${r}s`;
}

function makeWorker() {
  const url = new URL('./worker.js', import.meta.url);
  return new Worker(url, { type: 'module' });
}

async function runTestInParallel(testName, threads, targetMs, opts, onProgress) {
  const workers = [];
  let doneWorkers = 0;
  let accum = { iters: 0, ops: 0, bytes: 0, ms: 0, checksum: 0 };

  for (let i=0; i<threads; i++) {
    const w = makeWorker();
    workers.push(w);
    w.onmessage = (e) => {
      if (e.data.type === 'progress') {
        onProgress && onProgress(e.data.doneRatio);
      } else if (e.data.type === 'done') {
        doneWorkers++;
        const r = e.data;
        accum.iters += r.iters;
        accum.ops += r.ops;
        accum.bytes += r.bytes;
        accum.ms = Math.max(accum.ms, r.ms);
        accum.checksum ^= r.checksum;
        if (doneWorkers === threads) {
          workers.forEach(wk => wk.terminate());
          onProgress && onProgress(1);
        }
      }
    };
    w.postMessage({ cmd: 'run', test: testName, targetMs, opts });
  }

  // Wait for all workers
  await new Promise(res => {
    const timer = setInterval(() => {
      if (doneWorkers === threads) {
        clearInterval(timer);
        res();
      }
    }, 50);
  });

  return accum;
}

function renderTable(res) {
  const rows = [
    ['类别', '模式', 'OPS/s', '吞吐(内存)', '时间', '校验'],
  ];

  const pushRow = (label, mode, r) => {
    rows.push([label, mode,
      r.ops ? formatNum(r.ops / (r.ms/1000)) : '—',
      r.bytes ? prettyBytes(r.bytes / (r.ms/1000)) + '/s' : '—',
      msToHMS(r.ms),
      '0x' + (r.checksum>>>0).toString(16)
    ]);
  };

  pushRow('浮点 (MAD)', '单核', res.single.float);
  pushRow('整数 (xorshift)', '单核', res.single.int);
  pushRow('内存 (带步长)', '单核', res.single.mem);
  pushRow('浮点 (MAD)', '多核', res.multi.float);
  pushRow('整数 (xorshift)', '多核', res.multi.int);
  pushRow('内存 (带步长)', '多核', res.multi.mem);

  const scoreText = `综合分：${Math.round(res.score.total)}  · 单核：${Math.round(res.score.single)} · 多核：${Math.round(res.score.multi)}`;

  const html = `
  <div class="text-sm mb-2">${scoreText}</div>
  <table class="min-w-full text-sm text-left border border-slate-200 rounded-xl overflow-hidden">
    <thead class="bg-slate-100">
      <tr>${rows[0].map(h=>`<th class="px-3 py-2 border-b">${h}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${rows.slice(1).map(r=>`<tr class="odd:bg-white even:bg-slate-50">
        ${r.map(c=>`<td class="px-3 py-2 border-b">${c}</td>`).join('')}
      </tr>`).join('')}
    </tbody>
  </table>`;

  resultsEl.innerHTML = html;
}

function computeScore(res) {
  // Compute geometric means of throughput; reference constants to scale around 1000
  const ref = {
    float_ops_s: 5e7,   // reference single-core float ops/s
    int_ops_s:   1e8,   // reference single-core int ops/s
    mem_b_s:     6e8,   // reference single-core bytes/s
    multi_boost: 3.5,   // expected multi-core boost on a 4-8C machine
  };

  const sc = {
    float: (res.single.float.ops / (res.single.float.ms/1000)) / ref.float_ops_s,
    int:   (res.single.int.ops   / (res.single.int.ms/1000))   / ref.int_ops_s,
    mem:   (res.single.mem.bytes / (res.single.mem.ms/1000))   / ref.mem_b_s,
  };
  const scScore = gmean([sc.float, sc.int, sc.mem]) * 1000;

  const mc = {
    float: (res.multi.float.ops / (res.multi.float.ms/1000)) / (ref.float_ops_s*ref.multi_boost),
    int:   (res.multi.int.ops   / (res.multi.int.ms/1000))   / (ref.int_ops_s*ref.multi_boost),
    mem:   (res.multi.mem.bytes / (res.multi.mem.ms/1000))   / (ref.mem_b_s*ref.multi_boost),
  };
  const mcScore = gmean([mc.float, mc.int, mc.mem]) * 1000;

  return {
    single: scScore,
    multi: mcScore,
    total: gmean([scScore, mcScore]),
  };
}

async function run(mode) {
  setButtons(true);
  abortFlag = false;
  resultsEl.innerHTML = '';
  setProgress(0, '');

  const env = await detectEnv();
  const opts = {
    arch: env.arch,
    isARM: env.isARM,
    unroll: env.unroll,
    stride: env.stride,
    arrMB: env.isARM ? 32 : 48, // memory array size per worker (MiB)
  };

  const threads = env.threads || 1;
  const plan = {
    single: 3000, // ms per test
    multi:  6000,
  };
  if (mode === 'extended') {
    plan.single = 5000;
    plan.multi  = 10000;
  }

  const totalSteps = 6;
  let step = 0;
  const startTs = performance.now();

  statusEl.textContent = '单核测试：浮点…';
  const singleFloat = await runTestInParallel('float', 1, plan.single, opts, r => {
    setProgress(((step + r*1/1)/totalSteps)*100, '');
  });
  if (abortFlag) return;
  step++;

  statusEl.textContent = '单核测试：整数…';
  const singleInt = await runTestInParallel('int', 1, plan.single, opts, r => {
    setProgress(((step + r)/totalSteps)*100, '');
  });
  if (abortFlag) return;
  step++;

  statusEl.textContent = '单核测试：内存…';
  const singleMem = await runTestInParallel('mem', 1, plan.single, opts, r => {
    setProgress(((step + r)/totalSteps)*100, '');
  });
  if (abortFlag) return;
  step++;

  statusEl.textContent = `多核测试（${threads} 线程）：浮点…`;
  const multiFloat = await runTestInParallel('float', threads, plan.multi, opts, r => {
    setProgress(((step + r)/totalSteps)*100, '');
    const elapsed = performance.now() - startTs;
    const approxLeft = (totalSteps - (step + r)) * (plan.single + plan.multi)/2; // ballpark
    etaEl.textContent = 'ETA ' + msToHMS(approxLeft);
  });
  if (abortFlag) return;
  step++;

  statusEl.textContent = `多核测试（${threads} 线程）：整数…`;
  const multiInt = await runTestInParallel('int', threads, plan.multi, opts, r => {
    setProgress(((step + r)/totalSteps)*100, '');
  });
  if (abortFlag) return;
  step++;

  statusEl.textContent = `多核测试（${threads} 线程）：内存…`;
  const multiMem = await runTestInParallel('mem', threads, plan.multi, opts, r => {
    setProgress(((step + r)/totalSteps)*100, '');
  });
  if (abortFlag) return;
  step++;

  const res = {
    env: {
      arch: env.arch,
      cores: env.cores,
      userAgent: navigator.userAgent,
    },
    opts,
    single: { float: singleFloat, int: singleInt, mem: singleMem },
    multi:  { float: multiFloat,  int: multiInt,  mem: multiMem },
  };
  res.score = computeScore(res);

  statusEl.textContent = '完成。';
  setProgress(100, '—');
  renderTable(res);

  // Expose for export buttons
  window.__OPENBENCH_RESULT__ = res;
}

btnQuick.addEventListener('click', () => run('quick'));
btnExt.addEventListener('click', () => run('extended'));
btnCancel.addEventListener('click', () => { abortFlag = true; setButtons(false); statusEl.textContent = '已取消。'; });

btnCopy.addEventListener('click', async () => {
  const res = window.__OPENBENCH_RESULT__;
  if (!res) return alert('没有结果可复制');
  await navigator.clipboard.writeText(JSON.stringify(res, null, 2));
  alert('已复制到剪贴板');
});
btnDL.addEventListener('click', () => {
  const res = window.__OPENBENCH_RESULT__;
  if (!res) return alert('没有结果可下载');
  const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'openbench-result.json';
  a.click();
});
btnCSV.addEventListener('click', () => {
  const res = window.__OPENBENCH_RESULT__;
  if (!res) return alert('没有结果可下载');
  const csv = resultsToCSV(res);
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'openbench-result.csv';
  a.click();
});

// Initial labels
statusEl.textContent = '就绪。点击“快速测试（≈30s）”。';
