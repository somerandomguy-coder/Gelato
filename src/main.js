import { computePCA, computeUMAP } from './projections.js';
import { packLayout } from './viz-packer.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#wall'), ctx = canvas.getContext('2d');
const state = { items: [], layout: 'pack', size: 128, captions: false, tight: true, scale: 1, x: 0, y: 0, pointer: null, fullUrl: null, dragged: null, selected: new Set(), marquee: null, hovered:null, gesture:null, faceFilter:'all', peopleFilter:'all', page:1, pageSize:500, duplicateGroups:[], duplicateIndex:0, activeDraftIds:null, savedDraftPositions:null, revealedIds:new Set(), clipActive:false };
const labels = { pack: 'Tight board', grid: 'Browse', pca: 'Visual map · PCA', umap: 'Style neighbourhoods · UMAP', color: 'Colour mood · colour grade' };
const toast = (message) => { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); };
const workerPending=new Map(); let workerSerial=0, workerFailed=false;
const imageWorker=typeof Worker!=='undefined'&&typeof OffscreenCanvas!=='undefined'?new Worker(new URL('./image-worker.js',import.meta.url),{type:'module'}):null;
if(imageWorker)imageWorker.onmessage=({data})=>{const pending=workerPending.get(data.id);if(!pending)return;workerPending.delete(data.id);data.type==='error'?pending.reject(new Error(data.error)):pending.resolve(data);};
if(imageWorker)imageWorker.onerror=(event)=>{workerFailed=true;const error=new Error(event.message||'Image worker stopped');workerPending.forEach(pending=>pending.reject(error));workerPending.clear();};
function workerJob(type,payload){if(!imageWorker||workerFailed)return Promise.reject(new Error('Worker unavailable'));const id=++workerSerial;return new Promise((resolve,reject)=>{workerPending.set(id,{resolve,reject});try{imageWorker.postMessage({type,id,...payload});}catch(error){workerPending.delete(id);workerFailed=true;reject(error);}});}

