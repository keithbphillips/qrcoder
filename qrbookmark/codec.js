"use strict";
/* ================= QR Bookmark shared codec =================
   Identical in the author app and the reader app on purpose: the wire format
   (wrap()/parseFragment()) only works if both sides agree on it byte for
   byte, so this file is the single source of truth for that agreement —
   copy it, don't hand-retype it, whenever it changes. Author calls wrap()
   to build panels; reader calls unwrap()/decodeAll() to read them back;
   both call shardify()/reassemble()/deflate()/inflate() for the round trip
   (the author's self-test verifies its own output the same way the reader
   app actually reads a card, which is the point of a self-test). */
const $=id=>document.getElementById(id);

/* ---------- container: magic, format, index, lengths, card id, checksum ---------- */
const MAG=[0x51,0x42];                       // "QB"
const FORMAT_MARKER=0x82, HEADER=16;
function get32(b,o){return ((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0;}
function crc32(bytes){let c=0xffffffff;
  for(const v of bytes){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}
  return(c^0xffffffff)>>>0;
}
/* ---------- panel payload ----------
   Panels used to carry raw deflate output. Valid QR, but the stock phone camera
   only surfaces codes it can interpret, so binary decoded fine and then showed
   the user nothing at all. Every panel is now a plain text URL with the shard
   in base32: the camera shows a tappable link that opens the reader app and
   loads that panel, so the card works with no app installed.
   PANEL_URL defaults to this page's own location; the author app overrides it
   to point at the reader app's URL right after loading this file, since panels
   need to open the reader, not wherever they happened to be generated. */
let PANEL_URL=location.origin+location.pathname.replace(/[^/]*$/,'')+'#';
// The URL prefix needs lowercase (byte mode, 8 bits/char) — but the shard
// after it doesn't. QRC.create() auto-segments a string across numeric,
// alphanumeric, and byte runs, and alphanumeric mode (QR's native 45-char
// set: 0-9, A-Z, space, $%*+-./:) packs at ~5.5 bits/char. Base32's alphabet
// is a subset of that set, so encoding the shard as base32 instead of base64
// lets the encoder pack it in alphanumeric mode for free — it costs 8/5
// chars per byte instead of base64's 4/3, but each of those chars is cheaper
// to store than a base64 char was, for a net capacity win.
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32e(bytes){
  let out='',bits=0,val=0;
  for(let i=0;i<bytes.length;i++){
    val=(val<<8)|bytes[i]; bits+=8;
    while(bits>=5){ bits-=5; out+=B32[(val>>bits)&31]; }
  }
  if(bits>0) out+=B32[(val<<(5-bits))&31];
  return out;
}
function b32d(str){
  const map=new Int16Array(128).fill(-1);
  for(let i=0;i<32;i++)map[B32.charCodeAt(i)]=i;
  let bits=0,val=0; const out=[];
  for(let i=0;i<str.length;i++){
    const c=str.charCodeAt(i);
    if(c>=128||map[c]<0) continue;
    val=(val<<5)|map[c]; bits+=5;
    if(bits>=8){ bits-=8; out.push((val>>bits)&255); }
  }
  return new Uint8Array(out);
}
function wrap(idx,shard,per,total,cardId){
  // ':' (not '~') on purpose: it's inside QR's alphanumeric character set, so
  // the whole header-plus-shard run — digits, ':', and base32's A-Z/2-7 — can
  // ride as one alphanumeric segment instead of getting chopped back into
  // byte mode at every separator. Same reason the card id goes out uppercase.
  return PANEL_URL+[idx,4,per,total,(cardId>>>0).toString(36).toUpperCase()].join(':')+':'+b32e(shard);
}
function parseFragment(frag){
  const f=String(frag||'').replace(/^#/,'');
  const p=f.split(':');
  if(p.length<6) return null;
  const idx=+p[0], tot=+p[1], per=+p[2], total=+p[3];
  const cardId=parseInt(p[4],36);
  if(!(idx>=0&&idx<4)||!(tot===4)||!(per>0)||!(total>0)) return null;
  const shard=b32d(p[5]);
  if(shard.length<per) return null;
  return{format:3,idx,per,total,cardId:cardId>>>0,shard:shard.slice(0,per)};
}
function unwrap(b){
  if(!b) return null;
  // text form (current): a URL whose fragment carries the shard
  if(typeof b==='string'||b.length>8){
    let txt=null;
    if(typeof b==='string') txt=b;
    else { try{ txt=new TextDecoder('utf-8',{fatal:true}).decode(b); }catch(e){ txt=null; } }
    if(txt){
      const hash=txt.indexOf('#');
      const u=parseFragment(hash>=0?txt.slice(hash+1):txt);
      if(u) return u;
    }
  }
  if(typeof b==='string') return null;
  // legacy binary cards
  if(b.length<7||b[0]!==MAG[0]||b[1]!==MAG[1]) return null;
  if(b[2]!==FORMAT_MARKER){const u={format:1,idx:b[2],per:(b[3]<<8)|b[4],total:(b[5]<<8)|b[6],cardId:null,shard:b.slice(7)};
    return u.idx<4&&u.per===u.shard.length&&u.total<=u.per*3?u:null;}
  if(b.length<HEADER)return null;
  const u={format:2,idx:b[3],per:(b[4]<<8)|b[5],total:(b[6]<<8)|b[7],cardId:get32(b,8),shard:b.slice(HEADER)};
  return u.idx<4&&u.per===u.shard.length&&u.total<=u.per*3&&get32(b,12)===crc32(u.shard)?u:null;
}

/* ---------- 3-of-4: three data shards plus their XOR ---------- */
function shardify(data){
  const per=Math.ceil(data.length/3);
  const sh=[0,1,2].map(i=>{const a=new Uint8Array(per);
    a.set(data.slice(i*per,Math.min(data.length,(i+1)*per)));return a;});
  const par=new Uint8Array(per);
  for(let i=0;i<per;i++)par[i]=sh[0][i]^sh[1][i]^sh[2][i];
  return{shards:[...sh,par],per};
}
function reassemble(got,per,total){
  const miss=[0,1,2,3].filter(i=>!got[i]);
  if(miss.length>1)return null;
  if(miss.length===1){const m=miss[0],a=new Uint8Array(per);
    for(let i=0;i<per;i++){let v=0;for(let k=0;k<4;k++)if(k!==m)v^=got[k][i];a[i]=v;}
    got=got.slice();got[m]=a;}
  const out=new Uint8Array(per*3);
  for(let i=0;i<3;i++)out.set(got[i],i*per);
  return out.slice(0,total);
}
async function deflate(str){const cs=new CompressionStream('deflate-raw');
  const w=cs.writable.getWriter();w.write(new TextEncoder().encode(str));w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());}
async function inflate(buf){const ds=new DecompressionStream('deflate-raw');
  const w=ds.writable.getWriter();w.write(buf);w.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());}

/* ---------- decoding ----------
   jsQR could not read a frame holding two panels: it gathers finder patterns
   globally, mixes up which symbol they belong to, and returns nothing. The
   phone's own camera never had that trouble, which is what gave the game away.
   ZXing (the same engine behind most native scanners) reads several codes in
   one frame, so the scanner can look at the whole view instead of hunting for
   a crop that isolates a single panel. jsQR stays as a fallback. Needs
   zxing.js and jsqr.js loaded before this file. */
let ZXREADY=false;
if(window.ZX&&window.ZX.prepareZXingModule){
  try{
    window.ZX.prepareZXingModule({overrides:{locateFile:()=> './zxing_reader.wasm'}});
    ZXREADY=true;
  }catch(e){ ZXREADY=false; }
}
/* Returns an array of decoded strings found anywhere in the image. */
async function decodeAll(imageData){
  if(ZXREADY){
    try{
      const res=await window.ZX.readBarcodes(imageData,
        {formats:['QRCode'],tryHarder:true,maxNumberOfSymbols:8});
      if(res&&res.length) return res.map(r=>r.text).filter(Boolean);
      return [];
    }catch(e){ /* fall through to jsQR */ }
  }
  const r=jsQR(imageData.data,imageData.width,imageData.height,{inversionAttempts:'dontInvert'});
  return r&&r.data?[r.data]:[];
}
