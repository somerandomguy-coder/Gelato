const $ = (s) => document.querySelector(s);
const canvas = $('#wall'), ctx = canvas.getContext('2d');
const state = { items: [], layout: 'pack', size: 170, captions: false, tight: true, scale: 1, x: 0, y: 0, pointer: null, fullUrl: null, dragged: null, selected: new Set(), marquee: null };
const labels = { pack: 'Tight board', grid: 'Browse', pca: 'Visual map · PCA', umap: 'Style neighbourhoods · UMAP', color: 'Colour mood · colour grade' };
const toast = (message) => { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); };

function resize() { const rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1; canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener('resize', resize);
function gap() { return state.tight ? 6 : 26; }
function imageSize(item) { const h = state.size, ratio = item.w / item.h; return ratio >= 1 ? { w:h, h:Math.max(55,h/ratio) } : { w:Math.max(55,h*ratio), h }; }
function bounds() { if (!state.items.length) return { minX:0,minY:0,maxX:1,maxY:1 }; return state.items.reduce((b,i) => ({ minX:Math.min(b.minX,i.x),minY:Math.min(b.minY,i.y),maxX:Math.max(b.maxX,i.x+i.dw),maxY:Math.max(b.maxY,i.y+i.dh+(state.captions?20:0)) }), {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity}); }
function fit() { if (!state.items.length) return; const b=bounds(), rect=canvas.getBoundingClientRect(); state.scale=Math.max(.08,Math.min(1.4,(rect.width-90)/(b.maxX-b.minX),(rect.height-90)/(b.maxY-b.minY))); state.x=(rect.width-(b.maxX-b.minX)*state.scale)/2-b.minX*state.scale; state.y=(rect.height-(b.maxY-b.minY)*state.scale)/2-b.minY*state.scale; draw(); }
function pack() { const g=gap(), maxWidth=2200; let x=0,y=0,row=0; state.items.forEach((item) => { const d=imageSize(item); if(x&&x+d.w>maxWidth){x=0;y+=row+g;row=0} Object.assign(item,{x,y,dw:d.w,dh:d.h});x+=d.w+g;row=Math.max(row,d.h+(state.captions?20:0)) }); }
function grid() { const g=gap(), cell=state.size, columns=8; state.items.forEach((item,index)=>{const d=imageSize(item), col=index%columns,row=Math.floor(index/columns);Object.assign(item,{x:col*(cell+g),y:row*(cell+g+(state.captions?20:0)),dw:d.w,dh:d.h})}); }
function normalize(points) { const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);return points.map(([x,y])=>[(x-minX)/(maxX-minX||1),(y-minY)/(maxY-minY||1)]); }
function pcaPoints() { const vectors=state.items.map(i=>i.features), n=vectors.length,d=5; if(n<2)return vectors.map(()=>[.5,.5]);const mean=Array(d).fill(0);vectors.forEach(v=>v.forEach((x,j)=>mean[j]+=x/n));const centered=vectors.map(v=>v.map((x,j)=>x-mean[j]));const axis=(orth)=>{let a=Array.from({length:d},(_,i)=>Math.sin(i*2.17+(orth?1:0)));for(let it=0;it<28;it++){let next=Array(d).fill(0);centered.forEach(v=>{const dot=v.reduce((s,x,j)=>s+x*a[j],0);v.forEach((x,j)=>next[j]+=x*dot)});if(orth){const dot=next.reduce((s,x,j)=>s+x*orth[j],0);next=next.map((x,j)=>x-dot*orth[j])}const norm=Math.hypot(...next)||1;a=next.map(x=>x/norm)}return a};const a=axis(),b=axis(a);return normalize(centered.map(v=>[v.reduce((s,x,j)=>s+x*a[j],0),v.reduce((s,x,j)=>s+x*b[j],0)])); }
function scatter(mode) { let points=pcaPoints(); if(mode==='umap'&&points.length>2){const n=Math.min(points.length,350),pos=points.map(p=>[p[0],p[1]]);for(let it=0;it<18;it++)for(let i=0;i<n;i++){const near=state.items.map((o,j)=>j===i?null:{j,dist:Math.hypot(...state.items[i].features.map((v,k)=>v-o.features[k]))}).filter(Boolean).sort((a,b)=>a.dist-b.dist).slice(0,5);near.forEach(({j,dist})=>{const dx=pos[j][0]-pos[i][0],dy=pos[j][1]-pos[i][1],pull=.006/(dist+.05);pos[i][0]+=dx*pull;pos[i][1]+=dy*pull})}points=normalize(pos)}const span=1600;state.items.forEach((item,i)=>{const d=imageSize(item);Object.assign(item,{x:points[i][0]*span,y:points[i][1]*span,dw:d.w,dh:d.h})}); }
function colour() { const span=1800;state.items.forEach(item=>{const d=imageSize(item);Object.assign(item,{x:item.hue*span,y:(1-item.luma)*span,dw:d.w,dh:d.h})}); }
function relayout({fitView=false}={}) { if(state.layout==='pack')pack();else if(state.layout==='grid')grid();else if(state.layout==='color')colour();else scatter(state.layout); state.items.forEach(item=>{item.baseX=item.x;item.baseY=item.y;item.baseW=item.dw;item.baseH=item.dh}); if(fitView)requestAnimationFrame(fit);draw(); }
function draw() { const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height);ctx.fillStyle='#f5f5f2';ctx.fillRect(0,0,r.width,r.height);ctx.save();ctx.translate(state.x,state.y);ctx.scale(state.scale,state.scale);if(state.layout==='color'){const g=ctx.createLinearGradient(0,0,1800,0);['#e88b75','#e7cc71','#8daf7c','#77a4b5','#9d84b7','#dc7791','#e88b75'].forEach((c,i)=>g.addColorStop(i/6,c));ctx.globalAlpha=.12;ctx.fillStyle=g;ctx.fillRect(-150,-150,2200,2100);ctx.globalAlpha=1}for(const item of state.items){const x=item.x,y=item.y,w=item.dw,h=item.dh;if(x+w<(-state.x/state.scale)||y+h<(-state.y/state.scale)||x>(r.width-state.x)/state.scale||y>(r.height-state.y)/state.scale)continue;ctx.drawImage(item.thumb,x,y,w,h);ctx.strokeStyle='rgba(0,0,0,.11)';ctx.lineWidth=1/state.scale;ctx.strokeRect(x,y,w,h);if(state.captions){ctx.fillStyle='#4b4a45';ctx.font=`${11/state.scale}px "DM Sans"`;ctx.fillText(item.name.slice(0,26),x,y+h+14/state.scale)}}ctx.restore();$('#zoom-label').textContent=`${Math.round(state.scale*100)}%`;$('#image-count').textContent=state.items.length;$('#empty').hidden=state.items.length>0; }
function metricFromCanvas(c) { const x=c.getContext('2d'), data=x.getImageData(0,0,c.width,c.height).data;let r=0,g=0,b=0;for(let i=0;i<data.length;i+=4){r+=data[i];g+=data[i+1];b+=data[i+2]}const n=data.length/4;r/=n;g/=n;b/=n;const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/510,delta=max-min;let hue=0;if(delta){if(max===r)hue=((g-b)/delta+6)%6;else if(max===g)hue=(b-r)/delta+2;else hue=(r-g)/delta+4;hue/=6}return {features:[r/255,g/255,b/255,l,delta/255],hue,luma:l}; }
async function thumbFor(file) { const url=URL.createObjectURL(file), image=new Image();image.src=url;await image.decode();const scale=Math.min(1,320/Math.max(image.naturalWidth,image.naturalHeight));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.naturalWidth*scale));c.height=Math.max(1,Math.round(image.naturalHeight*scale));c.getContext('2d').drawImage(image,0,0,c.width,c.height);URL.revokeObjectURL(url);const thumb=window.createImageBitmap?await createImageBitmap(c):c;return {thumb,w:c.width,h:c.height,...metricFromCanvas(c)}; }
async function loadFiles(files,label='images') {
  const valid=[...files].filter(f=>f.type.startsWith('image/'));
  if(!valid.length)return toast('No supported image files found');
  toast(`Streaming ${valid.length} lightweight thumbnails…`);
  for(let i=0;i<valid.length;i++){
    try {
      const processed=await thumbFor(valid[i]);
      state.items.push({id:crypto.randomUUID(),file:valid[i],name:valid[i].name.replace(/\.[^.]+$/,''),...processed});
      // Render immediately: the first image appears as soon as it is decoded,
      // with a refresh every few files so large folders never show a blank wall.
      if(i===0 || i%4===3){ relayout({fitView:i===0}); $('#dataset-name').textContent=`${label} · ${state.items.length} images`; }
    } catch { /* skip an unreadable image, keep streaming the rest */ }
  }
  $('#dataset-name').textContent=`${label} · ${state.items.length} images`;
  relayout({fitView:true});
  toast(`${state.items.length} images ready · originals open only when clicked`);
}
function hit(clientX,clientY) { const r=canvas.getBoundingClientRect(),wx=(clientX-r.left-state.x)/state.scale,wy=(clientY-r.top-state.y)/state.scale;return [...state.items].reverse().find(i=>wx>=i.x&&wx<=i.x+i.dw&&wy>=i.y&&wy<=i.y+i.dh); }
function open(item) { if(state.fullUrl)URL.revokeObjectURL(state.fullUrl);state.fullUrl=URL.createObjectURL(item.file);$('#full-image').src=state.fullUrl;$('#full-caption').textContent=`${item.name} · full resolution`;$('#viewer').showModal(); }
canvas.addEventListener('pointerdown',e=>{state.pointer={x:e.clientX,y:e.clientY,px:state.x,py:state.y,moved:false};canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{const p=state.pointer;if(!p)return;const dx=e.clientX-p.x,dy=e.clientY-p.y;if(Math.hypot(dx,dy)>4)p.moved=true;if(p.moved){state.x=p.px+dx;state.y=p.py+dy;canvas.classList.add('dragging');draw()}});canvas.addEventListener('pointerup',e=>{const p=state.pointer;state.pointer=null;canvas.classList.remove('dragging');if(p&&!p.moved){const item=hit(e.clientX,e.clientY);if(item)open(item)}});canvas.addEventListener('wheel',e=>{e.preventDefault();const old=state.scale,next=Math.max(.06,Math.min(3,old*(e.deltaY<0?1.12:.89))),r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;state.x=x-(x-state.x)*next/old;state.y=y-(y-state.y)*next/old;state.scale=next;draw()},{passive:false});
$('#btn-folder').onclick=()=>$('#folder-input').click();$('#btn-empty-folder').onclick=()=>$('#folder-input').click();$('#btn-images').onclick=()=>$('#image-input').click();$('#folder-input').onchange=e=>{loadFiles(e.target.files,'Folder');e.target.value=''};$('#image-input').onchange=e=>{loadFiles(e.target.files,'Library');e.target.value=''};$('#btn-fit').onclick=fit;$('#btn-clear').onclick=()=>{if(!state.items.length||confirm('Clear this image wall?')){state.items.forEach(i=>i.thumb.close?.());state.items=[];state.scale=1;state.x=state.y=0;$('#dataset-name').textContent='No images loaded';draw()}};$('#toggle-captions').onchange=e=>{state.captions=e.target.checked;relayout({fitView:true})};$('#toggle-tight').onchange=e=>{state.tight=e.target.checked;relayout({fitView:true})};$('#size-range').oninput=e=>{state.size=+e.target.value;relayout()};$('#layout-controls').onclick=e=>{const button=e.target.closest('[data-layout]');if(!button)return;state.layout=button.dataset.layout;document.querySelectorAll('.layout').forEach(x=>x.classList.toggle('active',x===button));$('#layout-caption').textContent=labels[state.layout];relayout({fitView:true})};$('#btn-close').onclick=()=>$('#viewer').close();$('#viewer').addEventListener('close',()=>{if(state.fullUrl){URL.revokeObjectURL(state.fullUrl);state.fullUrl=null}});
function svgFile(color,accent,name){return new File([`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${400+name.length*9}"><rect width="100%" height="100%" fill="${color}"/><circle cx="580" cy="170" r="160" fill="${accent}"/><path d="M0 470Q250 250 800 480V700H0Z" fill="#fff" opacity=".32"/></svg>`],`${name}.svg`,{type:'image/svg+xml'})}$('#btn-sample').onclick=()=>loadFiles([svgFile('#e9be92','#d86b4b','Small rituals'),svgFile('#aec5c8','#5c8391','Open air'),svgFile('#d7d1b6','#778c6c','Field notes'),svgFile('#d6bed0','#976f88','Soft strength'),svgFile('#2e3030','#e4bf5c','Night work')],'Sample');resize();draw();

// Human-readable axes for the analytical views. The PCA/UMAP labels deliberately
// explain the view rather than exposing unexplained PC1/UMAP-1 jargon.
const baseDraw = draw;
draw = function enhancedDraw() {
  baseDraw();
  if (!['pca', 'umap'].includes(state.layout) || !state.items.length) return;
  const rect = canvas.getBoundingClientRect(), span = 1600;
  const ox = state.x - 34 * state.scale, oy = state.y + (span + 44) * state.scale;
  const ex = state.x + (span + 44) * state.scale, ey = state.y - 34 * state.scale;
  ctx.save();
  ctx.strokeStyle = 'rgba(46,46,42,.42)'; ctx.fillStyle = '#5e5e57';
  ctx.lineWidth = 1; ctx.font = '11px "DM Sans"';
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, oy); ctx.moveTo(ox, oy); ctx.lineTo(ox, ey); ctx.stroke();
  const xLabel = state.layout === 'pca' ? 'Visual variation →' : 'Neighbourhood direction →';
  const yLabel = state.layout === 'pca' ? 'More different ↑' : 'Style separation ↑';
  ctx.fillText(xLabel, Math.min(ex - 120, rect.width - 135), oy - 8);
  ctx.save(); ctx.translate(ox + 13, Math.max(50, ey + 105)); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore();
  ctx.restore();
};

