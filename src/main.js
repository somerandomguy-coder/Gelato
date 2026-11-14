const $ = (s) => document.querySelector(s);
const stage = $('#canvas-stage');
const itemsEl = $('#canvas-items');
const input = $('#image-input');
const folderInput = $('#folder-input');
const state = {
  scale: 1, panX: 0, panY: 0, items: [], selected: new Set(), activeTerritory: 'all',
  territories: [
    { id: 'human', name: 'Human, not polished', color: 'terr-a' },
    { id: 'editorial', name: 'Editorial confidence', color: 'terr-b' },
    { id: 'tactile', name: 'Tactile optimism', color: 'terr-c' },
    { id: 'unexpected', name: 'The unexpected detail', color: 'terr-d' }
  ],
  z: 1, gesture: null
};
let spaceDown = false;

const escape = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const territory = (id) => state.territories.find((entry) => entry.id === id) || state.territories[0];
const toast = (message) => { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); };

function render() {
  itemsEl.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
  $('.canvas-grid').style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
  $('#zoom-display').textContent = `${Math.round(state.scale * 100)}%`;
  $('#item-count').textContent = `${state.items.length} ITEM${state.items.length === 1 ? '' : 'S'}`;
  $('#empty-state').hidden = state.items.length > 0;
  $('#selection-toolbar').hidden = state.selected.size === 0;
  $('#selection-count').textContent = `${state.selected.size} selected`;
  renderTerritories();
  renderItems();
}

function renderTerritories() {
  const list = $('#territory-list');
  const allCount = state.items.length;
  list.innerHTML = `<button class="territory ${state.activeTerritory === 'all' ? 'active':''}" data-territory="all"><span class="legend-dot" style="background:#403c36"></span><span class="territory-name">All references</span><span class="territory-count">${allCount}</span></button>` + state.territories.map((entry) => {
    const count = state.items.filter((item) => item.territory === entry.id).length;
    return `<button class="territory ${state.activeTerritory === entry.id ? 'active':''}" data-territory="${entry.id}"><span class="legend-dot ${entry.color}"></span><span class="territory-name">${escape(entry.name)}</span><span class="territory-count">${count}</span></button>`;
  }).join('');
  list.querySelectorAll('[data-territory]').forEach((button) => button.addEventListener('click', () => {
    state.activeTerritory = button.dataset.territory;
    $('#active-territory-label').textContent = state.activeTerritory === 'all' ? 'All territories' : territory(state.activeTerritory).name;
    render();
  }));
}

function renderItems() {
  itemsEl.innerHTML = '';
  for (const item of state.items) {
    const visible = state.activeTerritory === 'all' || item.territory === state.activeTerritory;
    if (!visible) continue;
    const terr = territory(item.territory);
    const node = document.createElement('article');
    node.className = `canvas-item ${state.selected.has(item.id) ? 'selected' : ''}`;
    node.dataset.id = item.id;
    node.style.cssText = `left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;z-index:${item.z}`;
    if (item.type === 'note') {
      node.innerHTML = `<div class="item-note">${escape(item.text)}<span class="territory-pin ${terr.color}"></span></div>`;
    } else {
      node.innerHTML = `<div class="item-frame"><img src="${item.src}" alt="${escape(item.name)}" draggable="false"/><div class="item-meta"><span>${escape(item.name)}</span><span class="territory-pin ${terr.color}"></span></div></div>`;
      node.addEventListener('dblclick', () => openLightbox(item));
    }
    node.addEventListener('pointerdown', startItemGesture);
    itemsEl.append(node);
  }
}

function addItem(item) { state.items.push({ id: crypto.randomUUID(), z: ++state.z, territory: state.territories[state.items.length % state.territories.length].id, ...item }); render(); }
function addImages(files, { birdseye = false } = {}) {
  const images = [...files].filter((file) => file.type.startsWith('image/'));
  if (!images.length) return toast('That folder has no supported image files');
  const columns = Math.max(3, Math.ceil(Math.sqrt(images.length * 1.45)));
  const tile = images.length > 80 ? 140 : images.length > 30 ? 165 : 205;
  const startIndex = state.items.length;
  let complete = 0;
  images.forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = () => {
      const position = startIndex + index;
      addItem({
        type: 'image', name: file.name.replace(/\.[^.]+$/, ''), src: reader.result,
        x: 100 + (position % columns) * (tile + 28), y: 90 + Math.floor(position / columns) * (tile + 46),
        w: tile, h: tile, sourcePath: file.webkitRelativePath || file.name
      });
      complete += 1;
      if (birdseye && complete === images.length) requestAnimationFrame(fit);
    };
    reader.readAsDataURL(file);
  });
  toast(`${images.length} reference${images.length === 1 ? '' : 's'} added locally${birdseye ? ' · bird’s-eye view ready' : ''}`);
}

