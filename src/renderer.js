'use strict';
/* ================================================================
   Exploring Motion — editor core (renderer)
   Original clean-room implementation.
   Architecture lessons credited in docs/ANALYSIS-AND-SPEC.md:
   Fabric.js object canvas (as in Motionity, MIT) + per-property
   keyframe tracks with a cubic-bezier easing solver + a real
   camera layer with depth parallax (our own design).
   ================================================================ */

/* ---------------- easing: cubic-bezier solver ---------------- */
function cubicBezier(x1, y1, x2, y2) {
  // Returns f(u) for u in [0,1]; solves x(t)=u then returns y(t).
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t;
  const sy = t => ((ay * t + by) * t + cy) * t;
  const dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return function (u) {
    if (u <= 0) return 0; if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 6; i++) {
      const err = sx(t) - u; if (Math.abs(err) < 1e-5) return sy(t);
      const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= err / d;
    }
    let lo = 0, hi = 1; t = u;
    while (hi - lo > 1e-5) { if (sx(t) < u) lo = t; else hi = t; t = (lo + hi) / 2; }
    return sy(t);
  };
}
const easeCache = new Map();
function easeFn(ease) {
  const key = ease ? ease.join(',') : 'lin';
  if (!easeCache.has(key)) easeCache.set(key, ease ? cubicBezier(...ease) : (u => u));
  return easeCache.get(key);
}

/* ---------------- project model ---------------- */
let uidSeq = 1;
const uid = () => 'L' + (uidSeq++);
const REF_DIST = 1663; // reference camera distance (matches Alight's default feel)

function baseProps(type, W, H) {
  if (type === 'camera') return { x: W / 2, y: H / 2, z: -REF_DIST, focus: 0, dof: 0, fog: 0 };
  return { x: W / 2, y: H / 2, scale: 1, rotation: 0, opacity: 1 };
}
function makeLayer(type, name, extra = {}) {
  return Object.assign({
    id: uid(), type, name,
    start: 0, duration: 6, visible: true, locked: false,
    parentId: null, depth: 0, fov: 60,
    props: null, tracks: {},
    fill: '#00c853', text: '', fontSize: 90, fontFamily: 'Cairo', src: null, w: 0, h: 0
  }, extra);
}
function demoProject() {
  uidSeq = 1;
  const W = 1920, H = 1080;
  const p = { name: 'Parallax demo', width: W, height: H, fps: 60, duration: 6, background: '#e8f1ea', layers: [] };
  const orb = makeLayer('shape-circle', 'Orb (depth 0)');
  orb.fill = '#00d563'; orb.props = baseProps(orb.type, W, H);
  orb.tracks = {
    x: [{ t: 0, v: 420, ease: [0.42, 0, 0.58, 1] }, { t: 4, v: 1380, ease: null }, { t: 6, v: 1380, ease: null }],
    y: [{ t: 0, v: 560, ease: [0.42, 0, 0.58, 1] }, { t: 3, v: 380, ease: [0.42, 0, 0.58, 1] }, { t: 6, v: 560, ease: null }],
    scale: [{ t: 0, v: 1, ease: [0.42, 0, 0.58, 1] }, { t: 3, v: 1.5, ease: [0.42, 0, 0.58, 1] }, { t: 6, v: 1, ease: null }]
  };
  const title = makeLayer('text', 'Title (depth 300)');
  title.text = 'EXPLORING MOTION'; title.fontSize = 120; title.fontFamily = 'Gram'; title.fill = '#1d2436'; title.depth = 300;
  title.props = baseProps(title.type, W, H); title.props.y = 300;
  title.tracks = { opacity: [{ t: 0, v: 0, ease: [0, 0, 0.58, 1] }, { t: 1.2, v: 1, ease: null }] };
  const card = makeLayer('shape-rect', 'Far card (depth 900)');
  card.fill = '#9db8a4'; card.depth = 900; card.w = 900; card.h = 520;
  card.props = baseProps(card.type, W, H); card.props.x = 1250; card.props.y = 620;
  const cam = makeLayer('camera', 'Camera 1');
  cam.props = baseProps('camera', W, H);
  cam.tracks = { x: [{ t: 0, v: 960, ease: [0.42, 0, 0.58, 1] }, { t: 6, v: 1330, ease: null }] };
  p.layers = [orb, title, card, cam]; // index 0 = front
  return p;
}

/* ---------------- evaluation ---------------- */
function evalProp(layer, prop, t) {
  const track = layer.tracks[prop];
  const base = layer.props[prop];
  if (!track || !track.length) return base;
  if (t <= track[0].t) return track[0].v;
  const last = track[track.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * easeFn(a.ease)(u);
    }
  }
  return base;
}
function activeCamera(project, t) {
  for (const l of project.layers) {
    if (l.type === 'camera' && l.visible && t >= l.start && t <= l.start + l.duration) return l;
  }
  return null;
}
/* Perspective factor for a layer at depth d seen by a camera at distance D.
   m = REF / (D + d): sizes and offsets share it -> true parallax. */
function persp(D, d) { return REF_DIST / (D + d); }

/* ---------------- app state ---------------- */
const state = {
  project: demoProject(),
  time: 0, playing: false,
  selectedId: null, pxPerSec: 120,
  applying: false
};
const $ = s => document.querySelector(s);
const canvas = new fabric.Canvas('cv', { preserveObjectStacking: true, backgroundColor: '#dfe7f0' });
const objByLayer = new Map();

function selectedLayer() { return state.project.layers.find(l => l.id === state.selectedId) || null; }

/* ---------------- world transforms (parenting) ----------------
   A layer's local props are relative to its parent (Null / Group /
   Camera / any layer). world = parentWorld o local, recursively. */
function computeWorld(layer, t, cache) {
  cache = cache || new Map();
  if (cache.has(layer.id)) return cache.get(layer.id);
  const w = {
    x: evalProp(layer, 'x', t), y: evalProp(layer, 'y', t),
    scale: evalProp(layer, 'scale', t), rot: evalProp(layer, 'rotation', t) || 0,
    opacity: evalProp(layer, 'opacity', t)
  };
  cache.set(layer.id, w); // provisional (cycle guard)
  const parent = layer.parentId ? state.project.layers.find(q => q.id === layer.parentId) : null;
  if (parent && parent.id !== layer.id) {
    const pw = computeWorld(parent, t, cache);
    const rad = pw.rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    w.x = pw.x + (w.x * cos - w.y * sin) * pw.scale;
    w.y = pw.y + (w.x * sin + w.y * cos) * pw.scale;
    w.scale = pw.scale * w.scale;
    w.rot = pw.rot + w.rot;
    w.opacity = Math.max(0, Math.min(1, pw.opacity * w.opacity));
    cache.set(layer.id, w);
  }
  return w;
}
function ancestorsVisible(layer) {
  let cur = layer, guard = 0;
  while (cur && guard++ < 32) {
    if (!cur.visible) return false;
    cur = cur.parentId ? state.project.layers.find(q => q.id === cur.parentId) : null;
  }
  return true;
}
function isDescendantOf(layer, ancestorId) {
  let cur = layer, guard = 0;
  while (cur && cur.parentId && guard++ < 32) {
    if (cur.parentId === ancestorId) return true;
    cur = state.project.layers.find(q => q.id === cur.parentId);
  }
  return false;
}
/* Re-express a layer's transform (base + every keyframe) by a delta so its
   world transform stays identical across a parent change. */
function shiftTransform(layer, dx, dy, scaleRatio, dRot, opRatio) {
  layer.props.x = (layer.props.x || 0) + dx; layer.props.y = (layer.props.y || 0) + dy;
  for (const k of (layer.tracks.x || [])) k.v += dx;
  for (const k of (layer.tracks.y || [])) k.v += dy;
  layer.props.scale = (layer.props.scale == null ? 1 : layer.props.scale) * scaleRatio;
  for (const k of (layer.tracks.scale || [])) k.v *= scaleRatio;
  layer.props.rotation = (layer.props.rotation || 0) + dRot;
  for (const k of (layer.tracks.rotation || [])) k.v += dRot;
  layer.props.opacity = (layer.props.opacity == null ? 1 : layer.props.opacity) * opRatio;
  for (const k of (layer.tracks.opacity || [])) k.v *= opRatio;
}
function setParent(layer, parentId) {
  const t = state.time;
  const curWorld = computeWorld(layer, t, new Map());
  const curLocal = { x: evalProp(layer, 'x', t), y: evalProp(layer, 'y', t),
    scale: evalProp(layer, 'scale', t), rot: evalProp(layer, 'rotation', t) || 0, opacity: evalProp(layer, 'opacity', t) };
  let target = curWorld;
  if (parentId) {
    const parent = state.project.layers.find(q => q.id === parentId);
    const pw = computeWorld(parent, t, new Map());
    const rad = -pw.rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = (curWorld.x - pw.x) / pw.scale, dy = (curWorld.y - pw.y) / pw.scale;
    target = { x: dx * cos - dy * sin, y: dx * sin + dy * cos,
      scale: pw.scale ? curWorld.scale / pw.scale : curWorld.scale,
      rot: curWorld.rot - pw.rot, opacity: pw.opacity ? curWorld.opacity / pw.opacity : curWorld.opacity };
  }
  shiftTransform(layer, target.x - curLocal.x, target.y - curLocal.y,
    curLocal.scale ? target.scale / curLocal.scale : 1, target.rot - curLocal.rot,
    curLocal.opacity ? target.opacity / curLocal.opacity : 1);
  layer.parentId = parentId || null;
  applyTime(t); buildProps(); buildLayerList();
}

