// util.js
export function prettyBytes(n) {
  if (!isFinite(n)) return '—';
  const u = ['B','KB','MB','GB','TB']; let i=0;
  while (n>=1024 && i<u.length-1){ n/=1024; i++; }
  return n.toFixed(1)+' '+u[i];
}
export function gmean(arr) {
  const v = arr.filter(x=>x>0);
  if (v.length===0) return 0;
  const s = v.reduce((a,b)=>a+Math.log(b),0)/v.length;
  return Math.exp(s);
}
export function formatNum(n) {
  if (!isFinite(n)) return '—';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'G';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(2)+'K';
  return n.toFixed(0);
}
export function resultsToCSV(res) {
  const lines = [];
  const add = (name, mode, r, tpLabel, tpVal) => {
    lines.push([name, mode,
      r.ops ? (r.ops/(r.ms/1000)) : '',
      tpVal || '',
      r.ms,
      r.checksum >>> 0
    ].join(','));
  };
  lines.push('name,mode,ops_per_s,throughput_per_s(bytes),ms,checksum');
  add('float','single',res.single.float);
  add('int','single',res.single.int);
  add('mem','single',res.single.mem,'bytes',res.single.mem.bytes/(res.single.mem.ms/1000));
  add('float','multi',res.multi.float);
  add('int','multi',res.multi.int);
  add('mem','multi',res.multi.mem,'bytes',res.multi.mem.bytes/(res.multi.mem.ms/1000));
  return lines.join('\n');
}