function cosine(a, b) { let dot=0,aa=0,bb=0; for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]} return dot/Math.sqrt(aa*bb || 1); }
function pullFive(anchor) {
  anchor.pulled ||= new Set();
  const activeVector = (item) => item.embedding || item.features;
  const picks = state.items.filter(item => item !== anchor && !anchor.pulled.has(item.id)).map(item => ({ item, score: cosine(activeVector(anchor), activeVector(item)) })).sort((a,b) => b.score-a.score).slice(0,5);
  if (!picks.length) return toast('No more unseen similar images');
  const start = anchor.pulled.size, base = Math.max(anchor.dw, anchor.dh, state.size) + gap() + 20;
  const moves=[];
  picks.forEach(({item}, index) => {
    const position = start + index, ring = 1 + Math.floor(position / 8), angle = (position % 8) / 8 * Math.PI * 2 - Math.PI / 2;
    const d = imageSize(item); moves.push({item,x:anchor.x + anchor.dw/2 + Math.cos(angle) * base * ring - d.w/2,y:anchor.y + anchor.dh/2 + Math.sin(angle) * base * ring - d.h/2,w:d.w,h:d.h}); anchor.pulled.add(item.id);
  });
  animateMoves(moves); toast(`Pulled ${picks.length} closest images · right-click again for more`);
}
// Right-click owns one interaction only: pull similar images. It never falls through
// to the normal click/release handler that opens the full-resolution viewer.
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return; const item = hit(event.clientX, event.clientY); if (!item) return;
  event.stopImmediatePropagation(); state.dragged = { item, x:event.clientX, y:event.clientY, ix:item.x, iy:item.y, moved:false }; canvas.setPointerCapture(event.pointerId);
}, true);
canvas.addEventListener('pointermove', (event) => {
  const drag = state.dragged; if (!drag) return; event.stopImmediatePropagation(); const dx=(event.clientX-drag.x)/state.scale, dy=(event.clientY-drag.y)/state.scale;
  if (Math.hypot(dx,dy)>3/state.scale) drag.moved=true; drag.item.x=drag.ix+dx; drag.item.y=drag.iy+dy; drag.item.manual=true; draw();
}, true);
canvas.addEventListener('pointerup', (event) => { const drag=state.dragged; if(!drag)return; event.stopImmediatePropagation(); state.dragged=null; if(!drag.moved)open(drag.item); }, true);

