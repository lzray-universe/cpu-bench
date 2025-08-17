(function(){
  const $ = (id)=>document.getElementById(id);
  const statusEl = $("status"), progressEl = $("progress"), etaEl = $("eta");
  const envArch = $("arch"), envCores=$("cores"), envWasm=$("wasm"), envSimd=$("simd"), envXoi=$("xoi");
  const optUnroll=$("opt-unroll"), optStride=$("opt-stride"), optThreads=$("opt-threads");
  const btnQuick=$("btn-quick"), btnExt=$("btn-extended"), btnCancel=$("btn-cancel");
  const btnCopy=$("btn-copy"), btnDL=$("btn-dl"), btnCSV=$("btn-csv");
  const resultsEl=$("results"), errEl=$("err"), warnEl=$("warn");

  function showErr(msg){
    try{ console.error(msg); }catch{}
    errEl.style.display = "block";
    errEl.textContent = String(msg);
  }
  function showWarn(msg){
    warnEl.style.display = "block";
    warnEl.textContent = String(msg);
  }
  window.addEventListener("error", (e)=> showErr(e.error?.stack || e.message || e));
  window.addEventListener("unhandledrejection", (e)=> showErr((e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)));

  function prettyBytes(n){ if(!isFinite(n)) return "—"; const u=["B","KB","MB","GB"]; let i=0; while(n>=1024 && i<u.length-1){n/=1024;i++;} return n.toFixed(1)+" "+u[i]; }
  function gmean(arr){ const v=arr.filter(x=>x>0); if(!v.length) return 0; const s=v.reduce((a,b)=>a+Math.log(b),0)/v.length; return Math.exp(s); }
  function formatNum(n){ if(!isFinite(n)) return "—"; if(n>=1e9) return (n/1e9).toFixed(2)+"G"; if(n>=1e6) return (n/1e6).toFixed(2)+"M"; if(n>=1e3) return (n/1e3).toFixed(2)+"K"; return n.toFixed(0); }
  function msToHMS(ms){ const s=Math.max(0,Math.round(ms/1000)); const m=Math.floor(s/60); const r=s%60; return (m>0? m+"m":"")+r+"s"; }
  function resultsToCSV(res){
    const lines=['name,mode,ops_per_s,throughput_per_s(bytes),ms,checksum'];
    const add=(name,mode,r,tp)=>{ lines.push([name,mode, r.ops? (r.ops/(r.ms/1000)):"", tp||"", r.ms, (r.checksum>>>0)].join(",")); };
    add("float","single",res.single.float);
    add("int","single",res.single.int);
    add("mem","single",res.single.mem, res.single.mem.bytes/(res.single.mem.ms/1000));
    add("float","multi",res.multi.float);
    add("int","multi",res.multi.int);
    add("mem","multi",res.multi.mem, res.multi.mem.bytes/(res.multi.mem.ms/1000));
    return lines.join("\n");
  }

  async function getUACh(timeoutMs){
    if(!(navigator.userAgentData && navigator.userAgentData.getHighEntropyValues)) throw new Error("UA-CH unavailable");
    const p = navigator.userAgentData.getHighEntropyValues(['architecture','bitness','model','platform','platformVersion']);
    const t = new Promise((_,rej)=> setTimeout(()=>rej(new Error("UA-CH timeout")), timeoutMs));
    return Promise.race([p,t]);
  }

  async function detectEnv(){
    const cores = navigator.hardwareConcurrency || 1;
    envCores.textContent = String(cores);
    const wasmOK = typeof WebAssembly !== "undefined";
    envWasm.textContent = wasmOK ? "支持":"不支持";
    (async()=>{
      try{
        if(!wasmOK || !WebAssembly.validate){ envSimd.textContent="未知/不支持"; return; }
        const base64="AGFzbQEAAAABBgFgAX8BfwMCAQAHBwEDfn8BAX8DAQIDfwF/AwEABgYBBm1lbW9yeQACBwEDc2ltZAABCgEHCQEDdjEyOAA=";
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        envSimd.textContent = WebAssembly.validate(bytes) ? "可能支持":"未知/不支持";
      }catch{ envSimd.textContent="未知/不支持"; }
    })();
    envXoi.textContent = self.crossOriginIsolated ? "是":"否";

    let arch="未知";
    try{
      const data = await getUACh(1200);
      arch = [data.architecture, data.bitness].filter(Boolean).join(" / ") || "未知";
    }catch{
      try{
        const ua = navigator.userAgent.toLowerCase();
        if(/arm|aarch64|apple m/.test(ua)) arch="ARM/Apple Silicon(推测)";
        else if(/x86_64|win64|x86|amd64|intel/.test(ua)) arch="x86_64/Intel/AMD(推测)";
        else arch="未知";
      }catch{ arch="未知"; }
    }
    envArch.textContent = arch;

    const isARM = /arm|apple silicon|aarch64/i.test(arch);
    const unroll = isARM ? 8 : 4;
    const stride = isARM ? 2 : 1;
    const threads = Math.min(cores||1, 32);
    optUnroll.textContent = String(unroll);
    optStride.textContent = String(stride);
    optThreads.textContent = String(threads);
    return { arch, isARM, unroll, stride, threads, cores };
  }

  let WORKERS_DISABLED = false;
  (function probeWorkers(){
    try{
      const url = URL.createObjectURL(new Blob(["self.onmessage=(e)=>postMessage(1)"], {type:"text/javascript"}));
      const w = new Worker(url);
      let ok = false;
      w.onmessage = ()=>{ ok=true; w.terminate(); URL.revokeObjectURL(url); };
      w.postMessage(0);
      setTimeout(()=>{ if(!ok){ WORKERS_DISABLED = true; showWarn("无法创建 Web Worker（可能 CSP 禁止 blob:），将降级为单线程模式。"); } }, 300);
    }catch(e){
      WORKERS_DISABLED = true;
      showWarn("创建 Web Worker 失败："+ (e.message||e));
    }
  })();

  function runFloatBlock(unroll){
    const u=Math.max(2, unroll|0);
    const block=20000;
    let a=1.1,b=1.2,c=1.3,d=1.4;
    function step(){
      for(let i=0;i<u;i++){
        a=a*1.000000119 + b;
        b=b*0.999999941 + c;
        c=c*1.000000059 + d;
        d=d*0.999999970 + a;
        a=a + c*1.000000001;
        b=b + d*0.999999999;
        c=c + a*1.000000003;
        d=d + b*0.999999997;
      }
    }
    let ops=0;
    for(let i=0;i<block;i++){ step(); ops+=u*16; }
    const checksum = (a*13 ^ b*17 ^ c*19 ^ d*23) | 0;
    return { iters:block, ops, checksum };
  }
  function runIntBlock(unroll){
    const block=500000;
    let x=0x1234567 ^ (unroll||4);
    let y=0x9e3779b9|0;
    let sum=0|0;
    for(let i=0;i<block;i++){
      x ^= (x<<13);
      x ^= (x>>>17);
      x ^= (x<<5);
      x = (x + y)|0;
      x ^= ((x<<7) | (x>>>25));
      y = (y + 0x6d2b79f5)|0;
      sum ^= x;
    }
    const ops=block*12;
    const checksum=(sum ^ x ^ y)|0;
    return { iters:block, ops, checksum };
  }
  let memBuf=null, fa=null;
  function ensureArrayMiB(mib){
    const bytes=Math.max(8,Math.floor(mib))*1024*1024;
    const len=(bytes/8)|0;
    if(!memBuf || fa.length!==len){
      memBuf=new ArrayBuffer(len*8);
      fa=new Float64Array(memBuf);
      for(let i=0;i<fa.length;i+=1024) fa[i]=i*1.000001;
    }
    return fa;
  }
  function runMemBlock(stride, arrMB){
    const arr=ensureArrayMiB(arrMB || 48);
    const n=arr.length;
    let sum=0.0;
    let bytes=0;
    for(let i=0;i<n;i+=Math.max(1,stride|0)){
      sum += arr[i];
      arr[i] = sum*1.0000001;
      bytes += 16;
    }
    const checksum=(sum * 2654435761)|0;
    return { iters:(n/Math.max(1,stride|0))|0, ops:0, bytes, checksum };
  }

  function setButtons(running){
    btnQuick.disabled=running;
    btnExt.disabled=running;
    btnCancel.style.display = running ? "inline-block":"none";
  }
  function setProgress(p, eta){ $("progress").style.width = Math.max(0,Math.min(100,p)) + "%"; if(eta) etaEl.textContent="ETA "+eta; }

  function computeScore(res){
    const ref={ float_ops_s:5e7, int_ops_s:1e8, mem_b_s:6e8, multi_boost:3.5 };
    const sc={
      float:(res.single.float.ops/(res.single.float.ms/1000))/ref.float_ops_s,
      int:  (res.single.int.ops  /(res.single.int.ms/1000))  /ref.int_ops_s,
      mem:  (res.single.mem.bytes/(res.single.mem.ms/1000))  /ref.mem_b_s,
    };
    const scScore = gmean([sc.float, sc.int, sc.mem])*1000;
    const mc={
      float:(res.multi.float.ops/(res.multi.float.ms/1000))/(ref.float_ops_s*ref.multi_boost),
      int:  (res.multi.int.ops  /(res.multi.int.ms/1000))  /(ref.int_ops_s*ref.multi_boost),
      mem:  (res.multi.mem.bytes/(res.multi.mem.ms/1000))  /(ref.mem_b_s*ref.multi_boost),
    };
    const mcScore = gmean([mc.float, mc.int, mc.mem])*1000;
    return { single:scScore, multi:mcScore, total:gmean([scScore, mcScore]) };
  }

  function renderTable(res){
    const rows=[["类别","模式","OPS/s","吞吐(内存)","时间","校验"]];
    const push=(label,mode,r)=>{
      rows.push([label,mode, r.ops?formatNum(r.ops/(r.ms/1000)):"—", r.bytes? prettyBytes(r.bytes/(r.ms/1000))+"/s":"—", msToHMS(r.ms), "0x"+(r.checksum>>>0).toString(16)]);
    };
    push("浮点 (MAD)","单核",res.single.float);
    push("整数 (xorshift)","单核",res.single.int);
    push("内存 (带步长)","单核",res.single.mem);
    push("浮点 (MAD)","多核",res.multi.float);
    push("整数 (xorshift)","多核",res.multi.int);
    push("内存 (带步长)","多核",res.multi.mem);
    const scoreText = "综合分："+Math.round(res.score.total)+" · 单核："+Math.round(res.score.single)+" · 多核："+Math.round(res.score.multi);
    const html = `
      <div class="muted" style="margin-bottom:6px">${scoreText}</div>
      <table>
        <thead><tr>${rows[0].map(h=>'<th>'+h+'</th>').join('')}</tr></thead>
        <tbody>
          ${rows.slice(1).map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')}
        </tbody>
      </table>`;
    resultsEl.innerHTML=html;
  }

  function makeWorkerOrNull(){
    try{
      const code = \`
      let memBuf=null, fa=null;
      function ensureArrayMiB(mib){
        const bytes=Math.max(8,Math.floor(mib))*1024*1024;
        const len=(bytes/8)|0;
        if(!memBuf || fa.length!==len){
          memBuf=new ArrayBuffer(len*8);
          fa=new Float64Array(memBuf);
          for(let i=0;i<fa.length;i+=1024) fa[i]=i*1.000001;
        }
        return fa;
      }
      function runFloat(opts){
        const u=Math.max(2, opts.unroll|0);
        const block=20000;
        let a=1.1,b=1.2,c=1.3,d=1.4;
        function step(){
          for(let i=0;i<u;i++){
            a=a*1.000000119 + b;
            b=b*0.999999941 + c;
            c=c*1.000000059 + d;
            d=d*0.999999970 + a;
            a=a + c*1.000000001;
            b=b + d*0.999999999;
            c=c + a*1.000000003;
            d=d + b*0.999999997;
          }
        }
        let ops=0;
        for(let i=0;i<block;i++){ step(); ops+=u*16; }
        const checksum = (a*13 ^ b*17 ^ c*19 ^ d*23) | 0;
        return { iters:block, ops, checksum };
      }
      function runInt(opts){
        const block=500000;
        let x=0x1234567 ^ (opts.unroll||4);
        let y=0x9e3779b9|0;
        let sum=0|0;
        for(let i=0;i<block;i++){
          x ^= (x<<13);
          x ^= (x>>>17);
          x ^= (x<<5);
          x = (x + y)|0;
          x ^= ((x<<7) | (x>>>25));
          y = (y + 0x6d2b79f5)|0;
          sum ^= x;
        }
        const ops=block*12;
        const checksum=(sum ^ x ^ y)|0;
        return { iters:block, ops, checksum };
      }
      let memBuf2=null, fa2=null;
      function ensureArrayMiB2(mib){
        const bytes=Math.max(8,Math.floor(mib))*1024*1024; const len=(bytes/8)|0;
        if(!memBuf2 || fa2.length!==len){ memBuf2=new ArrayBuffer(len*8); fa2=new Float64Array(memBuf2); for(let i=0;i<fa2.length;i+=1024) fa2[i]=i*1.000001; }
        return fa2;
      }
      function runMem(opts){
        const stride=Math.max(1, opts.stride|0);
        const arr=ensureArrayMiB2(opts.arrMB || 48);
        const n=arr.length;
        let sum=0.0;
        let bytes=0;
        for(let i=0;i<n;i+=stride){
          sum += arr[i];
          arr[i] = sum*1.0000001;
          bytes += 16;
        }
        const checksum=(sum * 2654435761)|0;
        return { iters:(n/stride)|0, ops:0, bytes, checksum };
      }
      self.onmessage = async (e)=>{
        const { cmd, test, targetMs, opts } = e.data;
        if(cmd!=="run") return;
        const t0 = performance.now();
        let iters=0, ops=0, bytes=0, checksum=0;
        const stepMs = Math.min(250, targetMs/10);
        let nextTick = performance.now() + stepMs;
        function tick(){
          const el=performance.now()-t0;
          self.postMessage({ type:"progress", doneRatio: Math.min(1, el/targetMs) });
        }
        const runBlock = (fn)=>{
          while(performance.now()-t0 < targetMs){
            const r=fn();
            iters+=r.iters; ops+=r.ops; bytes+=r.bytes||0; checksum ^= r.checksum>>>0;
            if(performance.now() >= nextTick){ tick(); nextTick += stepMs; }
          }
        };
        if(test==="float") runBlock(()=>runFloat(opts));
        else if(test==="int") runBlock(()=>runInt(opts));
        else if(test==="mem") runBlock(()=>runMem(opts));
        const ms = performance.now()-t0;
        self.postMessage({ type:"done", iters, ops, bytes, checksum, ms });
      };
      \`;
      const blob = new Blob([code], {type:"text/javascript"});
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      return w;
    }catch(e){
      return null;
    }
  }

  async function runTestInParallel(testName, threads, targetMs, opts, onProgress){
    if(WORKERS_DISABLED){
      const t0 = performance.now();
      let iters=0, ops=0, bytes=0, checksum=0;
      const stepMs = Math.min(250, targetMs/10);
      let nextTick = performance.now() + stepMs;
      function doBlock(){
        let r;
        if(testName==="float") r = runFloatBlock(opts.unroll);
        else if(testName==="int") r = runIntBlock(opts.unroll);
        else r = runMemBlock(opts.stride, opts.arrMB||48);
        iters+=r.iters; ops+=r.ops; bytes+=r.bytes||0; checksum ^= r.checksum>>>0;
      }
      while(performance.now()-t0 < targetMs){
        doBlock();
        if(performance.now() >= nextTick){ onProgress && onProgress(Math.min(1, (performance.now()-t0)/targetMs)); nextTick += stepMs; }
        await Promise.resolve();
      }
      const ms = performance.now()-t0;
      onProgress && onProgress(1);
      return { iters, ops, bytes, checksum, ms };
    }
    const workers=[]; let done=0;
    let accum={ iters:0, ops:0, bytes:0, ms:0, checksum:0 };
    for(let i=0;i<threads;i++){
      const w = makeWorkerOrNull();
      if(!w){ WORKERS_DISABLED=true; showWarn("无法创建 Web Worker，将转为单线程模式。"); return runTestInParallel(testName, 1, targetMs, opts, onProgress); }
      workers.push(w);
      w.onmessage = (e)=>{
        if(e.data.type==="progress"){ onProgress && onProgress(e.data.doneRatio); }
        else if(e.data.type==="done"){
          done++;
          const r=e.data;
          accum.iters+=r.iters; accum.ops+=r.ops; accum.bytes+=r.bytes; accum.ms=Math.max(accum.ms, r.ms); accum.checksum ^= r.checksum;
          if(done===threads){ workers.forEach(x=>x.terminate()); onProgress && onProgress(1); }
        }
      };
      try{
        w.postMessage({ cmd:"run", test:testName, targetMs, opts });
      }catch(e){
        WORKERS_DISABLED=true;
        showWarn("postMessage 到 Worker 失败："+(e.message||e)+"；降级为单线程。");
        workers.forEach(x=>{ try{x.terminate()}catch{} });
        return runTestInParallel(testName, 1, targetMs, opts, onProgress);
      }
    }
    await new Promise(res=>{
      const t=setInterval(()=>{ if(done===threads){ clearInterval(t); res(); } }, 50);
    });
    return accum;
  }

  function renderTable(res){
    const rows=[["类别","模式","OPS/s","吞吐(内存)","时间","校验"]];
    const push=(label,mode,r)=>{
      rows.push([label,mode, r.ops?formatNum(r.ops/(r.ms/1000)):"—", r.bytes? prettyBytes(r.bytes/(r.ms/1000))+"/s":"—", msToHMS(r.ms), "0x"+(r.checksum>>>0).toString(16)]);
    };
    push("浮点 (MAD)","单核",res.single.float);
    push("整数 (xorshift)","单核",res.single.int);
    push("内存 (带步长)","单核",res.single.mem);
    push("浮点 (MAD)","多核",res.multi.float);
    push("整数 (xorshift)","多核",res.multi.int);
    push("内存 (带步长)","多核",res.multi.mem);
    const scoreText = "综合分："+Math.round(res.score.total)+" · 单核："+Math.round(res.score.single)+" · 多核："+Math.round(res.score.multi);
    const html = `
      <div class="muted" style="margin-bottom:6px">${scoreText}</div>
      <table>
        <thead><tr>${rows[0].map(h=>'<th>'+h+'</th>').join('')}</tr></thead>
        <tbody>
          ${rows.slice(1).map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')}
        </tbody>
      </table>`;
    resultsEl.innerHTML=html;
  }

  function renderStart(){ statusEl.textContent = "就绪。点击“快速测试（≈30s）”。"; }
  renderStart();

  let abortFlag=false;
  function setButtons(running){
    btnQuick.disabled=running;
    btnExt.disabled=running;
    btnCancel.style.display = running ? "inline-block":"none";
  }
  function setRunning(r){ setButtons(r); if(!r) etaEl.textContent="—"; }
  function setProgress(p, eta){ $("progress").style.width = Math.max(0,Math.min(100,p)) + "%"; if(eta) etaEl.textContent="ETA "+eta; }

  function finalize(res){
    res.score = (function(){
      const ref={ float_ops_s:5e7, int_ops_s:1e8, mem_b_s:6e8, multi_boost:3.5 };
      const sc={
        float:(res.single.float.ops/(res.single.float.ms/1000))/ref.float_ops_s,
        int:  (res.single.int.ops  /(res.single.int.ms/1000))  /ref.int_ops_s,
        mem:  (res.single.mem.bytes/(res.single.mem.ms/1000))  /ref.mem_b_s,
      };
      const scScore = gmean([sc.float, sc.int, sc.mem])*1000;
      const mc={
        float:(res.multi.float.ops/(res.multi.float.ms/1000))/(ref.float_ops_s*ref.multi_boost),
        int:  (res.multi.int.ops  /(res.multi.int.ms/1000))  /(ref.int_ops_s*ref.multi_boost),
        mem:  (res.multi.mem.bytes/(res.multi.mem.ms/1000))  /(ref.mem_b_s*ref.multi_boost),
      };
      const mcScore = gmean([mc.float, mc.int, mc.mem])*1000;
      return { single:scScore, multi:mcScore, total:gmean([scScore, mcScore]) };
    })();
    renderTable(res);
    window.__OPENBENCH_RESULT__ = res;
  }

  async function run(mode){
    setRunning(true); abortFlag=false; resultsEl.innerHTML=""; errEl.style.display="none"; warnEl.style.display="none"; setProgress(0,"");
    let env;
    try{
      env = await detectEnv();
    }catch(e){
      showErr("环境检测失败："+(e.stack||e.message||e));
      env = { arch:"未知", isARM:false, unroll:4, stride:1, threads: navigator.hardwareConcurrency||1, cores:navigator.hardwareConcurrency||1 };
    }
    const opts = { arch:env.arch, isARM:env.isARM, unroll:env.unroll, stride:env.stride, arrMB: env.isARM?32:48 };
    const threads = (WORKERS_DISABLED? 1 : (env.threads || 1));
    if(WORKERS_DISABLED) optThreads.textContent = "1（降级）";
    const plan = { single:3000, multi:6000 };
    if(mode==="extended"){ plan.single=5000; plan.multi=10000; }
    const totalSteps=6; let step=0; const startTs=performance.now();

    statusEl.textContent="单核测试：浮点…";
    const singleFloat=await runTestInParallel("float", 1, plan.single, opts, r=>{ setProgress(((step+r)/totalSteps)*100, ""); });
    if(abortFlag) return; step++;

    statusEl.textContent="单核测试：整数…";
    const singleInt=await runTestInParallel("int", 1, plan.single, opts, r=>{ setProgress(((step+r)/totalSteps)*100, ""); });
    if(abortFlag) return; step++;

    statusEl.textContent="单核测试：内存…";
    const singleMem=await runTestInParallel("mem", 1, plan.single, opts, r=>{ setProgress(((step+r)/totalSteps)*100, ""); });
    if(abortFlag) return; step++;

    statusEl.textContent="多核测试："+threads+" 线程：浮点…";
    const multiFloat=await runTestInParallel("float", threads, plan.multi, opts, r=>{
      setProgress(((step+r)/totalSteps)*100, "");
      const elapsed=performance.now()-startTs;
      const approxLeft = (totalSteps - (step + r)) * (plan.single + plan.multi)/2;
      etaEl.textContent="ETA "+msToHMS(approxLeft);
    });
    if(abortFlag) return; step++;

    statusEl.textContent="多核测试："+threads+" 线程：整数…";
    const multiInt=await runTestInParallel("int", threads, plan.multi, opts, r=>{ setProgress(((step+r)/totalSteps)*100, ""); });
    if(abortFlag) return; step++;

    statusEl.textContent="多核测试："+threads+" 线程：内存…";
    const multiMem=await runTestInParallel("mem", threads, plan.multi, opts, r=>{ setProgress(((step+r)/totalSteps)*100, ""); });
    if(abortFlag) return; step++;

    const res = { env:{ arch:env.arch, cores:env.cores, userAgent:navigator.userAgent, workers_disabled: WORKERS_DISABLED }, opts,
      single:{ float:singleFloat, int:singleInt, mem:singleMem },
      multi:{  float:multiFloat,  int:multiInt,  mem:multiMem } };

    statusEl.textContent="完成。"; setProgress(100,"—"); finalize(res);
    setRunning(false);
  }

  btnQuick.addEventListener("click", ()=>run("quick"));
  btnExt.addEventListener("click", ()=>run("extended"));
  btnCancel.addEventListener("click", ()=>{ abortFlag=true; setButtons(false); statusEl.textContent="已取消。"; });
  btnCopy.addEventListener("click", async ()=>{
    const res=window.__OPENBENCH_RESULT__; if(!res) return alert("没有结果可复制");
    await navigator.clipboard.writeText(JSON.stringify(res, null, 2)); alert("已复制到剪贴板");
  });
  btnDL.addEventListener("click", ()=>{
    const res=window.__OPENBENCH_RESULT__; if(!res) return alert("没有结果可下载");
    const blob=new Blob([JSON.stringify(res,null,2)], {type:"application/json"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="openbench-result.json"; a.click();
  });
  btnCSV.addEventListener("click", ()=>{
    const res=window.__OPENBENCH_RESULT__; if(!res) return alert("没有结果可下载");
    const blob=new Blob([resultsToCSV(res)], {type:"text/csv"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="openbench-result.csv"; a.click();
  });
})();