/* ---------------- fabric scene ---------------- */
function polyPts(n, R) { const pts = []; for (let i = 0; i < n; i++) { const a = (2 * Math.PI / n) * i - Math.PI / 2; pts.push({ x: R * Math.cos(a), y: R * Math.sin(a) }); } return pts; }
function starPts(spikes, R, r) { const pts = []; const total = spikes * 2; for (let i = 0; i < total; i++) { const rad = i % 2 === 0 ? R : r, a = (Math.PI / spikes) * i - Math.PI / 2; pts.push({ x: rad * Math.cos(a), y: rad * Math.sin(a) }); } return pts; }
function makeObject(layer) {
  const common = { originX: 'center', originY: 'center', objectCaching: false };
  let o = null;
  if (layer.type === 'shape-rect') o = new fabric.Rect(Object.assign(common, { width: 340, height: 220, fill: layer.fill, rx: 26, ry: 26 }));
  else if (layer.type === 'shape-circle') o = new fabric.Circle(Object.assign(common, { radius: 130, fill: layer.fill }));
  else if (layer.type === 'text') o = new fabric.Textbox(layer.text || 'Text', Object.assign(common, { fontSize: layer.fontSize || 90, fill: layer.fill, fontFamily: (layer.fontFamily || 'Cairo') + ', Cairo, sans-serif', fontWeight: 700, textAlign: 'center', width: 1100 }));
  else if (layer.type === 'shape-triangle') o = new fabric.Polygon(polyPts(3, 150), Object.assign(common, { fill: layer.fill }));
  else if (layer.type === 'shape-pentagon') o = new fabric.Polygon(polyPts(5, 150), Object.assign(common, { fill: layer.fill }));
  else if (layer.type === 'shape-star') o = new fabric.Polygon(starPts(5, 160, 68), Object.assign(common, { fill: layer.fill }));
  else if (layer.type === 'shape-spark') o = new fabric.Polygon(starPts(4, 150, 34), Object.assign(common, { fill: layer.fill }));
  else if (layer.type === 'shape-heart') o = new fabric.Path('M 0 42 C -52 12 -34 -30 0 -12 C 34 -30 52 12 0 42 Z', Object.assign(common, { fill: layer.fill, scaleX: 2.6, scaleY: 2.6 }));
  else if (layer.type === 'shape-arrow') o = new fabric.Path('M -90 0 L 40 0 M 12 -30 L 46 0 L 12 30', Object.assign(common, { fill: '', stroke: layer.fill, strokeWidth: 17, strokeLineCap: 'round', strokeLineJoin: 'round' }));
  else if (layer.type === 'null') {
    o = new fabric.Group([
      new fabric.Line([-26, 0, 26, 0], { stroke: '#00b248', strokeWidth: 3, originX: 'center', originY: 'center' }),
      new fabric.Line([0, -26, 0, 26], { stroke: '#00b248', strokeWidth: 3, originX: 'center', originY: 'center' }),
      new fabric.Circle({ radius: 9, fill: 'transparent', stroke: '#00b248', strokeWidth: 3, originX: 'center', originY: 'center' })
    ], common);
  }
  else if (layer.type === 'group') {
    o = new fabric.Group([
      new fabric.Rect({ width: 150, height: 96, fill: 'rgba(0,200,83,0.07)', stroke: '#00b248', strokeWidth: 2, strokeDashArray: [8, 6], originX: 'center', originY: 'center' }),
      new fabric.Text('GROUP', { fontSize: 20, fill: '#0d8a3a', fontFamily: 'Gram, sans-serif', fontWeight: 700, originX: 'center', originY: 'center' })
    ], common);
  }
  else if (layer.type === 'video' && layer.src) {
    const el = videoElFor(layer);
    o = new fabric.Image(el, Object.assign(common, { objectCaching: false }));
    if (el.videoWidth) o.set({ width: el.videoWidth, height: el.videoHeight });
    else el.addEventListener('loadedmetadata', () => {
      const oo = objByLayer.get(layer.id);
      if (oo && el.videoWidth) { oo.set({ width: el.videoWidth, height: el.videoHeight }); layer.w = el.videoWidth; layer.h = el.videoHeight; oo.dirty = true; applyTime(state.time); }
    }, { once: true });
  }
  else if (layer.type === 'image' && layer.src) {
    o = new fabric.Rect(Object.assign(common, { width: 480, height: 270, fill: '#333' })); // placeholder until load
    fabric.Image.fromURL(layer.src, img => {
      const cur = objByLayer.get(layer.id);
      if (cur) { canvas.remove(cur); }
      img.set(common); applyMaskTo(img, layer); objByLayer.set(layer.id, img); canvas.add(img); stackObjects(); applyTime(state.time);
    });
  }
  if (o) { o.__layerId = layer.id; applyMaskTo(o, layer); }
  return o;
}
function applyMaskTo(o, layer) {
  if (!layer.maskShape || layer.maskShape === 'none') return;
  const gw = o.getScaledWidth ? o.getScaledWidth() : 400;
  const gh = o.getScaledHeight ? o.getScaledHeight() : 300;
  if (!gw || !gh) return;
  let clip = null;
  if (layer.maskShape === 'rect') clip = new fabric.Rect({ width: gw * 0.8, height: gh * 0.8, originX: 'center', originY: 'center' });
  else clip = new fabric.Ellipse({ rx: gw * 0.42, ry: gh * 0.42, originX: 'center', originY: 'center' });
  clip.inverted = !!layer.maskInvert;
  o.clipPath = clip;
}
function stackObjects() {
  const visual = state.project.layers.filter(l => objByLayer.has(l.id)); // front -> back
  visual.forEach((l, rank) => { canvas.moveTo(objByLayer.get(l.id), 1 + (visual.length - 1 - rank)); });
  if (bgRect) canvas.moveTo(bgRect, 0);
}
let bgRect = null;
function fitStage() {
  if (state.exporting) return;
  const stage = $('#stage');
  const sw = stage.clientWidth, sh = stage.clientHeight;
  if (sw < 50 || sh < 50) return;
  canvas.setWidth(sw); canvas.setHeight(sh);
  const W = state.project.width, H = state.project.height;
  const fit = Math.min(sw / W, sh / H) * 0.94;
  canvas.setViewportTransform([fit, 0, 0, fit, (sw - W * fit) / 2, (sh - H * fit) / 2]);
  canvas.requestRenderAll();
}
new ResizeObserver(() => fitStage()).observe($('#stage'));

function rebuildScene() {
  canvas.clear(); objByLayer.clear();
  const p = state.project;
  for (const [id, el] of [...videoEls]) if (!p.layers.find(l => l.id === id)) { try { el.pause(); } catch (e) {} videoEls.delete(id); }
  for (const [id, el] of [...audioEls]) if (!p.layers.find(l => l.id === id)) { try { el.pause(); } catch (e) {} audioEls.delete(id); }
  bgRect = new fabric.Rect({
    left: 0, top: 0, width: p.width, height: p.height, fill: p.background,
    selectable: false, evented: false, originX: 'left', originY: 'top'
  });
  canvas.add(bgRect);
  for (const layer of [...p.layers].reverse()) {
    if (layer.type === 'camera' || layer.type === 'audio') continue;
    const o = makeObject(layer);
    if (o) { o.selectable = !layer.locked; o.evented = !layer.locked; objByLayer.set(layer.id, o); canvas.add(o); }
  }
  stackObjects(); fitStage(); applyTime(state.time);
}

function applyTime(t) {
  state.applying = true;
  const p = state.project, W = p.width, H = p.height;
  const cam = activeCamera(p, t);
  let camX = W / 2, camY = H / 2, D = REF_DIST;
  const wcache = new Map();
  if (cam) { const cw = computeWorld(cam, t, wcache); camX = cw.x; camY = cw.y; D = Math.max(60, -evalProp(cam, 'z', t)); }
  for (const layer of p.layers) {
    const o = objByLayer.get(layer.id); if (!o) continue;
    const inSpan = t >= layer.start && t <= layer.start + layer.duration;
    const m = persp(D, layer.depth || 0);
    const w = computeWorld(layer, t, wcache);
    o.set({
      left: W / 2 + (w.x - camX) * m,
      top: H / 2 + (w.y - camY) * m,
      scaleX: w.scale * m,
      scaleY: w.scale * m,
      angle: w.rot,
      opacity: w.opacity,
      globalCompositeOperation: layer.blend || 'source-over',
      visible: inSpan && ancestorsVisible(layer)
    });
    o.setCoords();
  }
  drawGraph();
  for (const layer of p.layers) maybeRaster(layer, t);
  canvas.requestRenderAll();
  state.applying = false;
  $('#camInfo').textContent = cam ? `Camera: ${cam.name} · D=${Math.round(D)} · pan ${Math.round(camX - W / 2)}px` : 'No active camera';
  syncMedia(t);
  positionClipTools();
  updatePlayhead();
}

/* Write a property value at time t following the keyframe rules:
   existing key at t -> update it; track exists -> insert key; else set base. */
function setValueAtTime(layer, prop, v, t) {
  const track = layer.tracks[prop];
  if (track && track.length) {
    const hit = track.find(k => Math.abs(k.t - t) < 0.021);
    if (hit) hit.v = v;
    else { track.push({ t, v, ease: currentEase() }); track.sort((a, b) => a.t - b.t); }
  } else layer.props[prop] = v;
}
function currentEase() {
  const v = $('#easePreset').value.split(',').map(Number);
  return (v[0] === 0 && v[1] === 0 && v[2] === 1 && v[3] === 1) ? null : v;
}
function keyAt(layer, prop, t) { const tr = layer.tracks[prop]; return tr ? tr.find(k => Math.abs(k.t - t) < 0.021) : null; }


/* ---------------- history (undo / redo) ---------------- */
let undoStack = [], redoStack = [], dragSnap = null;
function snap() { return JSON.stringify(state.project); }
function commit() { undoStack.push(snap()); if (undoStack.length > 60) undoStack.shift(); redoStack = []; syncUndoBtns(); }
function syncUndoBtns() { const u = $('#btnUndo'), r = $('#btnRedo'); if (u) u.disabled = !undoStack.length; if (r) r.disabled = !redoStack.length; }
function restoreProject(json) { state.project = JSON.parse(json); state.selectedId = state.project.layers.length ? state.project.layers[0].id : null; state.time = 0; $('#projName').value = state.project.name || 'Project'; afterProjectLoad(); }
function doUndo() { if (!undoStack.length) return; redoStack.push(snap()); restoreProject(undoStack.pop()); syncUndoBtns(); }
function doRedo() { if (!redoStack.length) return; undoStack.push(snap()); restoreProject(redoStack.pop()); syncUndoBtns(); }
canvas.on('mouse:down', e => { dragSnap = e.target ? snap() : null; });

/* ---------------- canvas interactions ---------------- */
canvas.on('selection:created', e => { if (e.selected && e.selected[0]) selectLayer(e.selected[0].__layerId, false); });
canvas.on('selection:updated', e => { if (e.selected && e.selected[0]) selectLayer(e.selected[0].__layerId, false); });
canvas.on('selection:cleared', () => selectLayer(null, false));
canvas.on('object:modified', e => {
  if (state.applying) return;
  if (dragSnap && dragSnap !== snap()) { undoStack.push(dragSnap); if (undoStack.length > 60) undoStack.shift(); redoStack = []; syncUndoBtns(); }
  dragSnap = null;
  const o = e.target; const layer = state.project.layers.find(l => l.id === o.__layerId); if (!layer) return;
  const p = state.project, cam = activeCamera(p, state.time);
  let camX = p.width / 2, camY = p.height / 2, D = REF_DIST;
  if (cam) { const cw = computeWorld(cam, state.time, new Map()); camX = cw.x; camY = cw.y; D = Math.max(60, -evalProp(cam, 'z', state.time)); }
  const m = persp(D, layer.depth || 0);
  const t = state.time;
  let wx = camX + (o.left - p.width / 2) / m;
  let wy = camY + (o.top - p.height / 2) / m;
  let ws = (o.scaleX || 1) / m, wr = o.angle || 0;
  const parent = layer.parentId ? p.layers.find(q => q.id === layer.parentId) : null;
  if (parent) {
    const pw = computeWorld(parent, t, new Map());
    const rad = -pw.rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = (wx - pw.x) / pw.scale, dy = (wy - pw.y) / pw.scale;
    const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
    setValueAtTime(layer, 'x', lx, t);
    setValueAtTime(layer, 'y', ly, t);
    setValueAtTime(layer, 'scale', pw.scale ? ws / pw.scale : ws, t);
    setValueAtTime(layer, 'rotation', wr - pw.rot, t);
  } else {
    setValueAtTime(layer, 'x', wx, t);
    setValueAtTime(layer, 'y', wy, t);
    setValueAtTime(layer, 'scale', ws, t);
    setValueAtTime(layer, 'rotation', wr, t);
  }
  applyTime(t); buildProps(); buildTimelineRows();
});

