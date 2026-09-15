/* Repeatable checks for the strip format. Run: node strip-code.test.js
   Thresholds are the measured limits, not aspirations. */
const S=require('./strip-code.js');
let fail=0; const ok=(c,m)=>{console.log((c?'  ok  ':'  FAIL')+'  '+m); if(!c)fail++;};
console.log(`Bookmark Strip Code v${S.VERSION} — ${S.RS_WORDS} x RS(255,${255-S.RS_NSYM})`);
console.log(`  capacity ${S.MAX_PAYLOAD} B (~${Math.round(S.MAX_PAYLOAD/2.394)} words)\n`);
for(const n of [1,100,1500,S.MAX_PAYLOAD]){
  const p=new Uint8Array(n); for(let i=0;i<n;i++)p[i]=(i*97+13)&255;
  const d=S.decodeCells(S.encode(p).cells);
  ok(d.payload.length===n&&[...p].every((v,i)=>d.payload[i]===v),`round-trip ${n} B byte-exact`);
}
let refused=false; try{S.encode(new Uint8Array(S.MAX_PAYLOAD+1));}catch(e){refused=true;}
ok(refused,'payload over capacity refused');

const p=new Uint8Array(1500); for(let i=0;i<p.length;i++)p[i]=(i*37+11)&255;
const enc=S.encode(p);
function trial(pct,runs){
  let wins=0;
  for(let t=0;t<runs;t++){
    const c=Uint8Array.from(enc.cells);
    let s=99+t*104729; const r=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;};
    for(let i=0;i<Math.round(c.length*pct/100);i++){const k=(r()*c.length)|0;c[k]=c[k]?0:1;}
    try{const d=S.decodeCells(c);
      if(d.payload.length===p.length&&[...p].every((v,i)=>d.payload[i]===v))wins++;}catch(e){}
  }
  return wins;
}
ok(trial(0.25,8)===8,'0.25% of cells flipped -> 8/8');
ok(trial(0.5,8)===8, '0.50% of cells flipped -> 8/8');
ok(trial(1,8)>=6,   `1.00% of cells flipped -> ${trial(1,8)}/8 (working limit)`);
// past ~1.5% recovery becomes unreliable; what must never happen is silent corruption
let silent=0;
for(let t=0;t<10;t++){
  const c=Uint8Array.from(enc.cells);
  let s=7+t*31337; const r=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;};
  for(let i=0;i<Math.round(c.length*0.08);i++){const k=(r()*c.length)|0;c[k]=c[k]?0:1;}
  try{const d=S.decodeCells(c);
    if(!(d.payload.length===p.length&&[...p].every((v,i)=>d.payload[i]===v)))silent++;}catch(e){}
}
ok(silent===0,'8% damage never decodes to silently-wrong data');
console.log(fail?`\n${fail} FAILED`:'\nALL CHECKS PASSED');
process.exit(fail?1:0);
