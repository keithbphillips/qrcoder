(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BookmarkStripCode=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const COLS=140,ROWS=500,VERSION=3;
  const PARITY_POS=new Set([1,2,4,8,16,32,64]);

  function crc32(bytes){
    let c=0xffffffff;
    for(const v of bytes){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}
    return(c^0xffffffff)>>>0;
  }
  function put32(b,o,n){b[o]=(n>>>24)&255;b[o+1]=(n>>>16)&255;b[o+2]=(n>>>8)&255;b[o+3]=n&255;}
  function get32(b,o){return((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0;}

  const MARKER=13,MARKER_CENTER=6;
  function markerCell(lx,ly,orientation){
    const d=Math.min(lx,ly,MARKER-1-lx,MARKER-1-ly);
    if(lx===MARKER_CENTER&&ly===MARKER_CENTER)return orientation?0:1;
    return(d&1)?0:1;
  }
  function structural(x,y){
    const corners=[[0,0,0],[COLS-MARKER,0,0],[0,ROWS-MARKER,0],[COLS-MARKER,ROWS-MARKER,1]];
    for(const [cx,cy,o] of corners){
      if(x>=cx&&x<cx+MARKER&&y>=cy&&y<cy+MARKER)return markerCell(x-cx,y-cy,o);
    }
    if(x===0||x===COLS-1)return(y&1)?0:1;
    if(y===0||y===ROWS-1)return(x&1)?0:1;
    return null;
  }
  const DATA_CELLS=[];
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(structural(x,y)===null)DATA_CELLS.push(y*COLS+x);
  const BLOCKS=Math.floor(DATA_CELLS.length/71);
  const PACKET_BYTES=BLOCKS*8;
  const HEADER_BYTES=10;
  let MAX_PAYLOAD;   // set once the RS geometry below is known

  function hammingEncodeBlock(bytes,offset=0){
    const w=new Uint8Array(72);let bit=0;
    for(let pos=1;pos<=71;pos++)if(!PARITY_POS.has(pos)){
      w[pos]=(bytes[offset+(bit>>>3)]>>>(7-(bit&7)))&1;bit++;
    }
    for(const p of PARITY_POS){
      let parity=0;
      for(let pos=1;pos<=71;pos++)if(pos!==p&&(pos&p))parity^=w[pos];
      w[p]=parity;
    }
    return w.slice(1);
  }
  function hammingDecodeBlock(bits,offset=0){
    const w=new Uint8Array(72);
    for(let i=1;i<=71;i++)w[i]=bits[offset+i-1]&1;
    let syndrome=0;
    for(const p of PARITY_POS){
      let parity=0;for(let pos=1;pos<=71;pos++)if(pos&p)parity^=w[pos];
      if(parity)syndrome|=p;
    }
    if(syndrome>=1&&syndrome<=71)w[syndrome]^=1;
    const bytes=new Uint8Array(8);let bit=0;
    for(let pos=1;pos<=71;pos++)if(!PARITY_POS.has(pos)){
      bytes[bit>>>3]|=w[pos]<<(7-(bit&7));bit++;
    }
    return{bytes,corrected:syndrome>=1&&syndrome<=71,syndrome};
  }
  function permutation(n){
    // 7919 is coprime to the current bit count, producing a reversible spatial interleave.
    const out=new Uint32Array(n);for(let i=0;i<n;i++)out[i]=(i*7919)%n;return out;
  }
  const BIT_COUNT=BLOCKS*71,PERM=permutation(BIT_COUNT);

  /* ---------------- outer Reed-Solomon over GF(256) ----------------
     Hamming alone corrects one bit per 71-bit block. Two bit errors in a
     block make it *mis*-correct, and the single payload CRC then rejects
     everything: measured, 0.5% of cells flipped destroyed the whole payload.
     An outer RS layer turns those mis-corrected blocks into ordinary byte
     errors it can repair. Bytes are interleaved across codewords so the eight
     bytes of one bad Hamming block land in eight different codewords. */
  const EXP=new Uint8Array(512),LOG=new Uint8Array(256);
  (()=>{let x=1;for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d;}for(let i=255;i<512;i++)EXP[i]=EXP[i-255];})();
  const gmul=(a,b)=>(a===0||b===0)?0:EXP[LOG[a]+LOG[b]];
  const ginv=a=>EXP[255-LOG[a]];
  const gdiv=(a,b)=>a===0?0:EXP[(LOG[a]+255-LOG[b])%255];
  const apow=p=>EXP[((p%255)+255)%255];
  function polyMul(p,q){const r=new Uint8Array(p.length+q.length-1);
    for(let i=0;i<p.length;i++)for(let j=0;j<q.length;j++)r[i+j]^=gmul(p[i],q[j]);return r;}
  const GC={};
  function rsGen(n){if(GC[n])return GC[n];let g=Uint8Array.from([1]);
    for(let i=0;i<n;i++)g=polyMul(g,Uint8Array.from([1,EXP[i]]));return GC[n]=g;}
  function rsEncode(m,n){const g=rsGen(n),o=new Uint8Array(m.length+n);o.set(m);
    for(let i=0;i<m.length;i++){const c=o[i];if(c)for(let j=1;j<g.length;j++)o[i+j]^=gmul(g[j],c);}
    o.set(m);return o;}
  function synd(m,n){const s=new Uint8Array(n);
    for(let i=0;i<n;i++){let v=0;for(let j=0;j<m.length;j++)v=gmul(v,EXP[i])^m[j];s[i]=v;}return s;}
  function bmAlg(s,n){let C=[1],B=[1],L=0,m=1,b=1;
    for(let k=0;k<n;k++){let d=s[k];for(let i=1;i<=L;i++)d^=gmul(C[i]||0,s[k-i]);
      if(d===0){m++;continue;}
      const cf=gmul(d,ginv(b)),T=C.slice();
      while(C.length<B.length+m)C.push(0);
      for(let i=0;i<B.length;i++)C[i+m]^=gmul(cf,B[i]);
      if(2*L<=k){L=k+1-L;B=T;b=d;m=1;}else m++;}
    return C;}
  function chien(sg,N){const p=[];for(let j=0;j<N;j++){const xi=apow(-(N-1-j));let v=0,t=1;
    for(let k=0;k<sg.length;k++){v^=gmul(sg[k],t);t=gmul(t,xi);}if(v===0)p.push(j);}return p;}
  function forney(s,sg,pos,msg){const N=msg.length,n=s.length,om=new Uint8Array(n);
    for(let i=0;i<n;i++)for(let k=0;k<sg.length;k++)if(i+k<n)om[i+k]^=gmul(s[i],sg[k]);
    const d=[];for(let k=1;k<sg.length;k+=2)d[k-1]=sg[k];
    for(const j of pos){const p=N-1-j,X=apow(p),xi=apow(-p);
      let nu=0,t=1;for(let k=0;k<n;k++){nu^=gmul(om[k],t);t=gmul(t,xi);}
      let de=0;t=1;for(let k=0;k<d.length;k++){if(d[k])de^=gmul(d[k],t);t=gmul(t,xi);}
      if(de===0)return false;msg[j]^=gmul(X,gdiv(nu,de));}
    return true;}
  function rsDecode(msg,n){const o=Uint8Array.from(msg);let s=synd(o,n);
    if(s.every(v=>v===0))return{ok:true,data:o,fixed:0};
    const sg=bmAlg(s,n),deg=sg.length-1,pos=chien(sg,o.length);
    if(!pos.length||pos.length!==deg)return{ok:false};
    if(!forney(s,sg,pos,o))return{ok:false};
    if(!synd(o,n).every(v=>v===0))return{ok:false};
    return{ok:true,data:o,fixed:pos.length};}

  const RS_NSYM=64, RS_N=255, RS_K=RS_N-RS_NSYM;
  const RS_WORDS=Math.floor((PACKET_BYTES-HEADER_BYTES)/RS_N);
  const RS_BODY=RS_WORDS*RS_N;

  MAX_PAYLOAD=RS_WORDS*RS_K;

  function rsProtect(payload){
    const flat=new Uint8Array(RS_WORDS*RS_K);
    flat.set(payload);
    let seed=crc32(payload)||1;                       // deterministic padding
    for(let i=payload.length;i<flat.length;i++){
      seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;flat[i]=seed&255;
    }
    const out=new Uint8Array(RS_BODY);
    for(let c=0;c<RS_WORDS;c++){
      const cw=rsEncode(flat.slice(c*RS_K,(c+1)*RS_K),RS_NSYM);
      for(let j=0;j<RS_N;j++) out[j*RS_WORDS+c]=cw[j];
    }
    return out;
  }
  function rsRecover(body){
    const flat=new Uint8Array(RS_WORDS*RS_K);
    let corrected=0, lost=0;
    for(let c=0;c<RS_WORDS;c++){
      const cw=new Uint8Array(RS_N);
      for(let j=0;j<RS_N;j++) cw[j]=body[j*RS_WORDS+c];
      const r=rsDecode(cw,RS_NSYM);
      if(!r.ok){lost++;continue;}
      corrected+=r.fixed;
      flat.set(r.data.slice(0,RS_K),c*RS_K);
    }
    return{data:flat,corrected,lost};
  }


  function encode(payload){
    payload=payload instanceof Uint8Array?payload:new Uint8Array(payload);
    if(payload.length>MAX_PAYLOAD)throw new Error(`Payload ${payload.length} B exceeds ${MAX_PAYLOAD} B strip capacity`);
    const packet=new Uint8Array(PACKET_BYTES);
    packet[0]=0x42;packet[1]=0x53;packet[2]=VERSION;packet[3]=0;
    packet[4]=(payload.length>>>8)&255;packet[5]=payload.length&255;
    put32(packet,6,crc32(payload));
    packet.set(rsProtect(payload),HEADER_BYTES);
    // any bytes past the RS body are deterministic filler, never read back
    let seed=crc32(payload)||0x5bd1e995;
    for(let i=HEADER_BYTES+RS_BODY;i<packet.length;i++){
      seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;packet[i]=seed&255;
    }
    const raw=new Uint8Array(BIT_COUNT);
    for(let i=0;i<BLOCKS;i++)raw.set(hammingEncodeBlock(packet,i*8),i*71);
    const cells=new Uint8Array(COLS*ROWS);
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      const s=structural(x,y);if(s!==null)cells[y*COLS+x]=s;
    }
    for(let i=0;i<BIT_COUNT;i++)cells[DATA_CELLS[PERM[i]]]=raw[i];
    return{cols:COLS,rows:ROWS,cells,payloadBytes:payload.length,capacityBytes:MAX_PAYLOAD};
  }
  function decodeCells(cells){
    if(!cells||cells.length!==COLS*ROWS)throw new Error('Wrong strip grid dimensions');
    const raw=new Uint8Array(BIT_COUNT);
    for(let i=0;i<BIT_COUNT;i++)raw[i]=cells[DATA_CELLS[PERM[i]]]&1;
    const packet=new Uint8Array(PACKET_BYTES);let corrected=0;
    for(let i=0;i<BLOCKS;i++){
      const d=hammingDecodeBlock(raw,i*71);packet.set(d.bytes,i*8);if(d.corrected)corrected++;
    }
    if(packet[0]!==0x42||packet[1]!==0x53)throw new Error('Strip header not found');
    if(packet[2]!==VERSION)throw new Error(`Unsupported strip version ${packet[2]}`);
    const len=(packet[4]<<8)|packet[5];if(len>MAX_PAYLOAD)throw new Error('Invalid strip payload length');
    const rec=rsRecover(packet.slice(HEADER_BYTES,HEADER_BYTES+RS_BODY));
    const payload=rec.data.slice(0,len);
    const expected=get32(packet,6),actual=crc32(payload);
    if(expected!==actual)
      throw new Error(`Strip checksum failed (RS repaired ${rec.corrected} bytes, ${rec.lost} codewords unrecoverable)`);
    return{payload,correctedBytes:corrected,rsCorrected:rec.corrected,
           rsLost:rec.lost,version:packet[2]};
  }
  function renderToCanvas(canvas,encoded,modulePixels=6){
    const q=2,w=(COLS+q*2)*modulePixels,h=(ROWS+q*2)*modulePixels;
    canvas.width=w;canvas.height=h;const g=canvas.getContext('2d');
    g.fillStyle='#fff';g.fillRect(0,0,w,h);g.fillStyle='#000';
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(encoded.cells[y*COLS+x])
      g.fillRect((x+q)*modulePixels,(y+q)*modulePixels,modulePixels,modulePixels);
    return canvas;
  }
  function sampleImageData(imageData){
    const {data,width,height}=imageData,q=2;
    const cells=new Uint8Array(COLS*ROWS);
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      const px=Math.max(0,Math.min(width-1,Math.round((x+q+.5)/(COLS+q*2)*width)));
      const py=Math.max(0,Math.min(height-1,Math.round((y+q+.5)/(ROWS+q*2)*height)));
      const p=(py*width+px)*4;
      cells[y*COLS+x]=(data[p]*.299+data[p+1]*.587+data[p+2]*.114)<128?1:0;
    }
    return decodeCells(cells);
  }

  function luminanceAt(imageData,x,y){
    const {data,width,height}=imageData;
    x=Math.max(0,Math.min(width-1,x));y=Math.max(0,Math.min(height-1,y));
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1);
    const fx=x-x0,fy=y-y0;
    const lum=(xx,yy)=>{const p=(yy*width+xx)*4;return data[p]*.299+data[p+1]*.587+data[p+2]*.114;};
    return lum(x0,y0)*(1-fx)*(1-fy)+lum(x1,y0)*fx*(1-fy)+lum(x0,y1)*(1-fx)*fy+lum(x1,y1)*fx*fy;
  }
  function expectedMarker(orientation){
    const a=[];for(let y=0;y<MARKER;y++)for(let x=0;x<MARKER;x++)a.push(markerCell(x,y,orientation));return a;
  }
  function markerScore(imageData,cx,cy,moduleSize,orientation){
    const samples=[],expected=expectedMarker(orientation);
    for(let y=0;y<MARKER;y++)for(let x=0;x<MARKER;x++)
      samples.push(luminanceAt(imageData,cx+(x-MARKER_CENTER)*moduleSize,cy+(y-MARKER_CENTER)*moduleSize));
    let lo=255,hi=0;for(const v of samples){if(v<lo)lo=v;if(v>hi)hi=v;}
    if(hi-lo<55)return 1e9;
    let errors=0;
    for(let i=0;i<samples.length;i++){
      const white=(samples[i]-lo)/(hi-lo);
      errors+=expected[i]?white:1-white;
    }
    return errors/(MARKER*MARKER);
  }
  function locateMarker(imageData,expectedX,expectedY,moduleGuess,orientation){
    let best={score:1e9,x:expectedX,y:expectedY,moduleSize:moduleGuess};
    const radiusX=moduleGuess*7,radiusY=moduleGuess*11,step=Math.max(1,moduleGuess*.65);
    for(const scale of [.72,.84,.94,1,1.08,1.18,1.3]){
      const m=moduleGuess*scale;
      for(let y=expectedY-radiusY;y<=expectedY+radiusY;y+=step)for(let x=expectedX-radiusX;x<=expectedX+radiusX;x+=step){
        const score=markerScore(imageData,x,y,m,orientation)+
          (Math.hypot(x-expectedX,y-expectedY)+Math.abs(m-moduleGuess))*1e-5;
        if(score<best.score)best={score,x,y,moduleSize:m};
      }
    }
    const coarse=best,fine=Math.max(.35,moduleGuess*.14);
    for(let m=Math.max(.5,coarse.moduleSize-moduleGuess*.18);m<=coarse.moduleSize+moduleGuess*.18;m+=fine)
      for(let y=coarse.y-step;y<=coarse.y+step;y+=fine)for(let x=coarse.x-step;x<=coarse.x+step;x+=fine){
        const score=markerScore(imageData,x,y,m,orientation)+
          (Math.hypot(x-expectedX,y-expectedY)+Math.abs(m-moduleGuess))*1e-5;
        if(score<best.score)best={score,x,y,moduleSize:m};
      }
    return best;
  }
  function solveLinear(a,b){
    const n=b.length,m=a.map((row,i)=>Float64Array.from([...row,b[i]]));
    for(let c=0;c<n;c++){
      let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[pivot][c]))pivot=r;
      if(Math.abs(m[pivot][c])<1e-9)throw new Error('Degenerate strip perspective');
      [m[c],m[pivot]]=[m[pivot],m[c]];
      const d=m[c][c];for(let j=c;j<=n;j++)m[c][j]/=d;
      for(let r=0;r<n;r++)if(r!==c){const f=m[r][c];for(let j=c;j<=n;j++)m[r][j]-=f*m[c][j];}
    }
    return Float64Array.from(m.map(row=>row[n]));
  }
  function homography(src,dst){
    const a=[],b=[];
    for(let i=0;i<4;i++){
      const x=src[i].x,y=src[i].y,u=dst[i].x,v=dst[i].y;
      a.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);
      a.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);
    }
    return solveLinear(a,b);
  }
  function project(h,x,y){const d=h[6]*x+h[7]*y+1;return{x:(h[0]*x+h[1]*y+h[2])/d,y:(h[3]*x+h[4]*y+h[5])/d};}
  function otsu(values){
    const hist=new Uint32Array(256);for(const v of values)hist[Math.max(0,Math.min(255,Math.round(v)))]++;
    const total=values.length;let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
    let bg=0,sumBg=0,best=0,threshold=127;
    for(let i=0;i<256;i++){
      bg+=hist[i];if(!bg)continue;const fg=total-bg;if(!fg)break;
      sumBg+=i*hist[i];const meanBg=sumBg/bg,meanFg=(sum-sumBg)/fg;
      const between=bg*fg*(meanBg-meanFg)*(meanBg-meanFg);
      if(between>best){best=between;threshold=i;}
    }
    return threshold;
  }
  function decodeImageData(imageData){
    const q=2,totalCols=COLS+q*2,totalRows=ROWS+q*2;
    const mx=imageData.width/totalCols,my=imageData.height/totalRows,moduleGuess=(mx+my)/2;
    const mc=MARKER_CENTER+.5;
    const logical=[{x:q+mc,y:q+mc},{x:q+COLS-mc,y:q+mc},
      {x:q+mc,y:q+ROWS-mc},{x:q+COLS-mc,y:q+ROWS-mc}];
    const approximate=logical.map(p=>({x:p.x/totalCols*imageData.width,y:p.y/totalRows*imageData.height}));
    const found=approximate.map((p,i)=>locateMarker(imageData,p.x,p.y,moduleGuess,i===3));
    if(found.some(f=>f.score>.28))throw new Error('Could not locate all four strip fiducials');
    const h=homography(logical,found);
    const levels=new Float64Array(COLS*ROWS);
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      const p=project(h,q+x+.5,q+y+.5);levels[y*COLS+x]=luminanceAt(imageData,p.x,p.y);
    }
    const threshold=otsu(levels),cells=new Uint8Array(COLS*ROWS);
    for(let i=0;i<cells.length;i++)cells[i]=levels[i]<=threshold?1:0;
    let decoded;
    try{decoded=decodeCells(cells);}
    catch(e){e.message+=` · fiducials ${found.map(f=>`${f.score.toFixed(3)}@${f.x.toFixed(0)},${f.y.toFixed(0)}`).join(' / ')}`;throw e;}
    decoded.fiducials=found;decoded.threshold=threshold;return decoded;
  }

  return{COLS,ROWS,VERSION,MAX_PAYLOAD,RS_NSYM,RS_WORDS,DATA_CELLS:DATA_CELLS.length,crc32,
    encode,decodeCells,renderToCanvas,sampleImageData,decodeImageData,homography,project,
    hammingEncodeBlock,hammingDecodeBlock};
});