function resize() { const rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1; canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener('resize', resize);
function gap() { return state.tight ? 6 : 26; }
function imageSize(item) { const h = state.size, ratio = item.w / item.h; return ratio >= 1 ? { w:h, h:h/ratio } : { w:h*ratio, h }; }
function bounds(items=visibleItems()) { if (!items.length) return { minX:0,minY:0,maxX:1,maxY:1 }; return items.reduce((b,i) => ({ minX:Math.min(b.minX,i.x),minY:Math.min(b.minY,i.y),maxX:Math.max(b.maxX,i.x+i.dw),maxY:Math.max(b.maxY,i.y+i.dh+(state.captions?20:0)) }), {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity}); }
function fit() { const items=visibleItems();if(!items.length)return;const b=bounds(items),rect=canvas.getBoundingClientRect();state.scale=Math.max(.035,Math.min(1.4,(rect.width-48)/(b.maxX-b.minX),(rect.height-72)/(b.maxY-b.minY)));state.x=(rect.width-(b.maxX-b.minX)*state.scale)/2-b.minX*state.scale;state.y=(rect.height-(b.maxY-b.minY)*state.scale)/2-b.minY*state.scale;draw(); }
function pack() { const packed=packLayout(state.items,state.size,gap()); packed.items.forEach(placement=>Object.assign(placement.item,{x:placement.x,y:placement.y,dw:placement.w,dh:placement.h})); }
function grid() { const g=gap(), cell=state.size, columns=8; state.items.forEach((item,index)=>{const d=imageSize(item), col=index%columns,row=Math.floor(index/columns);Object.assign(item,{x:col*(cell+g),y:row*(cell+g+(state.captions?20:0)),dw:d.w,dh:d.h})}); }
function normalize(points) { const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);return points.map(([x,y])=>[(x-minX)/(maxX-minX||1),(y-minY)/(maxY-minY||1)]); }
function pcaPoints() { const vectors=state.items.map(i=>i.features), n=vectors.length,d=5; if(n<2)return vectors.map(()=>[.5,.5]);const mean=Array(d).fill(0);vectors.forEach(v=>v.forEach((x,j)=>mean[j]+=x/n));const centered=vectors.map(v=>v.map((x,j)=>x-mean[j]));const axis=(orth)=>{let a=Array.from({length:d},(_,i)=>Math.sin(i*2.17+(orth?1:0)));for(let it=0;it<28;it++){let next=Array(d).fill(0);centered.forEach(v=>{const dot=v.reduce((s,x,j)=>s+x*a[j],0);v.forEach((x,j)=>next[j]+=x*dot)});if(orth){const dot=next.reduce((s,x,j)=>s+x*orth[j],0);next=next.map((x,j)=>x-dot*orth[j])}const norm=Math.hypot(...next)||1;a=next.map(x=>x/norm)}return a};const a=axis(),b=axis(a);return normalize(centered.map(v=>[v.reduce((s,x,j)=>s+x*a[j],0),v.reduce((s,x,j)=>s+x*b[j],0)])); }
function scatter(mode) { let points=pcaPoints(); if(mode==='umap'&&points.length>2){const n=Math.min(points.length,350),pos=points.map(p=>[p[0],p[1]]);for(let it=0;it<18;it++)for(let i=0;i<n;i++){const near=state.items.map((o,j)=>j===i?null:{j,dist:Math.hypot(...state.items[i].features.map((v,k)=>v-o.features[k]))}).filter(Boolean).sort((a,b)=>a.dist-b.dist).slice(0,5);near.forEach(({j,dist})=>{const dx=pos[j][0]-pos[i][0],dy=pos[j][1]-pos[i][1],pull=.006/(dist+.05);pos[i][0]+=dx*pull;pos[i][1]+=dy*pull})}points=normalize(pos)}const span=1600;state.items.forEach((item,i)=>{const d=imageSize(item);Object.assign(item,{x:points[i][0]*span,y:points[i][1]*span,dw:d.w,dh:d.h})}); }
function colour() { const span=1800;state.items.forEach(item=>{const d=imageSize(item);Object.assign(item,{x:item.hue*span,y:(1-item.luma)*span,dw:d.w,dh:d.h})}); }
function relayout({fitView=false}={}) { if(state.layout==='pack')pack();else if(state.layout==='grid')grid();else if(state.layout==='color')colour();else scatter(state.layout); state.items.forEach(item=>{item.baseX=item.x;item.baseY=item.y;item.baseW=item.dw;item.baseH=item.dh}); if(fitView)requestAnimationFrame(fit);draw(); }
function draw() { const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height);ctx.fillStyle='#f5f5f2';ctx.fillRect(0,0,r.width,r.height);ctx.save();ctx.translate(state.x,state.y);ctx.scale(state.scale,state.scale);if(state.layout==='color'){const g=ctx.createLinearGradient(0,0,1800,0);['#e88b75','#e7cc71','#8daf7c','#77a4b5','#9d84b7','#dc7791','#e88b75'].forEach((c,i)=>g.addColorStop(i/6,c));ctx.globalAlpha=.12;ctx.fillStyle=g;ctx.fillRect(-150,-150,2200,2100);ctx.globalAlpha=1}for(const item of state.items){const x=item.x,y=item.y,w=item.dw,h=item.dh;if(x+w<(-state.x/state.scale)||y+h<(-state.y/state.scale)||x>(r.width-state.x)/state.scale||y>(r.height-state.y)/state.scale)continue;ctx.drawImage(item.thumb,x,y,w,h);ctx.strokeStyle='rgba(0,0,0,.11)';ctx.lineWidth=1/state.scale;ctx.strokeRect(x,y,w,h);if(state.captions){ctx.fillStyle='#4b4a45';ctx.font=`${11/state.scale}px "DM Sans"`;ctx.fillText(item.name.slice(0,26),x,y+h+14/state.scale)}}ctx.restore();$('#zoom-label').textContent=`${Math.round(state.scale*100)}%`;$('#image-count').textContent=state.items.length;$('#empty').hidden=state.items.length>0; }
function metricFromCanvas(c) { const x=c.getContext('2d'), data=x.getImageData(0,0,c.width,c.height).data;let r=0,g=0,b=0;for(let i=0;i<data.length;i+=4){r+=data[i];g+=data[i+1];b+=data[i+2]}const n=data.length/4;r/=n;g/=n;b/=n;const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/510,delta=max-min;let hue=0;if(delta){if(max===r)hue=((g-b)/delta+6)%6;else if(max===g)hue=(b-r)/delta+2;else hue=(r-g)/delta+4;hue/=6}return {features:[r/255,g/255,b/255,l,delta/255],hue,luma:l}; }
function perceptualHash(source) { const c=document.createElement('canvas');c.width=c.height=32;const cx=c.getContext('2d',{willReadFrequently:true});cx.drawImage(source,0,0,32,32);const rgba=cx.getImageData(0,0,32,32).data,gray=new Float32Array(1024);for(let i=0;i<1024;i++)gray[i]=.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2];const values=[];for(let v=0;v<8;v++)for(let u=0;u<8;u++){let sum=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++)sum+=gray[y*32+x]*Math.cos((2*x+1)*u*Math.PI/64)*Math.cos((2*y+1)*v*Math.PI/64);values.push(sum)}const sorted=values.slice(1).sort((a,b)=>a-b),median=sorted[31];return Uint8Array.from(values.slice(1),value=>value>median?1:0); }
async function thumbFor(file) { const url=URL.createObjectURL(file),image=new Image();try{image.src=url;await image.decode();const origW=image.naturalWidth,origH=image.naturalHeight,scale=Math.min(1,256/Math.max(origW,origH));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(origW*scale));c.height=Math.max(1,Math.round(origH*scale));c.getContext('2d').drawImage(image,0,0,c.width,c.height);const thumb=window.createImageBitmap?await createImageBitmap(c):c;return {thumb,w:c.width,h:c.height,width:origW,height:origH,phash:perceptualHash(c),...metricFromCanvas(c)};}finally{URL.revokeObjectURL(url);} }
const mainThreadThumb=thumbFor;
thumbFor=async function workerThumbnail(file){
  if(!imageWorker||workerFailed)return mainThreadThumb(file);
  try {
    const {thumb,width,height,tw,th,analysis,phash}=await workerJob('thumbnail',{file});
    return {thumb,w:tw,h:th,width,height,phash,features:Array.from(analysis.vector),hue:analysis.primaryHsl.h/360,luma:analysis.primaryHsl.l,analysis};
  } catch(error) { if(workerFailed)return mainThreadThumb(file);throw error; }
};
async function loadFiles(files,label='images') {
  const valid=[...files].filter(f=>f.type.startsWith('image/'));
  if(!valid.length)return toast('No supported image files found');
  if(state.activeDraftIds)$('#btn-leave-draft').click();
  if(state.faceFilter!=='all'||state.peopleFilter!=='all'){state.faceFilter='all';state.peopleFilter='all';state.page=1;renderAiFilters();}
  if(state.clipActive){state.clipActive=false;projectionCount=0;projectionRun++;aiStatus('New photos added · run Understand images again to include them in semantic views.');}
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
  relayout({fitView:true}); if(state.items.length>state.pageSize)requestAnimationFrame(fitPage);
  toast(`${state.items.length} images ready · originals open only when clicked`);
}
function hit(clientX,clientY) { const r=canvas.getBoundingClientRect(),wx=(clientX-r.left-state.x)/state.scale,wy=(clientY-r.top-state.y)/state.scale;return [...visibleItems()].reverse().find(i=>wx>=i.x&&wx<=i.x+i.dw&&wy>=i.y&&wy<=i.y+i.dh); }
function open(item) { if(state.fullUrl)URL.revokeObjectURL(state.fullUrl);state.fullUrl=URL.createObjectURL(item.file);$('#full-image').src=state.fullUrl;$('#full-caption').textContent=`${item.name} · full resolution`;$('#viewer').showModal(); }
canvas.addEventListener('wheel',e=>{e.preventDefault();const old=state.scale,next=Math.max(.06,Math.min(3,old*(e.deltaY<0?1.12:.89))),r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;state.x=x-(x-state.x)*next/old;state.y=y-(y-state.y)*next/old;state.scale=next;draw()},{passive:false});
$('#btn-folder').onclick=()=>$('#folder-input').click();$('#btn-empty-folder').onclick=()=>$('#folder-input').click();$('#btn-images').onclick=()=>$('#image-input').click();$('#folder-input').onchange=e=>{loadFiles(e.target.files,'Folder');e.target.value=''};$('#image-input').onchange=e=>{loadFiles(e.target.files,'Library');e.target.value=''};$('#btn-fit').onclick=fit;$('#btn-clear').onclick=()=>{if(!state.items.length||confirm('Clear this image wall?')){state.items.forEach(i=>i.thumb.close?.());state.items=[];state.selected.clear();refreshSelectionToolbar();state.page=1;state.faceFilter='all';state.peopleFilter='all';filterControls.innerHTML='';filterControls.style.display='none';state.hovered=null;state.duplicateGroups=[];state.activeDraftIds=null;state.savedDraftPositions=null;state.revealedIds.clear();state.clipActive=false;projectionCount=0;projectionRun++;activeMoves.clear();if(moveFrame){cancelAnimationFrame(moveFrame);moveFrame=0;}setDraftControlsDisabled(false);$('#active-draft-banner').hidden=true;$('#btn-restore-duplicates').hidden=true;$('#workflow-status').textContent='You choose what makes the final cut.';state.scale=1;state.x=state.y=0;$('#dataset-name').textContent='No images loaded';draw()}};$('#toggle-captions').onchange=e=>{state.captions=e.target.checked;relayout({fitView:true})};$('#toggle-tight').onchange=e=>{state.tight=e.target.checked;relayout({fitView:true})};$('#size-range').oninput=e=>{state.size=+e.target.value;relayout({fitView:true})};$('#layout-controls').onclick=e=>{const button=e.target.closest('[data-layout]');if(!button||state.activeDraftIds)return;state.layout=button.dataset.layout;document.querySelectorAll('.layout').forEach(x=>x.classList.toggle('active',x===button));$('#layout-caption').textContent=labels[state.layout];relayout({fitView:true})};$('#btn-close').onclick=()=>$('#viewer').close();$('#viewer').addEventListener('close',()=>{if(state.fullUrl){URL.revokeObjectURL(state.fullUrl);state.fullUrl=null}});
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