// AI Lab — deliberately lazy. These URLs are not contacted until one of the three
// buttons below is pressed by the person using the wall.
const AI = { mp:null, vision:null, face:null, people:null, clip:null };
const aiStatus = (text) => { $('#ai-status').textContent = text; };
async function visionRuntime() {
  if (!AI.mp) AI.mp = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs');
  if (!AI.vision) AI.vision = await AI.mp.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm');
  return AI;
}
async function modelBytes(url) { const response = await fetch(url); if (!response.ok) throw new Error(`model download failed (${response.status})`); return new Uint8Array(await response.arrayBuffer()); }
async function scanWith(kind) {
  if (!state.items.length) return toast('Upload images before running a scan');
  const button = kind === 'face' ? $('#btn-faces') : $('#btn-people'); button.disabled = true;
  try {
    aiStatus('Loading local browser vision runtime…'); const lab = await visionRuntime();
    let detector;
    if (kind === 'face') {
      if (!lab.face) { aiStatus('Downloading BlazeFace (~230 KB)…'); lab.face = await lab.mp.FaceDetector.createFromOptions(lab.vision, { baseOptions:{modelAssetBuffer:await modelBytes('https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite')}, runningMode:'IMAGE', minDetectionConfidence:.45 }); }
      detector = lab.face;
    } else {
      if (!lab.people) { aiStatus('Downloading people detector (~4.6 MB)…'); lab.people = await lab.mp.ObjectDetector.createFromOptions(lab.vision, { baseOptions:{modelAssetBuffer:await modelBytes('https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite')}, runningMode:'IMAGE', scoreThreshold:.38, categoryAllowlist:['person'] }); }
      detector = lab.people;
    }
    let found = 0;
    for (let index=0; index<state.items.length; index++) {
      const item=state.items[index], size=640, scale=Math.min(1,size/Math.max(item.w,item.h));
      const work=document.createElement('canvas'); work.width=Math.max(16,Math.round(item.w*scale)); work.height=Math.max(16,Math.round(item.h*scale)); work.getContext('2d').drawImage(item.thumb,0,0,work.width,work.height);
      const results=detector.detect(work).detections || []; item.ai ||= {}; item.ai[kind]=results.length; found+=results.length;
      if (index%3===0) { aiStatus(`Scanning ${kind === 'face' ? 'faces' : 'people'} · ${index+1}/${state.items.length}`); await new Promise(requestAnimationFrame); }
    }
    aiStatus(`${kind === 'face' ? 'Faces' : 'People'} complete · ${found} found`); toast(`${found} ${kind === 'face' ? 'faces' : 'people'} found locally`);
  } catch (error) { aiStatus(`Scan failed: ${error.message}`); toast('AI scan could not start — check connection'); }
  finally { button.disabled=false; }
}
async function runClip() {
  if (!state.items.length) return toast('Upload images before running CLIP');
  const button=$('#btn-clip'); button.disabled=true;
  try {
    aiStatus('Loading CLIP runtime and model (~85 MB)…');
    if (!AI.clip) {
      const transformers=await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js');
      const [processor,visionModel,RawImage]=await Promise.all([transformers.AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32'),transformers.CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32'),transformers.RawImage]);
      AI.clip={processor,visionModel,RawImage};
    }
    for(let index=0;index<state.items.length;index++) { const item=state.items[index], raw=await AI.clip.RawImage.fromBlob(item.file), input=await AI.clip.processor(raw), output=await AI.clip.visionModel(input), embedding=Float32Array.from(output.image_embeds.data); const norm=Math.hypot(...embedding)||1; item.embedding=Array.from(embedding,x=>x/norm); if(index%2===0){aiStatus(`Understanding images · ${index+1}/${state.items.length}`);await new Promise(requestAnimationFrame);} }
    // The existing visual-map/UMAP neighbour path reads `features`; once CLIP is
    // ready it can safely use the normalized 512-d semantic representation instead.
    state.items.forEach(item => { if (item.embedding) item.features = item.embedding; });
    relayout({fitView:true});
    aiStatus('CLIP ready · similarity and maps now use image meaning'); toast('CLIP embeddings applied to maps and similarity');
  } catch (error) { aiStatus(`CLIP failed: ${error.message}`); toast('CLIP could not load — check connection'); }
  finally { button.disabled=false; }
}
$('#btn-faces').onclick=()=>scanWith('face'); $('#btn-people').onclick=()=>scanWith('people'); $('#btn-clip').onclick=runClip;