function startItemGesture(event) {
  event.stopPropagation();
  const id = event.currentTarget.dataset.id;
  if (!event.shiftKey && !state.selected.has(id)) state.selected = new Set([id]);
  else if (event.shiftKey) state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  const selectedItems = state.items.filter((item) => state.selected.has(item.id));
  selectedItems.forEach((item) => item.z = ++state.z);
  state.gesture = { type: 'move', startX: event.clientX, startY: event.clientY, origins: selectedItems.map((item) => ({ id:item.id, x:item.x, y:item.y })) };
  event.currentTarget.setPointerCapture(event.pointerId);
  render();
}

function worldPoint(clientX, clientY) { const rect = stage.getBoundingClientRect(); return { x:(clientX - rect.left - state.panX) / state.scale, y:(clientY - rect.top - state.panY) / state.scale }; }
function selectionRect() { const g = state.gesture; return { x:Math.min(g.startX,g.nowX), y:Math.min(g.startY,g.nowY), w:Math.abs(g.nowX-g.startX), h:Math.abs(g.nowY-g.startY) }; }
function updateMarquee() { const r = selectionRect(), el = $('#marquee'); Object.assign(el.style, { left:`${r.x}px`, top:`${r.y}px`, width:`${r.w}px`, height:`${r.h}px` }); el.hidden = false; }

stage.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('.canvas-item')) return;
  stage.setPointerCapture(event.pointerId);
  state.gesture = { type: event.shiftKey || spaceDown ? 'pan' : 'pending', startX:event.clientX, startY:event.clientY, panX:state.panX, panY:state.panY, nowX:event.clientX, nowY:event.clientY };
});
stage.addEventListener('pointermove', (event) => {
  const g = state.gesture; if (!g) return;
  if (g.type === 'move') { const dx=(event.clientX-g.startX)/state.scale, dy=(event.clientY-g.startY)/state.scale; g.origins.forEach((origin) => { const item=state.items.find((x) => x.id===origin.id); item.x=Math.round(origin.x+dx); item.y=Math.round(origin.y+dy); }); renderItems(); return; }
  const dx=event.clientX-g.startX, dy=event.clientY-g.startY;
  if (g.type === 'pending' && Math.hypot(dx,dy) > 5) { g.type = 'marquee'; state.selected.clear(); }
  if (g.type === 'pan') { state.panX=g.panX+dx; state.panY=g.panY+dy; stage.classList.add('is-panning'); render(); }
  if (g.type === 'marquee') { g.nowX=event.clientX; g.nowY=event.clientY; updateMarquee(); const rect=selectionRect(); const base=stage.getBoundingClientRect(); state.selected=new Set(state.items.filter((item) => { const x=base.left+state.panX+item.x*state.scale, y=base.top+state.panY+item.y*state.scale; return x < rect.x+rect.w && x+item.w*state.scale > rect.x && y < rect.y+rect.h && y+item.h*state.scale > rect.y; }).map((item)=>item.id)); renderItems(); }
});
stage.addEventListener('pointerup', () => { if (state.gesture?.type === 'pending') state.selected.clear(); state.gesture=null; $('#marquee').hidden=true; stage.classList.remove('is-panning'); render(); });
stage.addEventListener('wheel', (event) => { event.preventDefault(); const old=state.scale, factor=event.deltaY < 0 ? 1.12 : .89, next=Math.max(.35,Math.min(2.5,old*factor)); const rect=stage.getBoundingClientRect(), x=event.clientX-rect.left, y=event.clientY-rect.top; state.panX=x-(x-state.panX)*(next/old); state.panY=y-(y-state.panY)*(next/old); state.scale=next; render(); }, { passive:false });

function zoom(amount) { state.scale=Math.max(.35,Math.min(2.5,state.scale*amount)); render(); }
function fit() { if (!state.items.length) { state.scale=1; state.panX=0; state.panY=0; return render(); } const minX=Math.min(...state.items.map((i)=>i.x)), minY=Math.min(...state.items.map((i)=>i.y)), maxX=Math.max(...state.items.map((i)=>i.x+i.w)), maxY=Math.max(...state.items.map((i)=>i.y+i.h)); const rect=stage.getBoundingClientRect(), scale=Math.min((rect.width-120)/(maxX-minX),(rect.height-100)/(maxY-minY),1); state.scale=Math.max(.35,scale); state.panX=(rect.width-(maxX-minX)*state.scale)/2-minX*state.scale; state.panY=(rect.height-(maxY-minY)*state.scale)/2-minY*state.scale; render(); }
function openLightbox(item) { $('#lightbox-image').src=item.src; $('#lightbox-caption').textContent=`${item.name} · ${territory(item.territory).name}`; $('#lightbox').showModal(); }