function cosine(a, b) { if(!a||!b||a.length!==b.length||!a.length)return -2;let dot=0,aa=0,bb=0; for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]} return aa&&bb?dot/Math.sqrt(aa*bb):-2; }
function vectorFor(item){return state.clipActive&&item.embedding?item.embedding:item.features;}
function pullFive(anchor) {
  anchor.pulled ||= new Set();
  const picks = availableItems().filter(item => item !== anchor && !anchor.pulled.has(item.id)).map(item => ({ item, score: cosine(vectorFor(anchor), vectorFor(item)) })).filter(row=>row.score>-1).sort((a,b) => b.score-a.score).slice(0,5);
  if (!picks.length) return toast('No more unseen similar images');
  const start = anchor.pulled.size, base = Math.max(anchor.dw, anchor.dh, state.size) + gap() + 20;
  const moves=[];
  picks.forEach(({item}, index) => {
    const position = start + index, ring = 1 + Math.floor(position / 8), angle = (position % 8) / 8 * Math.PI * 2 - Math.PI / 2;
    const d = imageSize(item); moves.push({item,x:anchor.x + anchor.dw/2 + Math.cos(angle) * base * ring - d.w/2,y:anchor.y + anchor.dh/2 + Math.sin(angle) * base * ring - d.h/2,w:d.w,h:d.h}); anchor.pulled.add(item.id);state.revealedIds.add(item.id);
  });
  animateMoves(moves); toast(`Pulled ${picks.length} closest images · right-click again for more`);
}
// Right-click owns one interaction only: pull similar images. It never falls through
// to the normal click/release handler that opens the full-resolution viewer.