// Replaces the quick colour PCA after CLIP is available. This is the same
// power-iteration approach used by the reference workbench, over every vector dimension.
pcaPoints = function fullVectorPca() {
  const vectors=state.items.map(item=>item.embedding || item.features), n=vectors.length, d=vectors[0]?.length || 0;
  if(n<2 || !d) return vectors.map(()=>[.5,.5]);
  const mean=Array(d).fill(0); for(const v of vectors) for(let k=0;k<d;k++) mean[k]+=v[k]/n;
  const rows=vectors.map(v=>v.map((value,k)=>value-mean[k]));
  const axis=(orthogonal)=>{ let v=Array.from({length:d},(_,k)=>Math.sin(k*1.732+(orthogonal?.[k]||0))); for(let round=0;round<38;round++){const next=Array(d).fill(0);for(const row of rows){let dot=0;for(let k=0;k<d;k++)dot+=row[k]*v[k];for(let k=0;k<d;k++)next[k]+=row[k]*dot;}if(orthogonal){let dot=0;for(let k=0;k<d;k++)dot+=next[k]*orthogonal[k];for(let k=0;k<d;k++)next[k]-=dot*orthogonal[k];}const norm=Math.hypot(...next)||1;v=next.map(value=>value/norm);}return v; };
  const first=axis(),second=axis(first); return normalize(rows.map(row=>{let x=0,y=0;for(let k=0;k<d;k++){x+=row[k]*first[k];y+=row[k]*second[k];}return[x,y];}));
};