function renderNotes() { $('#note-count').textContent=state.items.filter((item)=>item.type==='note').length; $('#notes-list').innerHTML=state.items.filter((item)=>item.type==='note').map((item)=>`<div class="note">${escape(item.text)}<button data-note="${item.id}" title="Remove note">×</button></div>`).join(''); $('#notes-list').querySelectorAll('[data-note]').forEach((button)=>button.addEventListener('click',()=>{state.items=state.items.filter((item)=>item.id!==button.dataset.note);renderNotes();render();})); }
function addNote() { const text=prompt('What do you want to remember about this direction?'); if (text?.trim()) { addItem({type:'note',text:text.trim(),x:230+state.items.length*16,y:180+state.items.length*18,w:190,h:120}); renderNotes(); } }
function demoSvg(color, accent, word) { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="480" viewBox="0 0 600 480"><rect width="600" height="480" fill="${color}"/><circle cx="420" cy="150" r="130" fill="${accent}" opacity=".85"/><path d="M0 370C150 275 280 505 600 320V480H0Z" fill="#ffffff" opacity=".45"/><text x="45" y="85" fill="#24221f" font-family="serif" font-size="42" font-style="italic">${word}</text></svg>`)}`; }
function loadDemo() { if (state.items.length && !confirm('Replace the current board with the example direction?')) return; state.items=[]; state.selected.clear(); const refs=[['#e7bd91','#d66948','Small rituals'],['#a9bec1','#53798a','At your pace'],['#d9d0b4','#748261','Field notes'],['#cdbccc','#875e78','Soft strength'],['#272729','#dfbd5e','Make it matter']]; refs.forEach(([color,accent,name],index)=>addItem({type:'image',name,src:demoSvg(color,accent,name),x:150+(index%3)*245,y:100+Math.floor(index/3)*250,w:210,h:210,territory:state.territories[index%4].id})); addItem({type:'note',text:'Not a mood. A point of view people can recognise before they can name it.',x:420,y:370,w:205,h:125,territory:'human'}); renderNotes(); fit(); toast('Example direction loaded'); }

$('#btn-add-images').onclick=()=>input.click(); $('#btn-empty-add').onclick=()=>input.click(); input.onchange=(e)=>{addImages(e.target.files); input.value='';};
$('#btn-add-folder').onclick=()=>folderInput.click(); $('#btn-empty-folder').onclick=()=>folderInput.click(); folderInput.onchange=(e)=>{addImages(e.target.files,{birdseye:true}); folderInput.value='';}; $('#btn-load-demo').onclick=loadDemo;
$('#btn-zoom-in').onclick=()=>zoom(1.2); $('#btn-zoom-out').onclick=()=>zoom(.83); $('#btn-fit').onclick=fit;
$('#btn-add-note').onclick=addNote; $('#btn-close-lightbox').onclick=()=>$('#lightbox').close();
$('#btn-delete-selection').onclick=()=>{state.items=state.items.filter((item)=>!state.selected.has(item.id));state.selected.clear();renderNotes();render();};
$('#btn-bring-front').onclick=()=>{state.items.filter((item)=>state.selected.has(item.id)).forEach((item)=>item.z=++state.z);render();};
$('#btn-tag-selection').onclick=()=>{const names=state.territories.map((t,i)=>`${i+1}. ${t.name}`).join('\n');const pick=Number(prompt(`Move selected references to which territory?\n${names}`));if(pick>=1&&pick<=state.territories.length){state.items.filter((item)=>state.selected.has(item.id)).forEach((item)=>item.territory=state.territories[pick-1].id);render();}};
$('#btn-clear').onclick=()=>{if(state.items.length&&confirm('Clear every reference from this board?')){state.items=[];state.selected.clear();renderNotes();render();}};
$('#btn-add-territory').onclick=()=>{const name=prompt('Name this territory');if(name?.trim()){state.territories.push({id:crypto.randomUUID(),name:name.trim(),color:['terr-a','terr-b','terr-c','terr-d'][state.territories.length%4]});render();}};
$('#btn-collapse').onclick=()=>{ $('#sidebar').classList.toggle('is-collapsed'); setTimeout(fit,260); };
$('#btn-help').onclick=()=>toast('Drag references to compose. Drag empty space to pan. Scroll to zoom.');
$('#btn-export').onclick=()=>{const snapshot={title:$('#project-title').value,brief:$('#brief-title').textContent,territories:state.territories,items:state.items.map(({src,...item})=>({...item,hasLocalImage:Boolean(src)}))};const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='brand-atlas-project.json';a.click();URL.revokeObjectURL(url);toast('Project snapshot exported');};
$('#btn-edit-brief').onclick=()=>{ $('#brief-input-title').value=$('#brief-title').textContent;$('#brief-input-copy').value=$('#brief-copy').textContent;$('#brief-input-tags').value=[...$('#brief-pills').children].map((x)=>x.textContent).join(', ');$('#brief-dialog').showModal();};
$('#brief-form').addEventListener('submit',(event)=>{if(event.submitter?.value==='cancel')return;$('#brief-title').textContent=$('#brief-input-title').value;$('#brief-copy').textContent=$('#brief-input-copy').value;$('#brief-pills').innerHTML=$('#brief-input-tags').value.split(',').filter(Boolean).map((t)=>`<span>${escape(t.trim())}</span>`).join('');});
document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&state.selected.size){state.selected.clear();render();}if(event.key===' '&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){spaceDown=true;event.preventDefault();}});
document.addEventListener('keyup',(event)=>{if(event.key===' ')spaceDown=false;});
document.addEventListener('dragover',(event)=>event.preventDefault());stage.addEventListener('drop',(event)=>{event.preventDefault();addImages(event.dataTransfer.files);});
renderNotes(); render();