// AI Lab — deliberately lazy. These URLs are not contacted until one of the three
// buttons below is pressed by the person using the wall.
const AI = { mp:null, vision:null, face:null, people:null, clip:null, cacheName:'gelato-ai-models-v1' };
const aiStatus = (text) => { $('#ai-status').textContent = text; };
async function visionRuntime() {
  if (!AI.mp) AI.mp = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs');
  if (!AI.vision) AI.vision = await AI.mp.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm');
  return AI;
}
async function modelBytes(url) {
  // Cache Storage survives a reload (subject to browser storage eviction), so face
  // and person models are fetched once rather than every visit.
  if ('caches' in window) { const cache=await caches.open(AI.cacheName); const saved=await cache.match(url); if(saved){aiStatus('Using cached AI model…');return new Uint8Array(await saved.arrayBuffer());} const response=await fetch(url);if(!response.ok)throw new Error(`model download failed (${response.status})`);await cache.put(url,response.clone());return new Uint8Array(await response.arrayBuffer()); }
  const response=await fetch(url); if (!response.ok) throw new Error(`model download failed (${response.status})`); return new Uint8Array(await response.arrayBuffer());
}
async function inferenceCanvas(file,maxSide=640){const source=await createImageBitmap(file),scale=Math.min(1,maxSide/Math.max(source.width,source.height)),work=document.createElement('canvas');work.width=Math.max(16,Math.round(source.width*scale));work.height=Math.max(16,Math.round(source.height*scale));work.getContext('2d').drawImage(source,0,0,work.width,work.height);source.close();return work;}
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
      const item=state.items[index], work=await inferenceCanvas(item.file,640);
      const results=detector.detect(work).detections || []; item.ai ||= {}; item.ai[kind]=results.length; found+=results.length;
      if (index%3===0) { aiStatus(`Scanning ${kind === 'face' ? 'faces' : 'people'} · ${index+1}/${state.items.length}`); await new Promise(requestAnimationFrame); }
    }
    aiStatus(`${kind === 'face' ? 'Faces' : 'People'} complete · ${found} found`); renderAiFilters(); draw(); toast(`${found} ${kind === 'face' ? 'faces' : 'people'} found locally`);
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
      // Transformers.js persists the CLIP shards in browser Cache Storage.
      if (transformers.env) { transformers.env.allowLocalModels=false; transformers.env.useBrowserCache=true; }
      const [processor,visionModel]=await Promise.all([transformers.AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32'),transformers.CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32')]);
      AI.clip={processor,visionModel,RawImage:transformers.RawImage,transformers,tokenizer:null,textModel:null};
    }
    for(let index=0;index<state.items.length;index++) { const item=state.items[index], raw=await AI.clip.RawImage.fromBlob(item.file), input=await AI.clip.processor(raw), output=await AI.clip.visionModel(input), embedding=Float32Array.from(output.image_embeds.data); const norm=Math.hypot(...embedding)||1; item.embedding=Array.from(embedding,x=>x/norm); if(index%2===0){aiStatus(`Understanding images · ${index+1}/${state.items.length}`);await new Promise(requestAnimationFrame);} }
    state.clipActive=true;projectionCount=0;relayout({fitView:true});
    aiStatus('CLIP ready · similarity and maps now use image meaning'); toast('CLIP embeddings applied to maps and similarity'); return true;
  } catch (error) { aiStatus(`CLIP failed: ${error.message}`); toast('CLIP could not load — check connection'); return false; }
  finally { button.disabled=false; }
}
$('#btn-faces').onclick=()=>scanWith('face'); $('#btn-people').onclick=()=>scanWith('people'); $('#btn-clip').onclick=runClip;
const clearAiCache=document.createElement('button');clearAiCache.className='link';clearAiCache.textContent='Clear downloaded AI models';clearAiCache.style.marginTop='6px';$('#ai-status').after(clearAiCache);clearAiCache.onclick=async()=>{if(!confirm('Remove the downloaded AI models from this browser?'))return;AI.face=AI.people=AI.clip=null;if('caches'in window){await caches.delete(AI.cacheName);await caches.delete('transformers-cache');}aiStatus('Downloaded AI models cleared');toast('AI model cache cleared');};

// Replaces the quick colour PCA after CLIP is available. This is the same
// power-iteration approach used by the reference workbench, over every vector dimension.
pcaPoints = function fullVectorPca() {
  const vectors=state.items.map(vectorFor), n=vectors.length, d=vectors[0]?.length || 0;
  if(n<2 || !d) return vectors.map(()=>[.5,.5]);
  const mean=Array(d).fill(0); for(const v of vectors) for(let k=0;k<d;k++) mean[k]+=v[k]/n;
  const rows=vectors.map(v=>v.map((value,k)=>value-mean[k]));
  const axis=(orthogonal)=>{ let v=Array.from({length:d},(_,k)=>Math.sin(k*1.732+(orthogonal?.[k]||0))); for(let round=0;round<38;round++){const next=Array(d).fill(0);for(const row of rows){let dot=0;for(let k=0;k<d;k++)dot+=row[k]*v[k];for(let k=0;k<d;k++)next[k]+=row[k]*dot;}if(orthogonal){let dot=0;for(let k=0;k<d;k++)dot+=next[k]*orthogonal[k];for(let k=0;k<d;k++)next[k]-=dot*orthogonal[k];}const norm=Math.hypot(...next)||1;v=next.map(value=>value/norm);}return v; };
  const first=axis(),second=axis(first); return normalize(rows.map(row=>{let x=0,y=0;for(let k=0;k<d;k++){x+=row[k]*first[k];y+=row[k]*second[k];}return[x,y];}));
};

const activeMoves=new Map();let moveFrame=0;
function animateMoves(moves, duration=380) {
  const start=performance.now();
  for(const move of moves)activeMoves.set(move.item.id,{move,start,duration,x:move.item.x,y:move.item.y,w:move.item.dw,h:move.item.dh});
  if(moveFrame)return;
  const frame=(now)=>{moveFrame=0;for(const [id,entry] of activeMoves){const t=Math.min(1,(now-entry.start)/entry.duration),ease=1-Math.pow(1-t,3),{move,item}=entry;item.x=entry.x+(move.x-entry.x)*ease;item.y=entry.y+(move.y-entry.y)*ease;item.dw=entry.w+(move.w-entry.w)*ease;item.dh=entry.h+(move.h-entry.h)*ease;item.manual=true;if(t>=1)activeMoves.delete(id);}draw();if(activeMoves.size)moveFrame=requestAnimationFrame(frame);};
  moveFrame=requestAnimationFrame(frame);
}
function worldFromScreen(x,y){const r=canvas.getBoundingClientRect();return{x:(x-r.left-state.x)/state.scale,y:(y-r.top-state.y)/state.scale};}
function tidySelected() {
  const selected=state.items.filter(item=>state.selected.has(item.id));if(!selected.length)return;
  const minX=Math.min(...selected.map(item=>item.x)),minY=Math.min(...selected.map(item=>item.y));let x=minX,y=minY,row=0;const max=Math.max(state.size*3,420),moves=[];
  selected.forEach(item=>{const d=imageSize(item);if(x>minX&&x+d.w>minX+max){x=minX;y+=row+gap();row=0}moves.push({item,x,y,w:d.w,h:d.h});x+=d.w+gap();row=Math.max(row,d.h);});animateMoves(moves);toast(`Tidied ${selected.length} selected images`);
}
function resetLayout() { const moves=state.items.map(item=>({item,x:item.baseX??item.x,y:item.baseY??item.y,w:item.baseW??item.dw,h:item.baseH??item.dh}));animateMoves(moves,460);state.items.forEach(item=>{if(item.pulled)item.pulled.clear();});state.revealedIds.clear();state.selected.clear();refreshSelectionToolbar();toast('Returned every image to its layout position'); }
const selectionToolbar=document.createElement('div');selectionToolbar.style.cssText='position:absolute;left:50%;bottom:42px;transform:translateX(-50%);display:none;gap:6px;align-items:center;background:#1d1d1b;color:#fff;padding:6px;border-radius:7px;box-shadow:0 8px 22px #0003;z-index:4';selectionToolbar.innerHTML='<span id="selection-count" style="font-size:11px;padding:0 5px"></span><button id="tidy-selected" class="button">Tidy selection</button><button id="name-selected" class="button">Name people</button><button id="reset-layout" class="button">Reset layout</button>';document.querySelector('.workspace').append(selectionToolbar);
function refreshSelectionToolbar(){selectionToolbar.style.display=state.selected.size?'flex':'none';$('#selection-count').textContent=`${state.selected.size} selected`;draw();}
$('#tidy-selected').onclick=tidySelected;$('#reset-layout').onclick=resetLayout;
$('#name-selected').onclick=()=>{const name=prompt('Who is in these selected photos? (This is a local label.)');if(!name?.trim())return;state.items.filter(item=>state.selected.has(item.id)).forEach(item=>{item.peopleName=name.trim();});toast(`Named ${state.selected.size} photos “${name.trim()}”`);draw();};
const drawWithAxes=draw;
draw=function drawSelections(){drawWithAxes();if(!state.selected.size&&!state.marquee)return;ctx.save();ctx.strokeStyle='#1d1d1b';ctx.lineWidth=2;for(const item of state.items){if(!state.selected.has(item.id))continue;ctx.strokeRect(state.x+item.x*state.scale-3,state.y+item.y*state.scale-3,item.dw*state.scale+6,item.dh*state.scale+6);}if(state.marquee){const m=state.marquee;ctx.fillStyle='rgba(29,29,27,.08)';ctx.strokeStyle='#1d1d1b';ctx.setLineDash([5,4]);ctx.strokeRect(Math.min(m.x,m.nowX),Math.min(m.y,m.nowY),Math.abs(m.nowX-m.x),Math.abs(m.nowY-m.y));ctx.fillRect(Math.min(m.x,m.nowX),Math.min(m.y,m.nowY),Math.abs(m.nowX-m.x),Math.abs(m.nowY-m.y));ctx.setLineDash([]);}ctx.restore();};