function animateMoves(moves, duration=380) {
  const start=performance.now(), from=moves.map(move=>({move,x:move.item.x,y:move.item.y,w:move.item.dw,h:move.item.dh}));
  const frame=(now)=>{const t=Math.min(1,(now-start)/duration), ease=1-Math.pow(1-t,3);for(const entry of from){const {move,item}=entry;item.x=entry.x+(move.x-entry.x)*ease;item.y=entry.y+(move.y-entry.y)*ease;item.dw=entry.w+(move.w-entry.w)*ease;item.dh=entry.h+(move.h-entry.h)*ease;item.manual=true;}draw();if(t<1)requestAnimationFrame(frame);};requestAnimationFrame(frame);
}
function worldFromScreen(x,y){const r=canvas.getBoundingClientRect();return{x:(x-r.left-state.x)/state.scale,y:(y-r.top-state.y)/state.scale};}
function tidySelected() {
  const selected=state.items.filter(item=>state.selected.has(item.id));if(!selected.length)return;
  const minX=Math.min(...selected.map(item=>item.x)),minY=Math.min(...selected.map(item=>item.y));let x=minX,y=minY,row=0;const max=Math.max(state.size*3,420),moves=[];
  selected.forEach(item=>{const d=imageSize(item);if(x>minX&&x+d.w>minX+max){x=minX;y+=row+gap();row=0}moves.push({item,x,y,w:d.w,h:d.h});x+=d.w+gap();row=Math.max(row,d.h);});animateMoves(moves);toast(`Tidied ${selected.length} selected images`);
}
function resetLayout() { const moves=state.items.map(item=>({item,x:item.baseX??item.x,y:item.baseY??item.y,w:item.baseW??item.dw,h:item.baseH??item.dh}));animateMoves(moves,460);state.selected.clear();refreshSelectionToolbar();toast('Returned every image to its layout position'); }
const selectionToolbar=document.createElement('div');selectionToolbar.style.cssText='position:absolute;left:50%;bottom:42px;transform:translateX(-50%);display:none;gap:6px;align-items:center;background:#1d1d1b;color:#fff;padding:6px;border-radius:7px;box-shadow:0 8px 22px #0003;z-index:4';selectionToolbar.innerHTML='<span id="selection-count" style="font-size:11px;padding:0 5px"></span><button id="tidy-selected" class="button">Tidy selection</button><button id="reset-layout" class="button">Reset layout</button>';document.querySelector('.workspace').append(selectionToolbar);
function refreshSelectionToolbar(){selectionToolbar.style.display=state.selected.size?'flex':'none';$('#selection-count').textContent=`${state.selected.size} selected`;draw();}
$('#tidy-selected').onclick=tidySelected;$('#reset-layout').onclick=resetLayout;
const drawWithAxes=draw;
draw=function drawSelections(){drawWithAxes();if(!state.selected.size&&!state.marquee)return;ctx.save();ctx.strokeStyle='#1d1d1b';ctx.lineWidth=2;for(const item of state.items){if(!state.selected.has(item.id))continue;ctx.strokeRect(state.x+item.x*state.scale-3,state.y+item.y*state.scale-3,item.dw*state.scale+6,item.dh*state.scale+6);}if(state.marquee){const m=state.marquee;ctx.fillStyle='rgba(29,29,27,.08)';ctx.strokeStyle='#1d1d1b';ctx.setLineDash([5,4]);ctx.strokeRect(Math.min(m.x,m.nowX),Math.min(m.y,m.nowY),Math.abs(m.nowX-m.x),Math.abs(m.nowY-m.y));ctx.fillRect(Math.min(m.x,m.nowX),Math.min(m.y,m.nowY),Math.abs(m.nowX-m.x),Math.abs(m.nowY-m.y));ctx.setLineDash([]);}ctx.restore();};
canvas.addEventListener('pointerdown',(event)=>{if(event.button!==0||!event.shiftKey||hit(event.clientX,event.clientY))return;event.stopImmediatePropagation();state.marquee={x:event.clientX,y:event.clientY,nowX:event.clientX,nowY:event.clientY};canvas.setPointerCapture(event.pointerId);draw();},true);
canvas.addEventListener('pointermove',(event)=>{if(!state.marquee)return;event.stopImmediatePropagation();state.marquee.nowX=event.clientX;state.marquee.nowY=event.clientY;const left=Math.min(state.marquee.x,event.clientX),right=Math.max(state.marquee.x,event.clientX),top=Math.min(state.marquee.y,event.clientY),bottom=Math.max(state.marquee.y,event.clientY),rect=canvas.getBoundingClientRect();state.selected=new Set(state.items.filter(item=>{const x=rect.left+state.x+item.x*state.scale,y=rect.top+state.y+item.y*state.scale;return x<right&&x+item.dw*state.scale>left&&y<bottom&&y+item.dh*state.scale>top;}).map(item=>item.id));draw();},true);
canvas.addEventListener('pointerup',(event)=>{if(!state.marquee)return;event.stopImmediatePropagation();state.marquee=null;refreshSelectionToolbar();},true);
canvas.addEventListener('pointerdown',(event)=>{if(event.button!==2)return;const item=hit(event.clientX,event.clientY);if(!item)return;event.preventDefault();event.stopImmediatePropagation();pullFive(item);},true);