/* ---------------- layer list ---------------- */
function buildLayerList() {
  const el = $('#layerList'); el.innerHTML = '';
  $('#layerCount').textContent = `· ${state.project.layers.length}`;
  for (const layer of state.project.layers) {
    const row = document.createElement('div');
    row.className = 'layer-row' + (layer.id === state.selectedId ? ' sel' : '') + (layer.type === 'camera' ? ' cam' : '');
    let depth = 0, anc = layer;
    while (anc.parentId && depth < 6) { depth++; anc = state.project.layers.find(q => q.id === anc.parentId) || {}; }
    row.style.marginLeft = (depth * 16) + 'px';
    const kids = state.project.layers.filter(q => q.parentId === layer.id).length;
    row.innerHTML = `<span class="eye ${layer.visible ? '' : 'off'}">${layer.visible ? '◉' : '○'}</span>
      <span class="lock ${layer.locked ? 'on' : ''}" title="Lock layer">${layer.locked ? '▣' : '▢'}</span>
      <span class="nm">${layer.name}</span><span class="tp">${layer.type.replace('shape-', '').toUpperCase()}${kids ? ' · ' + kids + ' CHILD' : ''}${layer.parentId ? ' · CHILD' : ''}</span>`;
    row.querySelector('.eye').addEventListener('click', ev => { ev.stopPropagation(); commit(); layer.visible = !layer.visible; buildLayerList(); applyTime(state.time); });
    row.querySelector('.lock').addEventListener('click', ev => {
      ev.stopPropagation(); commit(); layer.locked = !layer.locked;
      const o = objByLayer.get(layer.id); if (o) { o.selectable = !layer.locked; o.evented = !layer.locked; }
      buildLayerList();
    });
    row.addEventListener('click', () => selectLayer(layer.id, true));
    row.draggable = true;
    row.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/layer-id', layer.id); row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', ev => { ev.preventDefault(); row.classList.add('dragover'); });
    row.addEventListener('dragleave', () => row.classList.remove('dragover'));
    row.addEventListener('drop', ev => {
      ev.preventDefault(); row.classList.remove('dragover');
      const dragId = ev.dataTransfer.getData('text/layer-id');
      const arr = state.project.layers;
      const from = arr.findIndex(q => q.id === dragId), to = arr.findIndex(q => q.id === layer.id);
      if (from < 0 || to < 0 || from === to) return;
      commit();
      const [moved] = arr.splice(from, 1); arr.splice(to, 0, moved);
      rebuildScene(); buildLayerList(); buildTimeline();
    });
    el.appendChild(row);
  }
}
function selectLayer(id, focusCanvas) {
  state.selectedId = id;
  if (graphState.open) { graphState.selKey = -1; buildGraphChips(); drawGraph(); }
  buildLayerList(); buildProps(); markTimelineSelection();
  if (focusCanvas) {
    const o = objByLayer.get(id);
    if (o) canvas.setActiveObject(o); else canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
  const l = selectedLayer();
  $('#selInfo').textContent = l ? `${l.name} · ${l.type} · depth ${l.depth || 0}` : 'No selection';
}

/* ---------------- properties panel ---------------- */
const VISUAL_PROPS = [['x', 'X'], ['y', 'Y'], ['scale', 'Scale'], ['rotation', 'Rotation °'], ['opacity', 'Opacity']];
const CAM_PROPS = [['x', 'X'], ['y', 'Y'], ['z', 'Z (dist −)'], ['focus', 'Focus depth'], ['dof', 'DoF blur'], ['fog', 'Fog']];
const AUDIO_PROPS = [['volume', 'Volume']];
function buildProps() {
  const layer = selectedLayer();
  $('#propsEmpty').classList.toggle('hidden', !!layer);
  $('#propsBody').classList.toggle('hidden', !layer);
  if (!layer) return;
  $('#pName').value = layer.name; $('#pType').textContent = layer.type;
  const isCam = layer.type === 'camera';
  if (isCam) { for (const k of ['focus', 'dof', 'fog']) if (layer.props[k] === undefined) layer.props[k] = 0; }
  $('#cameraRows').classList.toggle('hidden', !isCam);
  $('#depthRow').classList.toggle('hidden', isCam || layer.type === 'audio');
  $('#textRows').classList.toggle('hidden', layer.type !== 'text');
  $('#fillRow').classList.toggle('hidden', !(layer.type.startsWith('shape') || layer.type === 'text'));
  $('#pFill').value = layer.fill || '#ffffff';
  if (layer.type === 'text') { $('#pText').value = layer.text || ''; $('#pFontSize').value = layer.fontSize || 90; const pf = $('#pFont'); if (pf) pf.value = layer.fontFamily || 'Cairo'; }
  $('#pDepth').value = layer.depth || 0; $('#pFov').value = layer.fov || 60;
  const psel = $('#pParent');
  if (psel) {
    psel.innerHTML = '<option value="">— None —</option>';
    for (const cand of state.project.layers) {
      if (cand.id === layer.id || isDescendantOf(cand, layer.id)) continue;
      const o = document.createElement('option'); o.value = cand.id; o.textContent = cand.name;
      psel.appendChild(o);
    }
    psel.value = layer.parentId || '';
  }
  const isVisual = layer.type !== 'camera' && layer.type !== 'null' && layer.type !== 'group' && layer.type !== 'audio';
  const brow = $('#blendRow'), mrow = $('#maskRow'), mirow = $('#maskInvRow'), fxsec = $('#fxSection');
  if (brow) brow.classList.toggle('hidden', !isVisual);
  if (mrow) mrow.classList.toggle('hidden', !isVisual);
  if (mirow) mirow.classList.toggle('hidden', !isVisual);
  if (fxsec) fxsec.classList.toggle('hidden', !isVisual || layer.type === 'video');
  if (isVisual) {
    $('#pBlend').value = layer.blend || 'source-over';
    $('#pMask').value = layer.maskShape || 'none';
    $('#pMaskInv').checked = !!layer.maskInvert;
    buildFxList(layer);
  }
  const wrap = $('#propTracks'); wrap.innerHTML = '';
  positionClipTools();
  for (const [prop, label] of (isCam ? CAM_PROPS : layer.type === 'audio' ? AUDIO_PROPS : VISUAL_PROPS)) {
    const row = document.createElement('div'); row.className = 'prop-row';
    const val = evalProp(layer, prop, state.time);
    row.innerHTML = `<label>${label}</label>`;
    const input = document.createElement('input'); input.type = 'number'; input.step = ['opacity', 'scale', 'dof', 'fog', 'volume'].includes(prop) ? '0.05' : '1';
    input.value = Math.round(val * 100) / 100; input.dataset.prop = prop;
    input.addEventListener('change', () => { commit(); setValueAtTime(layer, prop, parseFloat(input.value) || 0, state.time); applyTime(state.time); buildTimelineRows(); refreshPropStates(); });
    const kf = document.createElement('button'); kf.className = 'kf-btn' + (keyAt(layer, prop, state.time) ? ' on' : ''); kf.textContent = '◆'; kf.title = 'Toggle keyframe at playhead';
    kf.addEventListener('click', () => {
      commit();
      const tr = layer.tracks[prop] || (layer.tracks[prop] = []);
      const hit = keyAt(layer, prop, state.time);
      if (hit) layer.tracks[prop] = tr.filter(k => k !== hit);
      else { tr.push({ t: state.time, v: evalProp(layer, prop, state.time), ease: currentEase() }); tr.sort((a, b) => a.t - b.t); }
      buildProps(); buildTimelineRows();
    });
    row.appendChild(input); row.appendChild(kf); wrap.appendChild(row);
  }
}
function refreshPropStates() { buildProps(); }

/* ---------------- M3: camera move presets ---------------- */
function setKeyAt(layer, prop, t, v) {
  const tr = layer.tracks[prop] || (layer.tracks[prop] = []);
  const hit = tr.find(k => Math.abs(k.t - t) < 0.021);
  if (hit) hit.v = v; else { tr.push({ t, v, ease: currentEase() }); tr.sort((a, b) => a.t - b.t); }
}
function applyCamPreset(kind) {
  const cam = selectedLayer(); if (!cam || cam.type !== 'camera') return;
  const t0 = Math.round(state.time * 100) / 100, t1 = Math.min(state.project.duration, t0 + 2);
  if (t1 - t0 < 0.2) return;
  commit();
  const x0 = evalProp(cam, 'x', t0), y0 = evalProp(cam, 'y', t0), z0 = evalProp(cam, 'z', t0);
  const P = state.project, cx = P.width / 2, cy = P.height / 2;
  const moves = {
    'dolly-in': [['z', z0, Math.min(-380, z0 + 620)]],
    'dolly-out': [['z', z0, Math.max(-3400, z0 - 700)]],
    'truck-r': [['x', x0, x0 + 520]],
    'truck-l': [['x', x0, x0 - 520]],
    'crane-up': [['y', y0, y0 - 380]],
    'crane-down': [['y', y0, y0 + 380]]
  };
  if (kind === 'orbit') {
    const ry = (y0 - cy) / 0.45, R = Math.max(300, Math.hypot(x0 - cx, ry) || 460), a0 = Math.atan2(ry, x0 - cx);
    for (let i = 0; i <= 4; i++) {
      const tt = Math.round((t0 + (t1 - t0) * i / 4) * 100) / 100, a = a0 + (i / 4) * Math.PI * 2;
      setKeyAt(cam, 'x', tt, Math.round(cx + R * Math.cos(a)));
      setKeyAt(cam, 'y', tt, Math.round(cy + R * 0.45 * Math.sin(a)));
    }
  } else if (moves[kind]) {
    for (const [prop, a, b] of moves[kind]) { setKeyAt(cam, prop, t0, a); setKeyAt(cam, prop, t1, b); }
  }
  applyTime(state.time); buildTimelineRows(); buildProps();
}
document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => applyCamPreset(b.dataset.preset)));