function matchesAiFilter(item) {
  const faces=item.ai?.face, people=item.ai?.people;
  const matches=(count,filter)=>filter==='all'||(count!==undefined&&((filter==='none'&&count===0)||(filter==='one'&&count===1)||(filter==='many'&&count>=2)));
  return matches(faces,state.faceFilter)&&matches(people,state.peopleFilter);
}
function availableItems(){return state.items.filter(item=>!item.duplicateHidden&&matchesAiFilter(item)&&(!state.activeDraftIds||state.activeDraftIds.has(item.id)));}
function visibleItems(){const all=availableItems(),start=(state.page-1)*state.pageSize,page=all.slice(start,start+state.pageSize),ids=new Set(page.map(item=>item.id));return page.concat(all.filter(item=>state.revealedIds.has(item.id)&&!ids.has(item.id)));}
const drawBeforeAiFilters=draw;
draw=function drawWithAiFilters(){
  // Keep spatial coordinates intact: filters hide matching thumbnails rather than
  // recomputing the layout and losing the user's carefully arranged board.
  const all=state.items, rendered=visibleItems();
  state.items=rendered;
  try { drawBeforeAiFilters(); } finally { state.items=all; }
  $('#image-count').textContent=all.length;$('#empty').hidden=all.length>0;$('#no-matches').hidden=!all.length||rendered.length>0;
  ctx.save();ctx.font='10px "DM Mono"';
  for(const item of rendered){const hasFaces=item.ai?.face!==undefined,hasPeople=item.ai?.people!==undefined;if(!hasFaces&&!hasPeople&&!item.peopleName)continue;const x=state.x+(item.x+4)*state.scale,y=state.y+(item.y+4)*state.scale;let label=item.peopleName?`◉ ${item.peopleName}`:'';if(hasFaces){const count=item.ai.face,tag=count===0?'No face':count===1?'1 face':'2+ faces';label+=`${label?'  ':''}${tag}`;}if(hasPeople){const count=item.ai.people,tag=count===0?'No person':count===1?'1 person':'2+ people';label+=`${label?'  ':''}${tag}`;}ctx.fillStyle='rgba(24,24,22,.82)';const width=ctx.measureText(label).width+10;ctx.fillRect(x,y,width,17);ctx.fillStyle='#fff';ctx.fillText(label,x+5,y+12);}
  ctx.restore();
};
let projectionRun=0, projectionCount=0;
function requestReferenceProjections(){
  const vectors=state.items.map(vectorFor);if(vectors.length<2||projectionCount===vectors.length)return;projectionCount=vectors.length;const run=++projectionRun;
  const apply=({pca,umap})=>{if(run!==projectionRun)return;state.items.forEach((item,index)=>{item.referencePca=pca.coords[index]||[0,0];item.referenceUmap=umap.coords[index]||[0,0];});if(['pca','umap'].includes(state.layout)&&!state.activeDraftIds)relayout({fitView:true});};
  workerJob('projections',{vectors}).then(apply).catch(()=>{try{apply({pca:computePCA(vectors),umap:computeUMAP(vectors,{nNeighbors:15,minDist:.18})});}catch{}});
}
// Uses the reference project's deterministic PCA + PCA-initialized UMAP, computed
// in the worker so a large image folder never freezes pointer/zoom interaction.
scatter=function referenceScatter(mode){
  requestReferenceProjections();const key=mode==='umap'?'referenceUmap':'referencePca',span=1600;
  state.items.forEach((item,index)=>{const coords=item[key]||[Math.cos(index)*.08,Math.sin(index)*.08],d=imageSize(item);Object.assign(item,{x:(coords[0]+1)*.5*span,y:(1-(coords[1]+1)*.5)*span,dw:d.w,dh:d.h});});
};

const pageBar=document.createElement('div');pageBar.style.cssText='display:none;gap:5px;align-items:center;margin-right:auto;font:10px "DM Mono"';pageBar.innerHTML='<button class="button" id="page-prev" style="padding:4px 7px">‹</button><span id="page-label"></span><button class="button" id="page-next" style="padding:4px 7px">›</button><select id="page-size" style="font:10px DM Mono;border:1px solid #d5d5ce;border-radius:4px;padding:4px"><option value="250">250 / page</option><option value="500" selected>500 / page</option><option value="1000">1000 / page</option><option value="999999">All</option></select>';document.querySelector('.rail-bottom').prepend(pageBar);
function updatePageUi(){const filtered=availableItems(),pages=Math.max(1,Math.ceil(filtered.length/state.pageSize));state.page=Math.min(state.page,pages);pageBar.style.display=filtered.length>state.pageSize?'flex':'none';$('#page-label').textContent=`${state.page}/${pages}`;}
const drawWithPages=draw;draw=function pagedDraw(){updatePageUi();drawWithPages();};
function fitPage(){fit();}
const resetPageSelection=()=>{state.selected.clear();refreshSelectionToolbar();};$('#page-prev').onclick=()=>{state.page=Math.max(1,state.page-1);resetPageSelection();fitPage();};$('#page-next').onclick=()=>{const total=Math.ceil(availableItems().length/state.pageSize);state.page=Math.min(total,state.page+1);resetPageSelection();fitPage();};$('#page-size').onchange=e=>{state.pageSize=+e.target.value;state.page=1;resetPageSelection();fitPage();};

// One pointer state machine. Coordinates are canvas-local so the sidebar never
// shifts hit-testing, highlights, or marquee selection away from the cursor.
const localPoint=(event)=>{const r=canvas.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};};
canvas.addEventListener('pointerdown',(event)=>{
  if(event.button!==0)return;
  const point=localPoint(event), item=hit(event.clientX,event.clientY);
  if(event.shiftKey&&!item){state.gesture={kind:'marquee',start:point,now:point};state.marquee={x:point.x,y:point.y,nowX:point.x,nowY:point.y};}
  else if(item){activeMoves.delete(item.id);state.gesture={kind:'item',item,start:point,x:item.x,y:item.y,moved:false};}
  else {state.gesture={kind:'pan',start:point,x:state.x,y:state.y,moved:false};canvas.classList.add('dragging');}
  canvas.setPointerCapture(event.pointerId); draw();
});
canvas.addEventListener('pointermove',(event)=>{
  const point=localPoint(event), gesture=state.gesture;
  if(!gesture){const next=hit(event.clientX,event.clientY);if(next!==state.hovered){state.hovered=next;canvas.style.cursor=next?'pointer':'grab';draw();}return;}
  const dx=point.x-gesture.start.x,dy=point.y-gesture.start.y;
  if(gesture.kind==='pan'){if(Math.hypot(dx,dy)>3)gesture.moved=true;state.x=gesture.x+dx;state.y=gesture.y+dy;}
  if(gesture.kind==='item'){if(Math.hypot(dx,dy)>4)gesture.moved=true;if(gesture.moved){gesture.item.x=gesture.x+dx/state.scale;gesture.item.y=gesture.y+dy/state.scale;gesture.item.manual=true;}}
  if(gesture.kind==='marquee'){gesture.now=point;state.marquee.nowX=point.x;state.marquee.nowY=point.y;const left=Math.min(gesture.start.x,point.x),right=Math.max(gesture.start.x,point.x),top=Math.min(gesture.start.y,point.y),bottom=Math.max(gesture.start.y,point.y);state.selected=new Set(visibleItems().filter(item=>{const x=state.x+item.x*state.scale,y=state.y+item.y*state.scale;return x<right&&x+item.dw*state.scale>left&&y<bottom&&y+item.dh*state.scale>top;}).map(item=>item.id));}
  draw();
});
canvas.addEventListener('pointerup',(event)=>{
  const gesture=state.gesture;if(!gesture)return;state.gesture=null;canvas.classList.remove('dragging');
  if(gesture.kind==='item'&&!gesture.moved)open(gesture.item);
  if(gesture.kind==='marquee'){state.marquee=null;refreshSelectionToolbar();} draw();
});
canvas.addEventListener('pointercancel',()=>{state.gesture=null;state.marquee=null;canvas.classList.remove('dragging');canvas.style.cursor='grab';draw();});
canvas.addEventListener('pointerleave',()=>{if(!state.gesture&&state.hovered){state.hovered=null;draw();}});
canvas.addEventListener('contextmenu',(event)=>{event.preventDefault();const item=hit(event.clientX,event.clientY);if(item)pullFive(item);});
const drawWithPointerFeedback=draw;draw=function pointerFeedbackDraw(){drawWithPointerFeedback();if(!state.hovered||!visibleItems().includes(state.hovered))return;const item=state.hovered;ctx.save();ctx.strokeStyle='#e16d45';ctx.lineWidth=2;ctx.strokeRect(state.x+item.x*state.scale-3,state.y+item.y*state.scale-3,item.dw*state.scale+6,item.dh*state.scale+6);ctx.restore();};
const filterControls=document.createElement('div');filterControls.style.cssText='display:none;margin-top:8px;gap:5px;flex-wrap:wrap';filterControls.id='ai-filters';document.querySelector('#ai-status').after(filterControls);
function renderAiFilters(){
  const facesDone=state.items.some(item=>item.ai?.face!==undefined),peopleDone=state.items.some(item=>item.ai?.people!==undefined);if(!facesDone&&!peopleDone)return;
  const chip=(kind,value,label,active)=>`<button class="button" data-kind="${kind}" data-value="${value}" style="padding:4px 6px;font-size:10px;${active?'background:#1d1d1b;color:white':''}">${label}</button>`;
  filterControls.innerHTML=(facesDone?`<span style="width:100%;font:10px 'DM Mono';color:#777770">FACES</span>${chip('face','all','All',state.faceFilter==='all')}${chip('face','none','No face',state.faceFilter==='none')}${chip('face','one','1 face',state.faceFilter==='one')}${chip('face','many','2+ faces',state.faceFilter==='many')}`:'')+(peopleDone?`<span style="width:100%;font:10px 'DM Mono';color:#777770;margin-top:4px">PEOPLE</span>${chip('people','all','All',state.peopleFilter==='all')}${chip('people','none','No person',state.peopleFilter==='none')}${chip('people','one','1 person',state.peopleFilter==='one')}${chip('people','many','2+ people',state.peopleFilter==='many')}`:'');
  filterControls.style.display='flex';
  filterControls.querySelectorAll('[data-kind]').forEach(button=>button.onclick=()=>{state[button.dataset.kind==='face'?'faceFilter':'peopleFilter']=button.dataset.value;state.page=1;state.selected.clear();renderAiFilters();refreshSelectionToolbar();fit();});
}
$('#btn-reset-filters').onclick=()=>{state.faceFilter='all';state.peopleFilter='all';state.page=1;state.selected.clear();renderAiFilters();refreshSelectionToolbar();fit();};