/* ---------------- timeline ---------------- */
function fmt(t) { const m = Math.floor(t / 60), s = t - m * 60; return `00:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; }
function buildTimeline() {
  const p = state.project, w = p.duration * state.pxPerSec;
  const ruler = $('#ruler'); ruler.style.width = w + 'px'; ruler.innerHTML = '';
  for (let s = 0; s <= p.duration; s++) {
    const tick = document.createElement('div'); tick.className = 'tick'; tick.style.left = (s * state.pxPerSec) + 'px';
    tick.textContent = s + 's'; ruler.appendChild(tick);
  }
  buildTimelineRows(); updatePlayhead();
}
function buildTimelineRows() {
  const p = state.project, rows = $('#rows'); rows.innerHTML = ''; rows.style.width = (p.duration * state.pxPerSec) + 'px';
  for (const layer of p.layers) {
    const row = document.createElement('div'); row.className = 'tl-row' + (layer.id === state.selectedId ? ' sel' : '');
    if (layer.type === 'video' || layer.type === 'audio') row.classList.add('tall');
    const bar = document.createElement('div'); bar.className = 'tl-bar' + (layer.type === 'camera' ? ' cam' : layer.type === 'text' ? ' bar-text' : layer.type === 'image' ? ' bar-image' : layer.type === 'video' ? ' bar-video' : layer.type === 'audio' ? ' bar-audio' : layer.type === 'null' ? ' bar-null' : layer.type === 'group' ? ' bar-group' : '');
    bar.style.left = (layer.start * state.pxPerSec) + 'px'; bar.style.width = Math.max(24, layer.duration * state.pxPerSec) + 'px';
    if (layer.type === 'audio') {
      const aIdx = p.layers.slice(0, p.layers.indexOf(layer)).filter(l => l.type === 'audio').length;
      if (aIdx % 2 === 1) bar.classList.add('alt');
    }
    bar.innerHTML = `<div class="bar-name">${layer.type === 'audio' ? '<span class="audio-badge">&#9834;</span>' : ''}${layer.name}</div>`;
    if (layer.type === 'video' && layer.thumbs && layer.thumbs.length) {
      const strip = document.createElement('div'); strip.className = 'filmstrip';
      for (const f of layer.thumbs) {
        const im = document.createElement('img'); im.alt = '';
        im.src = window.bm ? window.bm.fileUrl(f) : f;
        im.onerror = () => regenerateThumbs(layer);
        strip.appendChild(im);
      }
      bar.insertBefore(strip, bar.firstChild);
    }
    if (layer.type === 'audio' && layer.peaks && layer.peaks.length) {
      const cv = document.createElement('canvas'); cv.className = 'wavecv';
      const bw = Math.max(24, Math.round(layer.duration * state.pxPerSec));
      cv.width = bw; cv.height = 20;
      const g = cv.getContext('2d'); g.fillStyle = 'rgba(255,255,255,0.88)';
      const pk = layer.peaks, n = pk.length, md = layer.mediaDuration || layer.duration;
      const i0 = Math.floor(((layer.offset || 0) / md) * n), span = Math.max(1, Math.floor((layer.duration / md) * n));
      for (let x = 0; x < bw; x++) {
        const v = pk[Math.min(n - 1, i0 + Math.floor(x / bw * span))] || 0;
        const bh = Math.max(1, v * 20);
        g.fillRect(x, (20 - bh) / 2, 1, bh);
      }
      bar.appendChild(cv);
    }
    bar.addEventListener('pointerdown', ev => startBarDrag(ev, layer, bar));
    bar.addEventListener('click', () => selectLayer(layer.id, true));
    row.appendChild(bar);
    const seen = new Set();
    for (const prop of Object.keys(layer.tracks)) {
      for (const k of layer.tracks[prop]) {
        const key = Math.round(k.t * 1000); if (seen.has(key)) continue; seen.add(key);
        const d = document.createElement('div'); d.className = 'diamond'; d.style.left = ((layer.start + k.t) * state.pxPerSec) + 'px';
        d.title = `${prop} @ ${k.t.toFixed(2)}s`;
        d.addEventListener('click', ev => { ev.stopPropagation(); selectLayer(layer.id, true); setTime(k.t + layer.start); });
        row.appendChild(d);
      }
    }
    rows.appendChild(row);
  }
}
function markTimelineSelection() { buildTimelineRows(); }
function startBarDrag(ev, layer, bar) {
  if (layer.locked) return;
  ev.preventDefault(); const barSnap = snap(); const x0 = ev.clientX, start0 = layer.start;
  const move = e => { layer.start = Math.max(0, Math.round((start0 + (e.clientX - x0) / state.pxPerSec) * 20) / 20); bar.style.left = (layer.start * state.pxPerSec) + 'px'; applyTime(state.time); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (barSnap !== snap()) { undoStack.push(barSnap); redoStack = []; syncUndoBtns(); } buildTimelineRows(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function updatePlayhead() {
  $('#playhead').style.left = (state.time * state.pxPerSec + $('#timeline').scrollLeft * 0) + 'px';
  $('#playhead').style.transform = `translateX(0px)`;
  $('#playhead').style.left = `calc(${state.time * state.pxPerSec}px)`;
  $('#timeRead').textContent = `${fmt(state.time)} / ${fmt(state.project.duration)}`;
  positionClipTools();
}
function setTime(t) {
  state.time = Math.max(0, Math.min(state.project.duration, t));
  applyTime(state.time); refreshPropStates();
}

/* ruler scrubbing */
(() => {
  const ruler = $('#ruler'); let scrub = false;
  const toTime = e => { const r = $('#timeline').getBoundingClientRect(); return (e.clientX - r.left + $('#timeline').scrollLeft) / state.pxPerSec; };
  ruler.addEventListener('pointerdown', e => { scrub = true; setTime(toTime(e)); });
  window.addEventListener('pointermove', e => { if (scrub) setTime(toTime(e)); });
  window.addEventListener('pointerup', () => { scrub = false; });
})();

/* ---------------- transport ---------------- */
let lastTs = 0;
function loop(ts) {
  if (state.playing) {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0; lastTs = ts;
    let t = state.time + dt; if (t > state.project.duration) t = 0;
    state.time = t; applyTime(t);
    if ((ts % 120) < 20) refreshPropStates();
  } else lastTs = ts;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
$('#btnPlay').addEventListener('click', () => { state.playing = !state.playing; $('#btnPlay').textContent = state.playing ? '⏸' : '▶'; });
$('#btnStart').addEventListener('click', () => setTime(0));
$('#tlZoom').addEventListener('input', e => { state.pxPerSec = parseInt(e.target.value, 10); buildTimeline(); });

/* ---------------- add / edit layers ---------------- */
function addLayer(type) {
  commit();
  const p = state.project; let layer;
  if (type === 'camera') { layer = makeLayer('camera', 'Camera ' + (p.layers.filter(l => l.type === 'camera').length + 1)); }
  else if (type === 'null') { layer = makeLayer('null', 'Null ' + (p.layers.filter(l => l.type === 'null').length + 1)); }
  else if (type === 'group') { layer = makeLayer('group', 'Group ' + (p.layers.filter(l => l.type === 'group').length + 1)); }
  else if (type === 'text') { layer = makeLayer('text', 'Text'); layer.text = 'New text'; }
  else if (type.startsWith('shape-')) { layer = makeLayer(type, type.slice(6).charAt(0).toUpperCase() + type.slice(7)); }
  else if (type === 'image') { addImageLayer(); return; }
  layer.props = baseProps(layer.type, p.width, p.height);
  layer.duration = p.duration;
  p.layers.unshift(layer); rebuildScene(); buildLayerList(); buildTimeline(); selectLayer(layer.id, true);
}
const mediaLib = [];
function registerMedia(path, thumbPath) {
  if (!window.bm || mediaLib.includes(path)) return;
  mediaLib.push(path);
  const bin = $('#mediaBin'); if (!bin) return;
  const empty = $('#mediaEmpty'); if (empty) empty.remove();
  const ext = (path.split('.').pop() || '').toLowerCase();
  const card = document.createElement('button'); card.className = 'media-card'; card.title = 'Add this media to the scene';
  if (AUDIO_EXTS.includes(ext)) card.innerHTML = '<span class="media-audio-badge">♪ AUDIO</span><span></span>';
  else card.innerHTML = '<img src="' + window.bm.fileUrl(thumbPath || path) + '" alt=""><span></span>';
  card.querySelector('span:last-child').textContent = path.split(/[\\/]/).pop();
  card.addEventListener('click', () => importMediaPath(path));
  bin.appendChild(card);
}
async function addImageLayer(pickedPath) {
  if (!window.bm) return; commit();
  let path = pickedPath;
  if (!path) { const r = await window.bm.pickMedia(); if (!r.ok || !r.paths.length) return; path = r.paths[0]; }
  const layer = makeLayer('image', path.split(/[\\/]/).pop());
  layer.src = window.bm.fileUrl(path); layer.props = baseProps('image', state.project.width, state.project.height);
  layer.duration = state.project.duration;
  state.project.layers.unshift(layer); rebuildScene(); buildLayerList(); buildTimeline(); selectLayer(layer.id, true);
  registerMedia(path);
}
document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addLayer(b.dataset.add)));
$('#pName').addEventListener('change', e => { const l = selectedLayer(); if (l) { commit(); l.name = e.target.value; buildLayerList(); buildTimelineRows(); } });
$('#pText').addEventListener('change', e => { const l = selectedLayer(); if (l) { commit(); l.text = e.target.value; rebuildScene(); selectLayer(l.id, true); } });
$('#pFont').addEventListener('change', e => { const l = selectedLayer(); if (l) { commit(); l.fontFamily = e.target.value; rebuildScene(); selectLayer(l.id, true); } });
$('#pFontSize').addEventListener('change', e => { const l = selectedLayer(); if (l) { commit(); l.fontSize = parseFloat(e.target.value) || 90; rebuildScene(); selectLayer(l.id, true); } });
$('#pFill').addEventListener('focus', () => { window.__fillSnap = snap(); });
$('#pFill').addEventListener('change', () => { if (window.__fillSnap && window.__fillSnap !== snap()) { undoStack.push(window.__fillSnap); redoStack = []; syncUndoBtns(); } window.__fillSnap = null; });
$('#pFill').addEventListener('input', e => { const l = selectedLayer(); if (l) l._fxSig = null; if (l) { l.fill = e.target.value; const o = objByLayer.get(l.id); if (o && o.set) { o.set('fill', l.fill); canvas.requestRenderAll(); } } });
$('#pBlend').addEventListener('change', e => { const l = selectedLayer(); if (l) { commit(); l.blend = e.target.value; applyTime(state.time); } });
$('#pMask').addEventListener('change', e => { const l = selectedLayer(); if (l) { commit(); l.maskShape = e.target.value; l._fxSig = null; rebuildScene(); selectLayer(l.id, false); } });
$('#pMaskInv').addEventListener('change', e => { const l = selectedLayer(); if (l) { commit(); l.maskInvert = e.target.checked; l._fxSig = null; rebuildScene(); selectLayer(l.id, false); } });
$('#pParent').addEventListener('change', e => { const l = selectedLayer(); if (l) { commit(); setParent(l, e.target.value || null); } });
$('#pDepth').addEventListener('change', e => { const l = selectedLayer(); if (l) { commit(); l.depth = parseFloat(e.target.value) || 0; applyTime(state.time); } });
$('#pFov').addEventListener('change', e => { const l = selectedLayer(); if (l) l.fov = parseFloat(e.target.value) || 60; });
$('#btnDel').addEventListener('click', () => {
  const l = selectedLayer(); if (!l) return; commit();
  state.project.layers = state.project.layers.filter(x => x.id !== l.id);
  state.selectedId = null; rebuildScene(); buildLayerList(); buildTimeline(); buildProps();
});
$('#btnDup').addEventListener('click', () => {
  const l = selectedLayer(); if (!l) return; commit();
  const copy = JSON.parse(JSON.stringify(l)); copy.id = uid(); copy.name = l.name + ' copy';
  state.project.layers.unshift(copy); rebuildScene(); buildLayerList(); buildTimeline(); selectLayer(copy.id, true);
});

/* ---------------- project io ---------------- */
function serialize() { const p = state.project; p.name = $('#projName').value; return JSON.stringify(p, null, 1); }
$('#btnSave').addEventListener('click', async () => { if (window.bm) await window.bm.saveProject(serialize(), 'project.exploringmotion.json'); });
$('#btnOpen').addEventListener('click', async () => {
  if (!window.bm) return; const r = await window.bm.openProject(); if (!r.ok) return;
  try { state.project = JSON.parse(r.json); undoStack = []; redoStack = []; syncUndoBtns(); uidSeq = 1000; state.selectedId = null; state.time = 0; $('#projName').value = state.project.name || 'Project'; afterProjectLoad(); } catch (e) { alert('Invalid project file'); }
});
$('#btnNew').addEventListener('click', () => { undoStack = []; redoStack = []; syncUndoBtns(); state.project = demoProject(); state.selectedId = null; state.time = 0; $('#projName').value = state.project.name; afterProjectLoad(); });
$('#sizePreset').addEventListener('change', e => {
  commit();
  const [w, h] = e.target.value.split('x').map(Number);
  state.project.width = w; state.project.height = h;
  const kv = $('#kvCanvas'); if (kv) kv.textContent = w + ' × ' + h;
  rebuildScene();
});
$('#projName').addEventListener('change', e => { state.project.name = e.target.value; });
function afterProjectLoad() { rebuildScene(); buildLayerList(); buildTimeline(); buildProps(); applyTime(0); }


/* ---------------- rail nav + objects panel ---------------- */
document.querySelectorAll('.rail-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.rail-btn').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.nav-page').forEach(pg => pg.classList.toggle('hidden', pg.dataset.page !== b.dataset.nav));
}));
const SHAPES = [
  ['shape-rect', 'Rectangle', '<rect x="4" y="6" width="16" height="12" rx="2.5" fill="#6d28ff"/>'],
  ['shape-circle', 'Circle', '<circle cx="12" cy="12" r="7.5" fill="#00c853"/>'],
  ['shape-triangle', 'Triangle', '<path d="M12 5l8 14H4z" fill="#4dabff"/>'],
  ['shape-pentagon', 'Pentagon', '<path d="M12 4l7.6 5.5-2.9 8.9H7.3L4.4 9.5z" fill="#ff8a3d"/>'],
  ['shape-star', 'Star', '<path d="M12 4l2.3 5.2 5.7.5-4.3 3.7 1.3 5.6L12 16l-5 3 1.3-5.6L4 9.7l5.7-.5z" fill="#ffb020"/>'],
  ['shape-spark', 'Sparkle', '<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z" fill="#ff5c8a"/>'],
  ['shape-heart', 'Heart', '<path d="M12 19.5S4.5 14.6 4.5 9.9C4.5 7.2 6.6 5 9.2 5c1.1 0 2.2.5 2.8 1.3C12.6 5.5 13.7 5 14.8 5c2.6 0 4.7 2.2 4.7 4.9 0 4.7-7.5 9.6-7.5 9.6z" fill="#ff4d6d"/>'],
  ['shape-arrow', 'Arrow', '<path d="M4 12h12M12 6l6 6-6 6" fill="none" stroke="#0d9488" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>']
];
const grid = $('#shapeGrid');
for (const [type, name, svg] of SHAPES) {
  const b = document.createElement('button');
  b.className = 'tile'; b.dataset.name = name.toLowerCase(); b.title = 'Add ' + name;
  b.innerHTML = '<svg viewBox="0 0 24 24">' + svg + '</svg><span>' + name + '</span>';
  b.addEventListener('click', () => addLayer(type));
  grid.appendChild(b);
}
function filterShapes() { const q = $('#objSearch').value.trim().toLowerCase(); grid.querySelectorAll('.tile').forEach(t => t.classList.toggle('hidden', !!q && !t.dataset.name.includes(q))); }
$('#objSearch').addEventListener('input', filterShapes);
$('#objSearchBtn').addEventListener('click', filterShapes);
$('#addTextBig').addEventListener('click', () => addLayer('text'));
$('#addTextBig2').addEventListener('click', () => addLayer('text'));
$('#importMedia').addEventListener('click', async () => {
  if (!window.bm) return;
  const rr = await window.bm.pickMedia(); if (!rr.ok) return;
  for (const pth of rr.paths) await importMediaPath(pth);
});

/* ---------------- M5: video + audio layers ---------------- */
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'];
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
const videoEls = new Map(), audioEls = new Map();
function videoElFor(layer) {
  let el = videoEls.get(layer.id);
  if (!el) {
    el = document.createElement('video');
    el.src = layer.src; el.muted = true; el.preload = 'auto'; el.playsInline = true;
    el.addEventListener('loadedmetadata', () => {
      // fabric.Image draws from the element's width/height ATTRS (0 by default for
      // JS-created <video>) — without this the layer renders as fully transparent.
      if (el.videoWidth) { el.width = el.videoWidth; el.height = el.videoHeight; }
      const oo = objByLayer.get(layer.id); if (oo) oo.dirty = true;
    });
    el.addEventListener('seeked', () => canvas.requestRenderAll());
    videoEls.set(layer.id, el);
  }
  return el;
}
function audioElFor(layer) {
  let el = audioEls.get(layer.id);
  if (!el) {
    el = document.createElement('audio');
    el.src = layer.src; el.preload = 'auto';
    audioEls.set(layer.id, el);
  }
  return el;
}
function syncMedia(t) {
  if (state.exporting) return;
  for (const layer of state.project.layers) {
    if (layer.type !== 'video' && layer.type !== 'audio') continue;
    const el = layer.type === 'video' ? videoElFor(layer) : audioElFor(layer);
    const local = t - layer.start + (layer.offset || 0);
    const inSpan = t >= layer.start && t <= layer.start + layer.duration && local <= (layer.mediaDuration || Infinity) + 0.05;
    if (!inSpan) { if (!el.paused) el.pause(); continue; }
    if (Math.abs(el.currentTime - local) > 0.18) { try { el.currentTime = Math.max(0, local); } catch (e) {} }
    if (layer.type === 'audio') el.volume = Math.min(1, Math.max(0, evalProp(layer, 'volume', t) == null ? 1 : evalProp(layer, 'volume', t)));
    if (state.playing) { if (el.paused) el.play().catch(() => {}); }
    else if (!el.paused) el.pause();
    if (layer.type === 'video') { const o = objByLayer.get(layer.id); if (o) o.dirty = true; }
  }
}
async function seekMediaForExport(t) {
  const jobs = [];
  for (const layer of state.project.layers) {
    if (layer.type !== 'video') continue;
    const el = videoElFor(layer);
    const local = t - layer.start + (layer.offset || 0);
    if (t < layer.start || t > layer.start + layer.duration) continue;
    if (Math.abs(el.currentTime - local) < 0.02) continue;
    jobs.push(new Promise(res => {
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      el.addEventListener('seeked', fin, { once: true });
      setTimeout(fin, 300);
      try { el.currentTime = Math.max(0, local); } catch (e) { fin(); }
    }));
  }
  await Promise.all(jobs);
}
function thumbTimes(d) {
  const n = Math.min(12, Math.max(2, Math.round(d)));
  const times = [];
  for (let i = 0; i < n; i++) times.push(Math.max(0, Math.min(d - 0.05, (i + 0.5) * d / n)));
  return times;
}
function regenerateThumbs(layer) {
  if (layer._thumbRetry || !window.bm || !layer.mediaPath) return;
  layer._thumbRetry = true;
  window.bm.videoThumbs(layer.mediaPath, thumbTimes(layer.mediaDuration || 4)).then(th => {
    if (th.ok) { layer.thumbs = th.files; buildTimelineRows(); }
  });
}
async function importMediaPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (VIDEO_EXTS.includes(ext)) return addVideoLayer(path);
  if (AUDIO_EXTS.includes(ext)) return addAudioLayer(path);
  return addImageLayer(path);
}
async function addVideoLayer(path) {
  if (!window.bm) return;
  const probe = await window.bm.probeMedia(path);
  if (!probe.ok) return;
  commit();
  const layer = makeLayer('video', path.split(/[\\/]/).pop());
  layer.src = window.bm.fileUrl(path); layer.mediaPath = path;
  layer.mediaDuration = probe.duration; layer.offset = 0;
  layer.duration = Math.min(probe.duration, state.project.duration);
  layer.w = probe.width || 0; layer.h = probe.height || 0;
  layer.props = baseProps('video', state.project.width, state.project.height);
  const th = await window.bm.videoThumbs(path, thumbTimes(probe.duration));
  if (th.ok) layer.thumbs = th.files;
  state.project.layers.unshift(layer);
  rebuildScene(); buildLayerList(); buildTimeline(); selectLayer(layer.id, true);
  registerMedia(path, layer.thumbs && layer.thumbs[0]);
}
async function addAudioLayer(path) {
  if (!window.bm) return;
  const probe = await window.bm.probeMedia(path);
  if (!probe.ok) return;
  commit();
  const layer = makeLayer('audio', path.split(/[\\/]/).pop());
  layer.src = window.bm.fileUrl(path); layer.mediaPath = path;
  layer.mediaDuration = probe.duration; layer.offset = 0;
  layer.duration = Math.min(probe.duration, state.project.duration);
  layer.props = { volume: 1 };
  const pk = await window.bm.audioPeaks(path, 240);
  if (pk.ok) layer.peaks = pk.peaks;
  state.project.layers.unshift(layer);
  rebuildScene(); buildLayerList(); buildTimeline(); selectLayer(layer.id, true);
  registerMedia(path);
}

/* ---------------- M5: split + floating clip tools ---------------- */
function splitLayerAt(layer, tAbs) {
  const start = layer.start, end = layer.start + layer.duration;
  if (tAbs <= start + 0.02 || tAbs >= end - 0.02) return;
  commit();
  const right = JSON.parse(JSON.stringify(layer));
  right.id = uid(); right.name = layer.name + ' · 2';
  right.start = tAbs; right.duration = end - tAbs;
  right.offset = (layer.offset || 0) + (tAbs - start);
  right._fxSig = null; delete right._atmo; delete right._fxBusy; delete right._thumbRetry;
  for (const prop of Object.keys(layer.tracks)) {
    const tr = layer.tracks[prop];
    const vAt = evalProp(layer, prop, tAbs);
    const leftKeys = tr.filter(k => k.t < tAbs - 0.001);
    if (!leftKeys.some(k => Math.abs(k.t - tAbs) < 0.021)) leftKeys.push({ t: tAbs, v: vAt, ease: null });
    const rightKeys = tr.filter(k => k.t > tAbs + 0.001);
    if (!rightKeys.some(k => Math.abs(k.t - tAbs) < 0.021)) rightKeys.unshift({ t: tAbs, v: vAt, ease: null });
    layer.tracks[prop] = leftKeys;
    right.tracks[prop] = rightKeys;
  }
  layer.duration = tAbs - start;
  const idx = state.project.layers.indexOf(layer);
  state.project.layers.splice(idx + 1, 0, right);
  rebuildScene(); buildLayerList(); buildTimeline(); selectLayer(right.id, false);
}
function addKeysAtPlayhead(layer) {
  if (!layer) return;
  commit();
  const t = Math.round(state.time * 100) / 100;
  let props = Object.keys(layer.tracks).filter(k => !k.startsWith('fx:'));
  if (!props.length) props = layer.type === 'camera' ? ['x', 'y', 'z'] : layer.type === 'audio' ? ['volume'] : ['x', 'y'];
  for (const prop of props) setKeyAt(layer, prop, t, evalProp(layer, prop, state.time));
  buildProps(); buildTimelineRows();
}
function positionClipTools() {
  const bar = $('#clipTools'); if (!bar) return;
  const layer = selectedLayer();
  if (!layer) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const tl = $('#timeline'), wrap = $('#timelineWrap');
  if (!tl || !wrap) return;
  const x = tl.offsetLeft + state.time * state.pxPerSec - tl.scrollLeft;
  const w = bar.offsetWidth || 150;
  bar.style.left = Math.max(8 + w / 2, Math.min(wrap.clientWidth - 8 - w / 2, x)) + 'px';
  const split = $('#ctSplit');
  if (split) split.disabled = !(state.time > layer.start + 0.02 && state.time < layer.start + layer.duration - 0.02);
}
$('#ctSplit').addEventListener('click', () => { const l = selectedLayer(); if (l) splitLayerAt(l, Math.round(state.time * 100) / 100); });
$('#ctKey').addEventListener('click', () => addKeysAtPlayhead(selectedLayer()));
$('#ctDup').addEventListener('click', () => { const b = $('#btnDup'); if (b) b.click(); });
$('#ctDel').addEventListener('click', () => { const b = $('#btnDel'); if (b) b.click(); });
$('#btnUndo').addEventListener('click', doUndo);
$('#btnRedo').addEventListener('click', doRedo);
window.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
});
syncUndoBtns();


/* ---------------- effects engine (M2) ----------------
   Effects are baked into a per-layer raster (project resolution) built
   from the layer's own object; the raster then behaves like any other
   scene object, so transforms, parenting, camera and blending apply
   unchanged. Effect parameters live in layer.props under
   'fx:<id>:<param>' so the whole keyframe/track system (and the Graph
   Editor) works on them for free. */
const EFFECT_DEFS = {
  brightness: { name: 'Brightness', cat: 'Color & Light', params: [{ k: 'amt', label: 'Amount', min: -100, max: 100, step: 1, def: 25 }] },
  contrast:   { name: 'Contrast',   cat: 'Color & Light', params: [{ k: 'amt', label: 'Amount', min: -100, max: 100, step: 1, def: 25 }] },
  saturation: { name: 'Saturation', cat: 'Color & Light', params: [{ k: 'amt', label: 'Amount', min: -100, max: 200, step: 1, def: 40 }] },
  hue:        { name: 'Hue Rotate', cat: 'Color & Light', params: [{ k: 'deg', label: 'Degrees', min: -180, max: 180, step: 1, def: 40 }] },
  tint:       { name: 'Tint',       cat: 'Color & Light', params: [{ k: 'color', label: 'Color', kind: 'color', def: '#00c853' }, { k: 'amt', label: 'Amount', min: 0, max: 100, step: 1, def: 50 }] },
  invert:     { name: 'Invert',     cat: 'Color & Light', params: [{ k: 'amt', label: 'Amount', min: 0, max: 100, step: 1, def: 100 }] },
  grayscale:  { name: 'Grayscale',  cat: 'Color & Light', params: [{ k: 'amt', label: 'Amount', min: 0, max: 100, step: 1, def: 100 }] },
  sepia:      { name: 'Sepia',      cat: 'Color & Light', params: [{ k: 'amt', label: 'Amount', min: 0, max: 100, step: 1, def: 100 }] },
  posterize:  { name: 'Posterize',  cat: 'Color & Light', params: [{ k: 'levels', label: 'Levels', min: 2, max: 32, step: 1, def: 6 }] },
  blur:       { name: 'Gaussian Blur', cat: 'Blur', params: [{ k: 'radius', label: 'Radius', min: 0, max: 60, step: 0.5, def: 8 }] },
  shadow:     { name: 'Drop Shadow', cat: 'Drawing & Edge', params: [{ k: 'color', label: 'Color', kind: 'color', def: '#000000' }, { k: 'x', label: 'Offset X', min: -100, max: 100, step: 1, def: 0 }, { k: 'y', label: 'Offset Y', min: -100, max: 100, step: 1, def: 14 }, { k: 'blur', label: 'Blur', min: 0, max: 80, step: 1, def: 18 }, { k: 'amt', label: 'Opacity', min: 0, max: 100, step: 1, def: 60 }] },
  glow:       { name: 'Outer Glow', cat: 'Drawing & Edge', params: [{ k: 'color', label: 'Color', kind: 'color', def: '#22ff88' }, { k: 'blur', label: 'Size', min: 0, max: 80, step: 1, def: 26 }, { k: 'amt', label: 'Opacity', min: 0, max: 100, step: 1, def: 80 }] },
  sharpen:    { name: 'Sharpen',    cat: 'Drawing & Edge', params: [{ k: 'amt', label: 'Amount', min: 0, max: 100, step: 1, def: 60 }] },
  pixelate:   { name: 'Pixelate',   cat: 'Procedural', params: [{ k: 'size', label: 'Block size', min: 2, max: 64, step: 1, def: 10 }] },
  noise:      { name: 'Noise',      cat: 'Procedural', params: [{ k: 'amt', label: 'Amount', min: 0, max: 100, step: 1, def: 35 }] }
};
const fxKey = (fx, p) => 'fx:' + fx.id + ':' + p.k;
function fxParamsAt(layer, fx, t) {
  const out = {};
  for (const p of EFFECT_DEFS[fx.type].params) out[p.k] = p.kind === 'color' ? (fx.params[p.k] || p.def) : evalProp(layer, fxKey(fx, p), t);
  return out;
}
function hexRgba(hex, a) {
  const n = parseInt((hex || '#000000').slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function fxFilterPass(cur, filterStr) {
  const c = document.createElement('canvas'); c.width = cur.width; c.height = cur.height;
  const x = c.getContext('2d'); x.filter = filterStr; x.drawImage(cur, 0, 0); return c;
}
function fxPixelOp(cur, fn) {
  const x = cur.getContext('2d');
  const img = x.getImageData(0, 0, cur.width, cur.height), d = img.data;
  fn(d, cur.width, cur.height);
  x.putImageData(img, 0, 0); return cur;
}
function fxApplyOne(cur, type, p) {
  switch (type) {
    case 'brightness': return fxFilterPass(cur, `brightness(${1 + p.amt / 100})`);
    case 'contrast':   return fxFilterPass(cur, `contrast(${1 + p.amt / 100})`);
    case 'saturation': return fxFilterPass(cur, `saturate(${1 + p.amt / 100})`);
    case 'hue':        return fxFilterPass(cur, `hue-rotate(${p.deg}deg)`);
    case 'invert':     return fxFilterPass(cur, `invert(${p.amt / 100})`);
    case 'grayscale':  return fxFilterPass(cur, `grayscale(${p.amt / 100})`);
    case 'sepia':      return fxFilterPass(cur, `sepia(${p.amt / 100})`);
    case 'shadow':     return fxFilterPass(cur, `drop-shadow(${p.x}px ${p.y}px ${p.blur}px ${hexRgba(p.color, p.amt / 100)})`);
    case 'glow':       return fxFilterPass(cur, `drop-shadow(0px 0px ${p.blur}px ${hexRgba(p.color, p.amt / 100)}) drop-shadow(0px 0px ${Math.round(p.blur / 2)}px ${hexRgba(p.color, p.amt / 100)})`);
    case 'blur':       return fxFilterPass(cur, `blur(${p.radius}px)`);
    case 'tint': {
      const x = cur.getContext('2d');
      x.save(); x.globalCompositeOperation = 'source-atop'; x.globalAlpha = p.amt / 100;
      x.fillStyle = p.color; x.fillRect(0, 0, cur.width, cur.height); x.restore(); return cur;
    }
    case 'posterize': {
      const L = Math.max(2, Math.round(p.levels)), stepv = 255 / (L - 1);
      return fxPixelOp(cur, d => { for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) d[i + j] = Math.round(d[i + j] / stepv) * stepv; });
    }
    case 'noise': {
      const a = p.amt * 1.2;
      return fxPixelOp(cur, d => { for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 2 * a; d[i] += n; d[i + 1] += n; d[i + 2] += n; } });
    }
    case 'pixelate': {
      const s = Math.max(2, Math.round(p.size));
      const tw = Math.max(1, Math.round(cur.width / s)), th = Math.max(1, Math.round(cur.height / s));
      const tmp = document.createElement('canvas'); tmp.width = tw; tmp.height = th;
      tmp.getContext('2d').drawImage(cur, 0, 0, tw, th);
      const x = cur.getContext('2d'); x.imageSmoothingEnabled = false;
      x.clearRect(0, 0, cur.width, cur.height); x.drawImage(tmp, 0, 0, tw, th, 0, 0, cur.width, cur.height);
      x.imageSmoothingEnabled = true; return cur;
    }
    case 'sharpen': {
      const a = p.amt / 100, w = cur.width, h = cur.height;
      const src = cur.getContext('2d').getImageData(0, 0, w, h), sd = src.data;
      return fxPixelOp(cur, d => {
        const cp = new Uint8ClampedArray(sd);
        const K = [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0];
        for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
          const idx = (yy * w + xx) * 4;
          for (let j = 0; j < 3; j++) {
            let v = 0, ki = 0;
            for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) v += cp[((yy + ky) * w + (xx + kx)) * 4 + j] * K[ki++];
            d[idx + j] = v;
          }
        }
      });
    }
  }
  return cur;
}
function fxPadFor(list) {
  let pad = 10;
  for (const f of list) {
    if (f.type === 'blur') pad = Math.max(pad, f.p.radius * 2.5);
    if (f.type === 'glow') pad = Math.max(pad, f.p.blur * 2.5);
    if (f.type === 'shadow') pad = Math.max(pad, Math.abs(f.p.x) + Math.abs(f.p.y) + f.p.blur * 2);
  }
  return Math.ceil(pad);
}
/* ---- M3 camera atmosphere: Depth of Field + Fog, baked like effects ---- */
const pristineByLayer = new Map();
function atmoFor(layer, t) {
  let blur = 0, fogAmt = 0;
  const cam = activeCamera(state.project, t);
  if (cam && layer.type !== 'camera') {
    const dof = evalProp(cam, 'dof', t) || 0, focus = evalProp(cam, 'focus', t) || 0, fog = evalProp(cam, 'fog', t) || 0;
    const d = layer.depth || 0;
    if (dof > 0) blur = Math.min(26, dof * Math.abs(d - focus) / 220);
    if (fog > 0) fogAmt = Math.min(0.92, fog * Math.max(0, d) / 1400);
  }
  return { blur: Math.round(blur * 2) / 2, fog: Math.round(fogAmt * 50) / 50, color: state.project.background || '#e8f1ea' };
}
function fxFogPass(cur, color, amt) {
  const x = cur.getContext('2d');
  x.save(); x.globalCompositeOperation = 'source-atop'; x.globalAlpha = amt;
  x.fillStyle = color; x.fillRect(0, 0, cur.width, cur.height); x.restore(); return cur;
}
function fxSig(layer, t) {
  const en = (layer.effects || []).filter(f => f.enabled);
  const parts = [layer.type, layer.fill, layer.text, layer.fontSize, layer.fontFamily, layer.w, layer.h, layer.src, layer.maskShape, layer.maskInvert];
  for (const f of en) {
    const pv = fxParamsAt(layer, f, t);
    parts.push(f.type + ':' + EFFECT_DEFS[f.type].params.map(p => p.kind === 'color' ? pv[p.k] : Math.round(pv[p.k] * 100) / 100).join(','));
  }
  const at = atmoFor(layer, t);
  if (at.blur > 0.15 || at.fog > 0.02) parts.push('atmo:' + at.blur + ':' + at.fog);
  return JSON.stringify(parts);
}
function rasterizeLayer(layer, sig) {
  const en = (layer.effects || []).filter(f => f.enabled).map(f => ({ type: f.type, p: fxParamsAt(layer, f, state.time) }));
  const atmo = layer._atmo || { blur: 0, fog: 0, color: '#ffffff' };
  if (!en.length && !(atmo.blur > 0.15 || atmo.fog > 0.02)) return;
  let base = null;
  const cur = objByLayer.get(layer.id);
  if (layer.type === 'image') {
    const prist = pristineByLayer.get(layer.id);
    if (prist && prist.getElement && prist.getElement()) base = prist;
    else if (cur && cur.type === 'image' && !cur.__raster && cur.getElement && cur.getElement()) base = cur;
    else return; // image not loaded yet; retried on a later frame
  } else base = makeObject(layer);
  if (!base) return;
  layer._fxBusy = true;
  const finish = (baseObj) => {
    try {
      const probe = new fabric.StaticCanvas(null, { width: 3000, height: 3000 });
      baseObj.set({ left: 1500, top: 1500 });
      probe.add(baseObj); probe.renderAll();
      const br = baseObj.getBoundingRect();
      const pad = fxPadFor(en) + (atmo.blur > 0.15 ? Math.ceil(atmo.blur * 2.5) : 0);
      const W = Math.max(2, Math.ceil(br.width) + pad * 2), H = Math.max(2, Math.ceil(br.height) + pad * 2);
      const stage = new fabric.StaticCanvas(null, { width: W, height: H });
      baseObj.set({ left: W / 2, top: H / 2 });
      stage.add(baseObj); stage.renderAll();
      let work = stage.getElement();
      for (const f of en) work = fxApplyOne(work, f.type, f.p);
      if (atmo.blur > 0.15) work = fxFilterPass(work, 'blur(' + atmo.blur + 'px)');
      if (atmo.fog > 0.02) work = fxFogPass(work, atmo.color, atmo.fog);
      const img = new fabric.Image(work, { originX: 'center', originY: 'center', objectCaching: false });
      img.__layerId = layer.id; img.__raster = true;
      img.selectable = !layer.locked; img.evented = !layer.locked;
      const old = objByLayer.get(layer.id);
      if (layer.type === 'image' && old && !old.__raster) pristineByLayer.set(layer.id, old);
      const wasSelected = state.selectedId === layer.id; // capture BEFORE remove(): it fires selection:cleared and nulls the selection
      if (old) canvas.remove(old);
      objByLayer.set(layer.id, img); canvas.add(img); stackObjects();
      if (wasSelected) canvas.setActiveObject(img);
      layer._fxSig = sig;
      probe.dispose && probe.dispose(); stage.dispose && stage.dispose();
      applyTime(state.time);
    } catch (e) { /* a failed bake keeps the previous object */ }
    layer._fxBusy = false;
  };
  if (layer.type === 'image') base.clone(cl => finish(cl), ['__layerId']);
  else finish(base);
}
function maybeRaster(layer, t) {
  if (layer._fxBusy) return;
  if (layer.type === 'camera' || layer.type === 'null' || layer.type === 'group' || layer.type === 'video' || layer.type === 'audio') return;
  const atmo = atmoFor(layer, t);
  layer._atmo = atmo;
  const needs = (layer.effects || []).some(f => f.enabled) || atmo.blur > 0.15 || atmo.fog > 0.02;
  const cur = objByLayer.get(layer.id);
  if (!needs) {
    if (cur && cur.__raster) { layer._fxSig = null; rebuildScene(); }
    return;
  }
  const sig = fxSig(layer, t);
  if (sig !== layer._fxSig) rasterizeLayer(layer, sig);
}
function addEffectToLayer(layer, type) {
  const def = EFFECT_DEFS[type]; if (!def || !layer) return;
  commit();
  const fx = { id: 'fx' + Math.random().toString(36).slice(2, 8), type, enabled: true, params: {} };
  for (const p of def.params) { fx.params[p.k] = p.def; layer.props[fxKey(fx, p)] = p.def; }
  layer.effects = layer.effects || []; layer.effects.push(fx);
  layer._fxSig = null;
  applyTime(state.time); buildProps();
}
function removeEffect(layer, fx) {
  commit();
  for (const p of EFFECT_DEFS[fx.type].params) { delete layer.props[fxKey(fx, p)]; delete layer.tracks[fxKey(fx, p)]; }
  layer.effects = layer.effects.filter(f => f.id !== fx.id);
  layer._fxSig = null;
  if (!layer.effects.some(f => f.enabled)) rebuildScene(); else applyTime(state.time);
  buildProps();
}
function historify(el) {
  if (!el) return;
  el.addEventListener('focus', () => { el._snapBefore = snap(); });
  el.addEventListener('change', () => {
    if (el._snapBefore && el._snapBefore !== snap()) { undoStack.push(el._snapBefore); if (undoStack.length > 60) undoStack.shift(); redoStack = []; syncUndoBtns(); }
    el._snapBefore = null;
  });
}
function buildFxList(layer) {
  const wrap = $('#fxList'); if (!wrap) return;
  wrap.innerHTML = '';
  const list = layer.effects || [];
  if (!list.length) { wrap.innerHTML = '<div class="dim pad-sm">No effects. Open the Effects page and click an effect to add it.</div>'; return; }
  for (const fx of list) {
    const def = EFFECT_DEFS[fx.type];
    const card = document.createElement('div'); card.className = 'fx-card';
    const head = document.createElement('div'); head.className = 'fx-head';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = fx.enabled;
    chk.addEventListener('change', () => { commit(); fx.enabled = chk.checked; layer._fxSig = null; if (!layer.effects.some(f => f.enabled)) rebuildScene(); else applyTime(state.time); buildProps(); });
    const nm = document.createElement('span'); nm.className = 'fx-name'; nm.textContent = def.name;
    const rm = document.createElement('button'); rm.className = 'fx-rm'; rm.textContent = '✕'; rm.title = 'Remove effect';
    rm.addEventListener('click', () => removeEffect(layer, fx));
    head.appendChild(chk); head.appendChild(nm); head.appendChild(rm); card.appendChild(head);
    for (const p of def.params) {
      const key = fxKey(fx, p);
      const row = document.createElement('div'); row.className = 'prop-row';
      const lab = document.createElement('label'); lab.textContent = p.label; row.appendChild(lab);
      if (p.kind === 'color') {
        const inp = document.createElement('input'); inp.type = 'color'; inp.value = fx.params[p.k] || p.def;
        inp.addEventListener('input', () => { fx.params[p.k] = inp.value; layer.props[key] = inp.value; layer._fxSig = null; applyTime(state.time); });
        row.appendChild(inp);
      } else {
        const inp = document.createElement('input'); inp.type = 'number';
        inp.min = p.min; inp.max = p.max; inp.step = p.step;
        inp.value = Math.round(evalProp(layer, key, state.time) * 100) / 100;
        historify(inp);
        inp.addEventListener('change', () => { setValueAtTime(layer, key, parseFloat(inp.value) || 0, state.time); fx.params[p.k] = parseFloat(inp.value) || 0; layer._fxSig = null; applyTime(state.time); buildTimelineRows(); });
        const kf = document.createElement('button'); kf.className = 'kf-btn' + (keyAt(layer, key, state.time) ? ' on' : ''); kf.textContent = '◆'; kf.title = 'Toggle keyframe at playhead';
        kf.addEventListener('click', () => {
          commit();
          const tr = layer.tracks[key] || (layer.tracks[key] = []);
          const hit = keyAt(layer, key, state.time);
          if (hit) layer.tracks[key] = tr.filter(k => k !== hit);
          else { tr.push({ t: state.time, v: evalProp(layer, key, state.time), ease: currentEase() }); tr.sort((a, b) => a.t - b.t); }
          layer._fxSig = null; applyTime(state.time); buildProps(); buildTimelineRows();
        });
        row.appendChild(inp); row.appendChild(kf);
      }
      card.appendChild(row);
    }
    wrap.appendChild(card);
  }
}
function buildFxBrowser() {
  const wrap = $('#fxBrowser'); if (!wrap) return;
  wrap.innerHTML = '';
  const cats = {};
  for (const [type, def] of Object.entries(EFFECT_DEFS)) (cats[def.cat] = cats[def.cat] || []).push([type, def]);
  for (const [cat, items] of Object.entries(cats)) {
    const t = document.createElement('div'); t.className = 'group-title'; t.textContent = cat; wrap.appendChild(t);
    const grid = document.createElement('div'); grid.className = 'fx-tiles';
    for (const [type, def] of items) {
      const b = document.createElement('button'); b.className = 'fx-tile'; b.dataset.name = def.name.toLowerCase();
      b.innerHTML = '<span class="fx-dot"></span>' + def.name;
      b.title = 'Add ' + def.name + ' to the selected layer';
      b.addEventListener('click', () => {
        const layer = selectedLayer();
        const hint = $('#fxHint');
        if (!layer || layer.type === 'camera' || layer.type === 'null' || layer.type === 'group') {
          if (hint) hint.textContent = 'Select a shape, text or image layer first, then click an effect.';
          return;
        }
        if (hint) hint.textContent = def.name + ' added to ' + layer.name + '.';
        addEffectToLayer(layer, type);
      });
      grid.appendChild(b);
    }
    wrap.appendChild(grid);
  }
}

/* ---------------- Graph Editor ----------------
   Plots the selected layer's chosen property track. Keys are draggable
   (time + value); the selected key's two bezier handles reshape the
   easing of the segment that starts at that key. */
const graphState = { open: false, prop: 'x', selKey: -1, drag: null, snap: null };
function graphPropsFor(layer) { if (!layer) return VISUAL_PROPS; if (layer.type === 'camera') return CAM_PROPS; if (layer.type === 'audio') return AUDIO_PROPS; return VISUAL_PROPS; }
function graphLayer() { return selectedLayer(); }
function buildGraphChips() {
  const layer = graphLayer(); const wrap = $('#graphProps'); if (!wrap) return;
  wrap.innerHTML = '';
  if (!layer) { wrap.innerHTML = '<span class="dim">Select a layer</span>'; return; }
  for (const [prop, label] of graphPropsFor(layer)) {
    const b = document.createElement('button');
    b.className = 'gchip' + (graphState.prop === prop ? ' on' : '');
    b.textContent = label + ((layer.tracks[prop] && layer.tracks[prop].length) ? ' •' : '');
    b.addEventListener('click', () => { graphState.prop = prop; graphState.selKey = -1; buildGraphChips(); drawGraph(); });
    wrap.appendChild(b);
  }
  if (!graphPropsFor(layer).some(([p]) => p === graphState.prop)) graphState.prop = graphPropsFor(layer)[0][0];
}
function graphGeom() {
  const cv = $('#graphCv'); if (!cv) return null;
  const W = cv.clientWidth, H = cv.clientHeight; if (W < 60) return null;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cv, ctx, W, H, padL: 52, padR: 16, padT: 14, padB: 22 };
}
function graphRange(layer, prop) {
  const vals = [layer.props[prop] == null ? 0 : layer.props[prop]];
  for (const k of (layer.tracks[prop] || [])) vals.push(k.v);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mx - mn < 1e-6) { mn -= 1; mx += 1; }
  const pad = (mx - mn) * 0.14; return [mn - pad, mx + pad];
}
function drawGraph() {
  if (!graphState.open) return;
  const g = graphGeom(); if (!g) return;
  const { ctx, W, H, padL, padR, padT, padB } = g;
  const layer = graphLayer();
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10px Gram, sans-serif'; ctx.fillStyle = '#8b93a7';
  if (!layer) { ctx.fillText('Select a layer to edit its curves.', padL, H / 2); $('#graphKeyInfo').textContent = ''; return; }
  const prop = graphState.prop, dur = Math.max(0.01, state.project.duration);
  const [mn, mx] = graphRange(layer, prop);
  const X = t => padL + (t / dur) * (W - padL - padR);
  const Y = v => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB);
  // grid
  ctx.strokeStyle = '#e2e7f0'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = mn + (mx - mn) * i / 4, y = Y(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText((Math.round(v * 100) / 100) + '', 6, y + 3); }
  for (let s = 0; s <= dur; s++) { const x = X(s);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
    ctx.fillText(s + 's', x - 4, H - 6); }
  // sampled curve
  ctx.strokeStyle = '#00b248'; ctx.lineWidth = 2; ctx.beginPath();
  const N = 260;
  for (let i = 0; i <= N; i++) { const t = dur * i / N, v = evalProp(layer, prop, t);
    const x = X(t), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  // playhead
  ctx.strokeStyle = '#ff5470'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(X(state.time), padT); ctx.lineTo(X(state.time), H - padB); ctx.stroke();
  // keys + handles
  const keys = layer.tracks[prop] || [];
  graphState.pts = keys.map(k => ({ x: X(k.t), y: Y(k.v) }));
  const i = graphState.selKey;
  if (i >= 0 && keys[i] && keys[i + 1]) {
    const a = keys[i], b = keys[i + 1], dt = b.t - a.t, dv = b.v - a.v;
    const e = a.ease || [0, 0, 1, 1];
    graphState.h1 = { x: X(a.t + e[0] * dt), y: Y(a.v + e[1] * dv) };
    graphState.h2 = { x: X(b.t - (1 - e[2]) * dt), y: Y(b.v - (1 - e[3]) * dv) };
    ctx.strokeStyle = '#f5a400'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X(a.t), Y(a.v)); ctx.lineTo(graphState.h1.x, graphState.h1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(b.t), Y(b.v)); ctx.lineTo(graphState.h2.x, graphState.h2.y); ctx.stroke();
    for (const h of [graphState.h1, graphState.h2]) {
      ctx.fillStyle = '#ffb020'; ctx.beginPath(); ctx.arc(h.x, h.y, 5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#a8740c'; ctx.stroke();
    }
  } else { graphState.h1 = graphState.h2 = null; }
  keys.forEach((k, idx) => {
    const p = graphState.pts[idx];
    ctx.fillStyle = idx === i ? '#ffb020' : '#ffffff';
    ctx.strokeStyle = idx === i ? '#a8740c' : '#00b248'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.fill(); ctx.stroke();
  });
  const info = $('#graphKeyInfo');
  if (info) {
    const k = keys[i];
    info.textContent = k ? `Key ${i + 1}/${keys.length} · t=${k.t.toFixed(2)}s · v=${Math.round(k.v * 100) / 100} · ease [${(k.ease || [0, 0, 1, 1]).map(n => Math.round(n * 100) / 100).join(', ')}]` : (keys.length ? 'Click a key to select it; drag to move; drag its gold handles to shape the curve.' : 'No keyframes on ' + prop + ' yet — add them with ◆ in Properties.');
  }
}
(() => {
  const cv = $('#graphCv'); if (!cv) return;
  const pos = e => { const rect = cv.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; };
  const inv = () => {
    const g = graphGeom(); const layer = graphLayer(); if (!g || !layer) return null;
    const [mn, mx] = graphRange(layer, graphState.prop);
    const dur = Math.max(0.01, state.project.duration);
    return { t: px => (px - g.padL) / (g.W - g.padL - g.padR) * dur,
             v: py => mn + (1 - (py - g.padT) / (g.H - g.padT - g.padB)) * (mx - mn) };
  };
  cv.addEventListener('pointerdown', e => {
    const layer = graphLayer(); if (!layer) return;
    const p = pos(e), keys = layer.tracks[graphState.prop] || [];
    graphState.snap = snap();
    const near = (q, d) => q && Math.hypot(q.x - p.x, q.y - p.y) <= d;
    if (near(graphState.h1, 9)) graphState.drag = { mode: 'h1' };
    else if (near(graphState.h2, 9)) graphState.drag = { mode: 'h2' };
    else {
      const idx = (graphState.pts || []).findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) <= 10);
      if (idx >= 0) { graphState.selKey = idx; graphState.drag = { mode: 'key' }; }
      else { graphState.selKey = -1; const m = inv(); if (m) { graphState.drag = { mode: 'scrub' }; setTime(Math.max(0, Math.min(state.project.duration, m.t(p.x)))); } }
    }
    cv.setPointerCapture(e.pointerId); drawGraph();
  });
  cv.addEventListener('pointermove', e => {
    const layer = graphLayer(); if (!layer || !graphState.drag) return;
    const p = pos(e), m = inv(); if (!m) return;
    const keys = layer.tracks[graphState.prop] || [], i = graphState.selKey;
    const prop = graphState.prop;
    if (graphState.drag.mode === 'scrub') { setTime(Math.max(0, Math.min(state.project.duration, m.t(p.x)))); return; }
    const k = keys[i]; if (!k) return;
    if (graphState.drag.mode === 'key') {
      const prev = keys[i - 1], next = keys[i + 1];
      k.t = Math.max(prev ? prev.t + 0.01 : 0, Math.min(next ? next.t - 0.01 : state.project.duration, m.t(p.x)));
      k.v = m.v(p.y);
      if (prop === 'opacity') k.v = Math.max(0, Math.min(1, k.v));
      applyTime(state.time);
    } else {
      const a = keys[i], b = keys[i + 1]; if (!b) return;
      const dt = b.t - a.t, dv = b.v - a.v;
      if (!a.ease) a.ease = [0, 0, 1, 1]; else a.ease = a.ease.slice();
      if (graphState.drag.mode === 'h1') {
        a.ease[0] = Math.max(0, Math.min(1, (m.t(p.x) - a.t) / dt));
        if (Math.abs(dv) > 1e-9) a.ease[1] = (m.v(p.y) - a.v) / dv;
      } else {
        a.ease[2] = Math.max(0, Math.min(1, 1 - (b.t - m.t(p.x)) / dt));
        if (Math.abs(dv) > 1e-9) a.ease[3] = 1 - (b.v - m.v(p.y)) / dv;
      }
      applyTime(state.time);
    }
    drawGraph();
  });
  const finish = () => {
    if (graphState.drag && graphState.snap && graphState.snap !== snap()) {
      undoStack.push(graphState.snap); if (undoStack.length > 60) undoStack.shift(); redoStack = []; syncUndoBtns();
      buildTimelineRows();
    }
    graphState.drag = null; graphState.snap = null; drawGraph();
  };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);
  $('#btnGraph').addEventListener('click', () => {
    graphState.open = !graphState.open;
    $('#graphWrap').classList.toggle('hidden', !graphState.open);
    $('#btnGraph').classList.toggle('accent', graphState.open);
    if (graphState.open) { buildGraphChips(); drawGraph(); }
  });
  $('#graphClose').addEventListener('click', () => { graphState.open = false; $('#graphWrap').classList.add('hidden'); $('#btnGraph').classList.remove('accent'); });
  $('#graphEase').addEventListener('change', e => {
    const layer = graphLayer(); if (!layer) return;
    const k = (layer.tracks[graphState.prop] || [])[graphState.selKey]; if (!k) return;
    commit();
    const v = e.target.value.split(',').map(Number);
    k.ease = (v[0] === 0 && v[1] === 0 && v[2] === 1 && v[3] === 1) ? null : v;
    applyTime(state.time); drawGraph();
  });
  $('#graphDelKey').addEventListener('click', () => {
    const layer = graphLayer(); if (!layer) return;
    const keys = layer.tracks[graphState.prop] || [];
    if (graphState.selKey < 0 || !keys[graphState.selKey]) return;
    commit(); keys.splice(graphState.selKey, 1); graphState.selKey = -1;
    applyTime(state.time); buildTimelineRows(); drawGraph();
  });
  window.addEventListener('resize', drawGraph);
})();

/* ---------------- bundled fonts ---------------- */
const TEXT_FONTS = ['Cairo', 'Gram', 'Lifta', 'Lifta Swash', 'Azahar', 'Azahar Display', 'Amira Typo', 'Elgharib Hayyakum', 'Medad Platinum', 'Zain', 'Thick Naskh Swash', 'Tahoma 8px'];
(() => {
  const sel = $('#pFont');
  if (sel) for (const f of TEXT_FONTS) { const o = document.createElement('option'); o.value = f; o.textContent = f; sel.appendChild(o); }
  if (document.fonts && document.fonts.load) for (const f of TEXT_FONTS) { try { document.fonts.load('700 60px "' + f + '"'); document.fonts.load('60px "' + f + '"'); } catch (e) {} }
})();

/* ---------------- boot ---------------- */
$('#projName').value = state.project.name;
afterProjectLoad();

/* M2: build the effects browser last (EFFECT_DEFS must be initialized) */
buildFxBrowser();
const fxSearchEl = $('#fxSearch');
if (fxSearchEl) fxSearchEl.addEventListener('input', () => {
  const q = fxSearchEl.value.trim().toLowerCase();
  document.querySelectorAll('#fxBrowser .fx-tile').forEach(t => t.classList.toggle('hidden', !!q && !t.dataset.name.includes(q)));
});

/* ---------------- M4: export ---------------- */
let exportCancel = false;
function expSetStatus(txt) { const s = $('#expStatus'); if (s) s.textContent = txt; }
function expSetBar(pct) { const b = $('#expBar'); if (b) b.style.width = Math.round(pct) + '%'; }
$('#btnExport').addEventListener('click', () => { $('#exportModal').classList.remove('hidden'); });
$('#expClose').addEventListener('click', () => { if (!state.exporting) $('#exportModal').classList.add('hidden'); });
$('#expCancel').addEventListener('click', () => { exportCancel = true; });
async function runExport() {
  if (state.exporting || !window.bm) return;
  const format = $('#expFormat').value, fps = parseInt($('#expFps').value, 10) || 30, scale = parseFloat($('#expScale').value) || 1;
  const p = state.project;
  const EW = Math.max(2, Math.round(p.width * scale / 2) * 2), EH = Math.max(2, Math.round(p.height * scale / 2) * 2);
  const total = Math.max(1, Math.round(p.duration * fps));
  const session = await window.bm.exportStart();
  if (!session.ok) { expSetStatus('Could not start the export session.'); return; }
  exportCancel = false; state.exporting = true; state.playing = false;
  $('#expStart').disabled = true; $('#expCancel').classList.remove('hidden'); expSetBar(0);
  const prevTime = state.time;
  canvas.discardActiveObject();
  canvas.setWidth(EW); canvas.setHeight(EH);
  canvas.setViewportTransform([EW / p.width, 0, 0, EH / p.height, 0, 0]);
  const hideGuides = () => { for (const l of p.layers) if (l.type === 'null' || l.type === 'group') { const o = objByLayer.get(l.id); if (o) o.visible = false; } };
  try {
    for (let i = 0; i < total; i++) {
      if (exportCancel) break;
      await seekMediaForExport(i / fps);
      applyTime(i / fps); hideGuides(); canvas.renderAll();
      const rr = await window.bm.exportFrame(session.dir, i, canvas.toDataURL({ format: 'png' }));
      if (!rr.ok) throw new Error('frame write failed');
      expSetBar(((i + 1) / total) * 100);
      expSetStatus('Rendering frame ' + (i + 1) + ' / ' + total + ' · ' + EW + '×' + EH + ' @ ' + fps + ' fps');
    }
  } catch (e) {
    expSetStatus('Export failed while rendering frames.');
    await window.bm.exportAbort(session.dir);
    state.exporting = false; fitStage(); setTime(prevTime);
    $('#expStart').disabled = false; $('#expCancel').classList.add('hidden');
    return;
  }
  state.exporting = false; fitStage(); setTime(prevTime);
  if (exportCancel) { await window.bm.exportAbort(session.dir); expSetStatus('Export cancelled.'); }
  else {
    expSetStatus(format === 'pngseq' ? 'Saving frames…' : 'Encoding with FFmpeg…');
    const audios = p.layers.filter(l => l.type === 'audio' && l.mediaPath).map(l => ({ path: l.mediaPath, start: l.start, offset: l.offset || 0, volume: l.props && l.props.volume != null ? l.props.volume : 1 }));
    const fin = await window.bm.exportFinish(session.dir, { format, fps, name: p.name || 'exploring-motion', duration: p.duration, audios });
    if (fin.ok) { expSetStatus('Done → ' + fin.path); expSetBar(100); }
    else if (fin.canceled) expSetStatus('Save cancelled — nothing was written.');
    else expSetStatus('Encoding failed (FFmpeg). Details are in the main-process log.');
  }
  $('#expStart').disabled = false; $('#expCancel').classList.add('hidden');
}
$('#expStart').addEventListener('click', runExport);