function localDuplicateGroups(hashes, threshold=8) {
  const parent=hashes.map((_,i)=>i), root=i=>parent[i]===i?i:(parent[i]=root(parent[i]));
  for(let i=0;i<hashes.length;i++)for(let j=i+1;j<hashes.length;j++){const a=hashes[i],b=hashes[j];let distance=0;for(let k=0;k<a.length;k++)distance+=a[k]!==b[k];if(distance<=threshold)parent[root(i)]=root(j);}
  const groups=new Map();for(let i=0;i<parent.length;i++){const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i);}return[...groups.values()].filter(group=>group.length>1);
}
function drawThumb(canvasEl,item){const c=canvasEl.getContext('2d');c.clearRect(0,0,canvasEl.width,canvasEl.height);c.fillStyle='#eee';c.fillRect(0,0,canvasEl.width,canvasEl.height);const scale=Math.min(canvasEl.width/item.thumb.width||canvasEl.width/item.w,canvasEl.height/item.thumb.height||canvasEl.height/item.h);const w=(item.thumb.width||item.w)*scale,h=(item.thumb.height||item.h)*scale;c.drawImage(item.thumb,(canvasEl.width-w)/2,(canvasEl.height-h)/2,w,h);}
function renderDuplicateGroup(){
  const groups=state.duplicateGroups, index=state.duplicateIndex, host=$('#duplicate-candidates');host.innerHTML='';
  if(!groups.length){$('#duplicates-title').textContent='No close repeats found';$('#duplicates-copy').textContent='Your frames are already distinct at this image size.';$('#duplicate-progress').textContent='';$('#duplicate-next').textContent='Done';return;}
  if(index>=groups.length){$('#duplicates-title').textContent='Review complete';$('#duplicates-copy').textContent=`${groups.length} similar set${groups.length===1?'':'s'} reviewed. You can restore hidden frames at any time.`;$('#duplicate-progress').textContent='';$('#duplicate-next').textContent='Close';return;}
  const group=groups[index];$('#duplicates-title').textContent=`Set ${index+1} · ${group.length} similar frames`;$('#duplicates-copy').textContent='Choose the frame you want to keep in this set.';$('#duplicate-progress').textContent=`${index+1} of ${groups.length} sets`;$('#duplicate-next').textContent='Skip set';
  group.forEach(item=>{const card=document.createElement('article');card.className='candidate';const image=document.createElement('canvas');image.width=256;image.height=176;image.title='Open full resolution';image.style.cursor='zoom-in';drawThumb(image,item);image.onclick=()=>open(item);const name=document.createElement('div');name.className='candidate-name';name.textContent=item.name;const keep=document.createElement('button');keep.className='button';keep.textContent='Keep this frame';keep.onclick=()=>{group.forEach(other=>{other.duplicateHidden=other!==item;});item.duplicateHidden=false;item.duplicateKept=true;state.selected.clear();refreshSelectionToolbar();state.duplicateIndex++;$('#btn-restore-duplicates').hidden=false;$('#workflow-status').textContent=`${state.items.filter(i=>i.duplicateHidden).length} similar frames hidden. Nothing was deleted.`;state.page=1;fit();renderDuplicateGroup();};card.append(image,name,keep);host.append(card);});
}
$('#btn-find-duplicates').onclick=async()=>{
  if(state.items.length<2)return toast('Add at least two images first');const button=$('#btn-find-duplicates');button.disabled=true;$('#workflow-status').textContent='Comparing small image previews…';
  try{const hashes=state.items.map(item=>item.phash||perceptualHash(item.thumb));state.items.forEach((item,index)=>item.phash=hashes[index]);let groups;try{({groups}=await workerJob('duplicates',{hashes,threshold:8}));}catch{groups=localDuplicateGroups(hashes,8);}
    state.items.forEach(item=>delete item.duplicateGroup);state.duplicateGroups=groups.map((group,groupIndex)=>group.map(index=>{const item=state.items[index];item.duplicateGroup=groupIndex;return item;}));state.duplicateIndex=0;$('#workflow-status').textContent=groups.length?`${groups.length} similar set${groups.length===1?'':'s'} ready to review.`:'No close repeats found.';renderDuplicateGroup();$('#duplicates-dialog').showModal();
  }catch(error){console.error(error);toast('Could not compare these images');}finally{button.disabled=false;}
};
$('#duplicate-next').onclick=()=>{if(state.duplicateIndex>=state.duplicateGroups.length){$('#duplicates-dialog').close();return;}state.duplicateIndex++;renderDuplicateGroup();};
$('#btn-restore-duplicates').onclick=()=>{state.items.forEach(item=>{item.duplicateHidden=false;item.duplicateKept=false;delete item.duplicateGroup;});$('#btn-restore-duplicates').hidden=true;$('#workflow-status').textContent='All frames are back on the wall.';state.page=1;state.selected.clear();refreshSelectionToolbar();fit();};

async function ensureClipTextModel(){
  if(!AI.clip)throw new Error('Run image understanding first.');if(AI.clip.tokenizer&&AI.clip.textModel)return;
  aiStatus('Loading language matching part of CLIP…');const t=AI.clip.transformers,model='Xenova/clip-vit-base-patch32';
  [AI.clip.tokenizer,AI.clip.textModel]=await Promise.all([t.AutoTokenizer.from_pretrained(model),t.CLIPTextModelWithProjection.from_pretrained(model)]);
}
async function embedPrompt(prompt){await ensureClipTextModel();const tokens=AI.clip.tokenizer([`a photo of ${prompt}`],{padding:true,truncation:true});const result=await AI.clip.textModel(tokens),vec=Array.from(result.text_embeds.data);const norm=Math.hypot(...vec)||1;return vec.map(value=>value/norm);}
const carouselVibes=[
  {title:'Lively moments',prompt:'candid event photos full of movement, energy, laughter and engaged people',copy:'A lively sequence with action and crowd energy.'},
  {title:'Warm connections',prompt:'warm candid photos of people connecting, talking, smiling and sharing a moment',copy:'A people-first sequence with a human feel.'},
  {title:'Clean editorial',prompt:'a polished editorial photo story with strong composition, clear context and memorable details',copy:'A composed sequence with a clear visual rhythm.'}
];
function diverseCarousel(items,vector,count){const scored=items.map(item=>({item,relevance:cosine(item.embedding||item.features,vector)})).sort((a,b)=>b.relevance-a.relevance),chosen=[];while(chosen.length<count&&scored.length){let best=-Infinity,bestIndex=0;for(let i=0;i<scored.length;i++){const row=scored[i];if(row.item.duplicateHidden)continue;if(chosen.some(x=>x.item.id===row.item.id))continue;if(row.item.duplicateGroup!==undefined&&chosen.some(x=>x.item.duplicateGroup===row.item.duplicateGroup))continue;const novelty=chosen.length?Math.min(...chosen.map(x=>(1-cosine(row.item.embedding||row.item.features,x.item.embedding||x.item.features))/2)):0.5;const value=.78*((row.relevance+1)/2)+.22*novelty;if(value>best){best=value;bestIndex=i;}}if(best===-Infinity)break;chosen.push(scored[bestIndex]);scored.splice(bestIndex,1);}return chosen.map(row=>row.item);}
function renderDraftCards(drafts){const host=$('#carousel-drafts');host.innerHTML='';drafts.forEach(draft=>{const card=document.createElement('article');card.className='draft-card';const title=document.createElement('h3');title.textContent=draft.title;const copy=document.createElement('p');copy.textContent=draft.copy;const thumbs=document.createElement('div');thumbs.className='draft-thumbs';draft.items.forEach(item=>{const preview=document.createElement('canvas');preview.width=112;preview.height=112;preview.title='Open full resolution';preview.style.cursor='zoom-in';drawThumb(preview,item);preview.onclick=()=>open(item);thumbs.append(preview);});const action=document.createElement('button');action.className='button';action.textContent=`Arrange ${draft.items.length} slides on wall`;action.onclick=()=>openCarouselOnWall(draft);card.append(title,copy,thumbs,action);host.append(card);});}
async function generateCarouselDrafts(){const button=$('#btn-generate-drafts');button.disabled=true;button.textContent='Finding visual matches…';try{
  if(!state.items.every(item=>item.embedding)){const ok=await runClip();if(!ok)throw new Error('Image understanding did not finish.');}
  await ensureClipTextModel();const subject=$('#carousel-subject').value.trim(),count=Number($('#carousel-count').value),available=state.items.filter(item=>!item.duplicateHidden);const drafts=[];
  for(const vibe of carouselVibes){aiStatus(`Matching ${vibe.title.toLowerCase()}…`);const prompt=subject?`${vibe.prompt}; include ${subject}`:vibe.prompt,vector=await embedPrompt(prompt);drafts.push({...vibe,items:diverseCarousel(available,vector,count)});}
  if(drafts.some(draft=>draft.items.length===0))throw new Error('No image matches were ready.');renderDraftCards(drafts);$('#workflow-status').textContent='Three editable visual directions are ready. Gelato has not picked a winner.';aiStatus('Drafts made from your selected vibe and visual variety.');
}catch(error){console.error(error);toast(error.message||'Could not make carousel drafts');}finally{button.disabled=false;button.textContent='Make drafts';}}
function setDraftControlsDisabled(disabled){document.querySelectorAll('#layout-controls .layout').forEach(button=>button.disabled=disabled);$('#size-range').disabled=disabled;$('#toggle-captions').disabled=disabled;$('#toggle-tight').disabled=disabled;}
function openCarouselOnWall(draft){if(!draft.items.length)return;state.savedDraftPositions=new Map(state.items.map(item=>[item.id,{x:item.x,y:item.y,w:item.dw,h:item.dh}]));state.activeDraftIds=new Set(draft.items.map(item=>item.id));draft.items.forEach((item,index)=>{const d=imageSize(item);item.x=index*(d.w+gap());item.y=0;item.dw=d.w;item.dh=d.h;item.baseX=item.x;item.baseY=item.y;item.baseW=item.dw;item.baseH=item.dh;});state.selected.clear();refreshSelectionToolbar();state.hovered=null;setDraftControlsDisabled(true);$('#active-draft-name').textContent=`${draft.title} · ${draft.items.length} slides`;$('#active-draft-banner').hidden=false;state.page=1;$('#carousel-dialog').close();fitPage();}
$('#btn-draft-carousels').onclick=()=>{if(state.activeDraftIds)$('#btn-leave-draft').click();$('#carousel-dialog').showModal();if(!$('#carousel-drafts').children.length)$('#workflow-status').textContent='Choose an optional subject, then make three different visual directions.';};
$('#btn-generate-drafts').onclick=generateCarouselDrafts;
$('#btn-leave-draft').onclick=()=>{if(state.savedDraftPositions)for(const item of state.items){const point=state.savedDraftPositions.get(item.id);if(point){item.x=point.x;item.y=point.y;item.dw=point.w;item.dh=point.h;}}state.activeDraftIds=null;state.savedDraftPositions=null;setDraftControlsDisabled(false);$('#active-draft-banner').hidden=true;state.page=1;fit();};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$('#'+button.dataset.close).close());
