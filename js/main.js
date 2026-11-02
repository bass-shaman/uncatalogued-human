// Web viewer for BAPALON-style rooms (unofficial re-creation).
// Reads the same folder layout and CF.ini as the original engine:
//   CF.ini
//   DATA/TITLE/...            menu, splash, pause + UI sounds
//   DATA/NIGHT_<n>/ROOM_<m>/  ART, WALL, FLOOR, ROOF, MINI, CREDIT, FOOT, MUSIC ...
// Nothing here is specific to one project: add folders/files and it picks them up.

import * as THREE from './three.module.min.js';

const $ = (id) => document.getElementById(id);
const DATA = 'DATA/';
const TITLE = DATA + 'TITLE/';
const RW = 640, RH = 480;                    // virtual screen, same as the original engine
const IMG = ['png', 'jpg', 'jpeg', 'bmp', 'webp'];
const IMG_ART = ['jpg', 'png', 'jpeg', 'bmp', 'webp'];
const IMG_OPT = ['png', 'jpg', 'jpeg'];
const SND = ['mp3', 'ogg', 'wav'];
const SFX = ['wav', 'mp3', 'ogg'];

// world units (the engine's real units aren't documented, these were tuned by eye)
const ROOM_W = 800;
const EYE = 0.37;            // eye height as a fraction of Room_Height
const WALK = 150;            // units / second
const PLAYER_R = 16;
const ART_FRAC = 0.46;       // artwork height as a fraction of Room_Height
const ART_TOUCH = 26;        // walk this close to the artwork to move on

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};

/* ---------------------------------------------------------------- config */
function parseIni(text) {
  const out = {}; let sec = null;
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line[0] === ';' || line[0] === '#') continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) { sec = m[1].trim().toUpperCase(); out[sec] = out[sec] || {}; continue; }
    const i = line.indexOf('=');
    if (i < 0 || !sec) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    out[sec][k] = v !== '' && !isNaN(+v) ? +v : v;
  }
  return out;
}
let ini = {};
const setting = (k, d) => (ini.SETTINGS && ini.SETTINGS[k.toLowerCase()] !== undefined ? ini.SETTINGS[k.toLowerCase()] : d);
const roomCfg = (n, m) => ini[`NIGHT_${n}_ROOM_${m}`] || {};
const num = (o, k, d) => (o[k] !== undefined && o[k] !== '' && !isNaN(+o[k]) ? +o[k] : d);

/* ---------------------------------------------------------------- loading helpers */
function loadImgUrl(url) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res({ img: im, url });
    im.onerror = () => res(null);
    im.src = url;
  });
}
const imgCache = new Map();
// Try the extensions in priority order and keep the first one that exists.
function findImage(dir, base, exts = IMG) {
  const key = dir + base;
  if (!imgCache.has(key)) {
    imgCache.set(key, (async () => {
      for (const e of exts) { const r = await loadImgUrl(`${dir}${base}.${e}`); if (r) return r; }
      return null;
    })());
  }
  return imgCache.get(key);
}
const headCache = new Map();
async function urlExists(url) {
  if (!headCache.has(url)) {
    headCache.set(url, fetch(url, { method: 'HEAD' }).then((r) => r.ok && !/text\/html/.test(r.headers.get('content-type') || '')).catch(() => false));
  }
  return headCache.get(url);
}
async function findSound(dir, base, exts = SND) {
  for (const e of exts) { const u = `${dir}${base}.${e}`; if (await urlExists(u)) return u; }
  return null;
}
async function roomExists(n, m) {
  const d = `${DATA}NIGHT_${n}/ROOM_${m}/`;
  for (const f of ['ART.jpg', 'ART.png', 'WALL.png', 'WALL.jpg', 'FLOOR.png', 'FLOOR.jpg']) if (await urlExists(d + f)) return true;
  return false;
}
const roomCounts = new Map();
async function countRooms(n) {
  if (!roomCounts.has(n)) {
    roomCounts.set(n, (async () => { let c = 0; while (await roomExists(n, c + 1)) c++; return c; })());
  }
  return roomCounts.get(n);
}
async function countNights() { let c = 0; while (await roomExists(c + 1, 1)) c++; return c; }

/* ---------------------------------------------------------------- audio */
let actx = null, master = null, muted = store.get('bap_muted', '0') === '1';
const sfxBuf = {};
const music = new Audio();
music.loop = true; music.preload = 'auto';
let musicUrl = null, musicToken = 0;

function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(actx.destination);
  } catch (e) { actx = null; }
}
function silentWavUrl() {
  const n = 800, b = new DataView(new ArrayBuffer(44 + n));
  const w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true);
  b.setUint16(22, 1, true); b.setUint32(24, 8000, true); b.setUint32(28, 8000, true); b.setUint16(32, 1, true);
  b.setUint16(34, 8, true); w(36, 'data'); b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }));
}
async function loadSfx(key, dir, base) {
  if (sfxBuf[key] !== undefined && sfxBuf[key] !== 'pending') return sfxBuf[key];
  if (!actx) return null;
  for (const e of SFX) {
    try {
      const r = await fetch(`${dir}${base}.${e}`);
      if (!r.ok) continue;
      const buf = await actx.decodeAudioData(await r.arrayBuffer());
      sfxBuf[key] = buf; return buf;
    } catch (err) { /* try next extension */ }
  }
  sfxBuf[key] = null; return null;
}
function playSfx(key, vol = 1, rate = 1) {
  const b = sfxBuf[key];
  if (!actx || !b || b === 'pending') return;
  const s = actx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
  const g = actx.createGain(); g.gain.value = vol;
  s.connect(g); g.connect(master); s.start();
}
async function playMusic(dir, base) {
  const token = ++musicToken;
  const url = await findSound(dir, base);
  if (token !== musicToken) return;
  if (url === musicUrl && !music.paused) return;
  // quick fade out, swap source, play
  for (let v = music.volume; v > 0.05 && token === musicToken; v -= 0.12) { music.volume = Math.max(0, v); await sleep(25); }
  if (token !== musicToken) return;
  music.pause(); music.volume = 1; musicUrl = url;
  if (!url) { music.removeAttribute('src'); music.load(); return; }
  music.src = url; music.muted = muted;
  try { await music.play(); } catch (e) { /* will start on next interaction */ }
}
function stopMusic() { musicToken++; music.pause(); musicUrl = null; }
function setMuted(m) {
  muted = m; store.set('bap_muted', m ? '1' : '0');
  if (master) master.gain.value = m ? 0 : 1;
  music.muted = m;
  $('mute').innerHTML = m ? '&#128263;' : '&#128266;';
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) music.pause();
  else if (musicUrl && state !== 'start') music.play().catch(() => {});
});

/* ---------------------------------------------------------------- three.js */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, RW / RH, 0.5, 6000);
camera.rotation.order = 'YXZ';
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

function mkTex(img, { repeat = [1, 1], pixel = false } = {}) {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (pixel) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  else { t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = maxAniso; }
  t.needsUpdate = true;
  return t;
}
function placeholderArt() {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300;
  const g = c.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, 400, 300);
  g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(10, 10, 380, 280);
  g.fillStyle = '#fff'; g.font = 'bold 80px monospace'; g.textAlign = 'center'; g.fillText('ART', 200, 175);
  return c;
}

/* ---------------------------------------------------------------- room loading */
const assetCache = new Map();
function roomAssets(n, m) {
  const key = `${n}_${m}`;
  if (!assetCache.has(key)) {
    const dir = `${DATA}NIGHT_${n}/ROOM_${m}/`;
    assetCache.set(key, (async () => {
      const [wall, wall2, wall3, wall4, floor, roof, art, mini, credit, layer, interact] = await Promise.all([
        findImage(dir, 'WALL'), findImage(dir, 'WALL2', IMG_OPT), findImage(dir, 'WALL3', IMG_OPT), findImage(dir, 'WALL4', IMG_OPT),
        findImage(dir, 'FLOOR'), findImage(dir, 'ROOF'), findImage(dir, 'ART', IMG_ART), findImage(dir, 'MINI', IMG_OPT),
        findImage(dir, 'CREDIT'), findImage(dir, 'LAYER', IMG_OPT), findImage(dir, 'INTERACT', IMG_OPT),
      ]);
      return { dir, wall, wall2, wall3, wall4, floor, roof, art, mini, credit, layer, interact };
    })());
  }
  return assetCache.get(key);
}
function evictAssets(keep) {
  for (const k of [...assetCache.keys()]) if (!keep.includes(k)) assetCache.delete(k);
}

let room = null;      // current room object
let player = { x: 0, z: 0, yaw: 0, pitch: 0 };
let sens = clamp(+store.get('bap_sens', setting('Sensitivity', 6)) || 6, 1, 10);

function disposeRoom() {
  if (!room) return;
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
  });
  while (scene.children.length) scene.remove(scene.children[0]);
  scene.fog = null;
  room = null;
}

async function loadRoom(n, m) {
  const A = await roomAssets(n, m);
  const cfg = roomCfg(n, m);
  const footKey = `foot_${n}_${m}`;
  await loadSfx(footKey, A.dir, 'FOOT');
  disposeRoom();

  const size = Math.max(0.1, num(cfg, 'size', 1));
  const H = Math.max(60, num(cfg, 'room_height', 350));
  const R = clamp(num(cfg, 'texture_repeat', 2), 1, 99);
  const fov = clamp(num(cfg, 'fov', 55), 10, 120);
  const fogEnd = num(cfg, 'fog_end', -1);
  const hw = ROOM_W / 2;

  // fog (Fog_Color is an MS Access / BGR decimal value)
  const fc = Math.max(0, num(cfg, 'fog_color', 0));
  const fogCol = new THREE.Color().setRGB((fc & 255) / 255, ((fc >> 8) & 255) / 255, ((fc >> 16) & 255) / 255, THREE.SRGBColorSpace);
  scene.background = fogCol.clone();
  if (fogEnd > 0) scene.fog = new THREE.Fog(fogCol, 1, fogEnd); else scene.background = new THREE.Color(0x000000);

  const group = new THREE.Group(); scene.add(group);
  const basic = (o, fallback) => new THREE.MeshBasicMaterial(o ? { map: o } : { color: fallback });
  const tex = (a, rep) => (a ? mkTex(a.img, { repeat: rep }) : null);

  const wallRep = [R, (R * H) / ROOM_W];
  const flatRep = [R, R];
  const wallTex = tex(A.wall, wallRep);
  const wallFor = (a) => tex(a, wallRep) || wallTex;
  const wallMat = (t) => basic(t, 0x667788);
  const plane = (w, h, mat, pos, rot) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(...pos); mesh.rotation.set(...rot); group.add(mesh); return mesh;
  };
  // wall order: far = WALL, right = WALL2, behind = WALL3, left = WALL4 (missing ones fall back to WALL)
  plane(ROOM_W, H, wallMat(wallTex), [0, H / 2, -hw], [0, 0, 0]);
  plane(ROOM_W, H, wallMat(wallFor(A.wall2)), [hw, H / 2, 0], [0, -Math.PI / 2, 0]);
  plane(ROOM_W, H, wallMat(wallFor(A.wall3)), [0, H / 2, hw], [0, Math.PI, 0]);
  plane(ROOM_W, H, wallMat(wallFor(A.wall4)), [-hw, H / 2, 0], [0, Math.PI / 2, 0]);
  plane(ROOM_W, ROOM_W, basic(tex(A.floor, flatRep), 0x333333), [0, 0, 0], [-Math.PI / 2, 0, 0]);
  const roofTex = A.roof ? tex(A.roof, flatRep) : tex(A.wall, flatRep);
  plane(ROOM_W, ROOM_W, basic(roofTex, 0x555555), [0, H, 0], [Math.PI / 2, 0, 0]);

  // artwork: a camera-facing sprite in the middle of the room
  const artSrc = A.art ? A.art.img : placeholderArt();
  const artTex = mkTex(artSrc); artTex.wrapS = artTex.wrapT = THREE.ClampToEdgeWrapping;
  const aw = artSrc.naturalWidth || artSrc.width, ah = artSrc.naturalHeight || artSrc.height;
  const artH = H * ART_FRAC * num(cfg, 'art_scale', 1);
  const artW = artH * (aw / ah);
  const artBottom = H * 0.06;
  const art = new THREE.Sprite(new THREE.SpriteMaterial({ map: artTex, transparent: true, fog: num(cfg, 'art_fog', 0) === 1 }));
  art.scale.set(artW, artH, 1); art.position.set(0, artBottom + artH / 2, 0);
  scene.add(art);

  // the little animated critter that wanders the room
  let mini = null;
  if (A.mini) {
    const frames = Math.max(1, Math.round(A.mini.img.width / A.mini.img.height));
    const mt = mkTex(A.mini.img, { pixel: true }); mt.wrapS = mt.wrapT = THREE.ClampToEdgeWrapping; mt.repeat.set(1 / frames, 1);
    const ms = H * 0.1;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: mt, transparent: true, alphaTest: 0.05 }));
    sp.scale.set(ms * (A.mini.img.width / frames / A.mini.img.height), ms, 1);
    scene.add(sp);
    const rr = () => (Math.random() * 2 - 1) * hw * 0.82;
    mini = { sp, tex: mt, frames, ms, x: rr(), z: rr(), tx: rr(), tz: rr(), speed: 80 * num(cfg, 'mini_speed', 1), rr };
    sp.position.set(mini.x, ms / 2 + 3, mini.z);
  }

  // HUD bits
  if (A.credit) { $('credit').src = A.credit.url; $('credit').classList.remove('hidden'); } else $('credit').classList.add('hidden');
  const lf = Math.max(1, Math.round(num(cfg, 'layer_frames', 1)));
  const layerEl = $('layerfx');
  if (A.layer) { layerEl.style.backgroundImage = `url("${A.layer.url}")`; layerEl.style.backgroundSize = `${lf * 100}% 100%`; layerEl.style.backgroundPositionX = '0%'; layerEl.classList.remove('hidden'); }
  else { layerEl.style.backgroundImage = 'none'; layerEl.classList.add('hidden'); }
  const ia = $('interact');
  ia.innerHTML = ''; ia.classList.add('hidden');
  if (A.interact) { const im = new Image(); im.src = A.interact.url; ia.appendChild(im); }
  else { const sp = document.createElement('span'); sp.textContent = '▶ WALK INTO THE ART'; ia.appendChild(sp); }

  // camera + player
  camera.fov = fov; camera.updateProjectionMatrix();
  const r = PLAYER_R / size;
  const needDist = (artH / (2 * Math.tan((fov * Math.PI) / 360))) * 1.1;
  const spawn = clamp(Math.max(hw * 0.62, needDist), 120, hw - r - 10);
  player = { x: 0, z: spawn, yaw: 0, pitch: 0 };

  room = { n, m, cfg, A, footKey, size, H, hw, r, eye: (EYE * H) / size, speed: (WALK * num(cfg, 'speed', 1)) / size, art, artH, mini, lf, layerEl, bobT: 0, stepT: 0, lookAtArt: false };
  evictAssets([`${n}_${m}`, `${n}_${m + 1}`]);
  playMusic(A.dir, 'MUSIC');
  // warm the next room's pictures in the background
  roomExists(n, m + 1).then((ok) => { if (ok) roomAssets(n, m + 1); });
}

/* ---------------------------------------------------------------- state / UI */
let state = 'boot';            // boot, start, splash, menu, loading, play, pause
let nightCount = 1, nightIdx = 1, warping = false, shake = 0, touchMode = matchMedia('(pointer: coarse)').matches, dragMode = false;
const keys = {};
const joy = { x: 0, y: 0 };
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

function layout() {
  const s = Math.min(innerWidth / RW, innerHeight / RH);
  $('stage').style.transform = `translate(${-RW * s / 2}px,${-RH * s / 2}px) scale(${s})`;
}
addEventListener('resize', layout); layout();

function setScreens(which) {
  document.body.dataset.s = which;
  for (const id of ['menu', 'pause', 'splash', 'loading', 'start']) show(id, id === which);
  show('hud', which === 'hud');
  $('pausebtn').style.display = which === 'hud' && touchMode ? 'block' : 'none';
}

let nightImg = null;
function updateNightLabel() {
  const el = $('nightlabel');
  const nw = nightImg ? nightImg.img.naturalWidth : 320 * nightCount, nh = nightImg ? nightImg.img.naturalHeight : 96;
  const fw = nw / nightCount;
  el.style.width = `${fw}px`; el.style.height = `${nh}px`;
  el.style.left = `${320 - fw / 2}px`; el.style.top = `${205 - nh / 2}px`;
  el.style.backgroundSize = `${nw}px ${nh}px`;
  el.style.backgroundPosition = `${-(nightIdx - 1) * fw}px 0`;
}

async function showMenu() {
  state = 'menu';
  disposeRoom();
  setScreens('menu');
  show('clickhint', false);
  playMusic(TITLE, 'LOOP');
}

async function runSplash() {
  state = 'splash'; setScreens('splash');
  const seq = [['SPLASH_1', 'splash1', 'splash1len'], ['SPLASH_2', 'splash2', 'splash2len']];
  for (const [img, snd, lenKey] of seq) {
    const a = await findImage(TITLE, img, ['jpg', 'png']);
    if (!a) continue;
    if (state !== 'splash') return;
    $('splashimg').src = a.url; playSfx(snd);
    await new Promise((res) => { splashSkip = res; setTimeout(res, clamp(+setting(lenKey, 2), 0.3, 12) * 1000); });
  }
  if (state === 'splash') showMenu();
}
let splashSkip = () => {};
$('splash').addEventListener('click', () => splashSkip());

async function enterRoom(n, m, { lock = true } = {}) {
  if (lock) tryLock();
  state = 'loading'; setScreens('loading');
  stopMusic();
  await loadRoom(n, m);
  state = 'play'; setScreens('hud');
  $('flash').style.opacity = 0;
  buildRoomJump(n);
}
async function startNight(n) {
  playSfx('click');
  await enterRoom(n, 1);
}

async function warpNext() {
  if (warping || state !== 'play' || !room) return;
  warping = true;
  playSfx('warp');
  if (+setting('Shake_Effects', 1)) shake = 0.7;
  $('flash').style.transition = 'opacity .45s'; $('flash').style.opacity = 1;
  await sleep(480);
  const { n, m } = room;
  if (await roomExists(n, m + 1)) {
    await loadRoom(n, m + 1);
    buildRoomJump(n);
  } else {
    if (document.pointerLockElement) document.exitPointerLock();
    nightIdx = Math.min(nightCount, n + 1 > nightCount ? 1 : n + 1);
    updateNightLabel();
    await showMenu();
  }
  $('flash').style.transition = 'opacity .6s'; $('flash').style.opacity = 0;
  warping = false;
}

async function buildRoomJump(n) {
  const cnt = await countRooms(n);
  const box = $('roomjumpbtns'); box.innerHTML = '';
  for (let i = 1; i <= cnt; i++) {
    const b = document.createElement('button'); b.textContent = i;
    if (room && room.m === i) b.classList.add('cur');
    b.addEventListener('click', async (e) => {
      e.stopPropagation(); playSfx('click');
      closePause(false);
      await enterRoom(n, i);
    });
    box.appendChild(b);
  }
}

/* ---- pause ---- */
let pausedAt = 0;
function openPause() {
  if (state !== 'play') return;
  state = 'pause'; pausedAt = performance.now(); setScreens('pause'); show('clickhint', false);
  $('sensNum').textContent = sens;
  if (document.pointerLockElement) document.exitPointerLock();
}
function closePause(relock = true) {
  state = 'play'; setScreens('hud');
  if (relock) tryLock();
}
function setSens(v) { sens = clamp(v, 1, 10); store.set('bap_sens', sens); $('sensNum').textContent = sens; playSfx('click'); }

/* ---- pointer lock ---- */
function tryLock() {
  if (touchMode || dragMode) return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
}
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'play' && !warping) openPause();
});
if (!canvas.requestPointerLock) dragMode = true;
$('stage').addEventListener('click', () => { if (state === 'play' && !touchMode && !document.pointerLockElement && !dragMode) tryLock(); });
document.addEventListener('mousemove', (e) => {
  if (state !== 'play') return;
  if (document.pointerLockElement === canvas || (dragMode && e.buttons & 1)) {
    const k = 0.0004 * sens;
    player.yaw -= e.movementX * k;
    player.pitch = clamp(player.pitch - e.movementY * k, -1.35, 1.35);
  }
});

/* ---- keyboard ---- */
addEventListener('keydown', (e) => {
  if (e.repeat && (e.code === 'F4' || e.code === 'F9')) return;
  keys[e.code] = true;
  if (e.code === 'F4') { e.preventDefault(); toggleFullscreen(); }
  else if (e.code === 'F9') { e.preventDefault(); screenshot(); }
  else if (e.code === 'KeyM') setMuted(!muted);
  else if (e.code === 'Escape') { if (state === 'play') openPause(); else if (state === 'pause' && performance.now() - pausedAt > 400) closePause(); }
  if (state === 'play' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function toggleFullscreen() {
  const el = $('wrap');
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
}
function screenshot() {
  if (!room) return;
  renderer.render(scene, camera);
  const c = document.createElement('canvas'); c.width = RW; c.height = RH;
  const g = c.getContext('2d');
  g.drawImage(canvas, 0, 0, RW, RH);
  const cr = $('credit');
  if (!cr.classList.contains('hidden') && cr.naturalWidth) g.drawImage(cr, RW - cr.naturalWidth, RH - cr.naturalHeight);
  c.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = `screenshot_room${room.m}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

/* ---- touch ---- */
let tMove = null, tLook = null;
addEventListener('pointerdown', (e) => { touchMode = e.pointerType === 'touch'; });
function touchStart(e) {
  if (state !== 'play') return;
  if (e.target && e.target.closest && e.target.closest('button')) return;
  touchMode = true;
  for (const t of e.changedTouches) {
    if (t.target && t.target.id === 'pausebtn') continue;
    if (t.clientX < innerWidth / 2 && tMove === null) {
      tMove = { id: t.identifier, x: t.clientX, y: t.clientY };
      const pad = $('padL'); pad.style.display = 'block'; pad.style.left = `${t.clientX - 55}px`; pad.style.top = `${t.clientY - 55}px`;
      $('knob').style.transform = 'translate(0,0)';
    } else if (tLook === null) tLook = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
  e.preventDefault();
}
function touchMoveEv(e) {
  if (state !== 'play') return;
  for (const t of e.changedTouches) {
    if (tMove && t.identifier === tMove.id) {
      let dx = (t.clientX - tMove.x) / 50, dy = (t.clientY - tMove.y) / 50;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      joy.x = dx; joy.y = dy;
      $('knob').style.transform = `translate(${dx * 38}px,${dy * 38}px)`;
    } else if (tLook && t.identifier === tLook.id) {
      const k = 0.0009 * sens;
      player.yaw -= (t.clientX - tLook.x) * k;
      player.pitch = clamp(player.pitch - (t.clientY - tLook.y) * k, -1.35, 1.35);
      tLook.x = t.clientX; tLook.y = t.clientY;
    }
  }
  e.preventDefault();
}
function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (tMove && t.identifier === tMove.id) { tMove = null; joy.x = joy.y = 0; $('padL').style.display = 'none'; }
    if (tLook && t.identifier === tLook.id) tLook = null;
  }
}
document.addEventListener('touchstart', touchStart, { passive: false });
document.addEventListener('touchmove', touchMoveEv, { passive: false });
document.addEventListener('touchend', touchEnd);
document.addEventListener('touchcancel', touchEnd);
$('pausebtn').addEventListener('click', openPause);

/* ---------------------------------------------------------------- main loop */
const clock = new THREE.Clock();
let layerT = 0, miniT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (!room || (state !== 'play' && state !== 'pause')) return;
  if (state === 'play' && !warping) update(dt);
  else if (state === 'play') updateWorld(dt);
  renderer.render(scene, camera);
}

function updateWorld(dt) {
  // animation that keeps running during warps
  layerT += dt; miniT += dt;
  if (room.A.layer && room.lf > 1) room.layerEl.style.backgroundPositionX = `${(Math.floor(layerT * 8) % room.lf) / (room.lf - 1) * 100}%`;
  const mi = room.mini;
  if (mi) {
    mi.tex.offset.x = (Math.floor(miniT * 8) % mi.frames) / mi.frames;
    if (mi.speed > 0) {
      const dx = mi.tx - mi.x, dz = mi.tz - mi.z, d = Math.hypot(dx, dz);
      if (d < 6) { mi.tx = mi.rr(); mi.tz = mi.rr(); }
      else { mi.x += (dx / d) * mi.speed * dt; mi.z += (dz / d) * mi.speed * dt; }
      mi.sp.position.set(mi.x, mi.ms / 2 + 3, mi.z);
    }
  }
}

function update(dt) {
  updateWorld(dt);
  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - joy.y;
  let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
  const l = Math.hypot(f, s); if (l > 1) { f /= l; s /= l; }
  const moving = l > 0.05;
  if (moving) {
    const v = room.speed * dt;
    player.x += (-sinY * f + cosY * s) * v;
    player.z += (-cosY * f - sinY * s) * v;
    const lim = room.hw - room.r - 4;
    player.x = clamp(player.x, -lim, lim); player.z = clamp(player.z, -lim, lim);
    room.bobT += dt * 9; room.stepT += dt * Math.min(1, l) * Math.max(0.6, room.speed / WALK) * room.size;
    if (room.stepT > 0.46) { room.stepT = 0; playSfx(room.footKey, 0.8, 0.94 + Math.random() * 0.12); }
  } else { room.bobT *= 0.9; }

  const bob = +setting('Head_Bob', 1) && moving ? Math.sin(room.bobT) * 3 / room.size : 0;
  camera.position.set(player.x, room.eye + bob, player.z);
  if (shake > 0) {
    shake = Math.max(0, shake - dt);
    const a = shake * 9 / room.size;
    camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a;
  }
  camera.rotation.set(player.pitch, player.yaw, 0);

  // artwork: touch it to move on, show a hint when looking at it
  const ax = -player.x, az = -player.z, dist = Math.hypot(ax, az);
  if (dist < ART_TOUCH + room.r) { warpNext(); return; }
  const fx = -sinY * Math.cos(player.pitch), fz = -cosY * Math.cos(player.pitch), fy = Math.sin(player.pitch);
  const ay = room.art.position.y - camera.position.y, dl = Math.hypot(ax, ay, az) || 1;
  const look = (fx * ax + fy * ay + fz * az) / dl > 0.94 && dist < 360;
  if (look !== room.lookAtArt) { room.lookAtArt = look; show('interact', look); }
  show('clickhint', !touchMode && !dragMode && !document.pointerLockElement);
}

/* ---------------------------------------------------------------- menu wiring */
function wireMenu() {
  $('nightlabel').addEventListener('click', () => startNight(nightIdx));
  $('arrL').addEventListener('click', () => { playSfx('click'); nightIdx = nightIdx <= 1 ? nightCount : nightIdx - 1; updateNightLabel(); });
  $('arrR').addEventListener('click', () => { playSfx('click'); nightIdx = nightIdx >= nightCount ? 1 : nightIdx + 1; updateNightLabel(); });
  $('exitbtn').addEventListener('click', () => {
    playSfx('click');
    const url = setting('Exit_URL', '');
    if (url) { location.href = url; return; }
    stopMusic(); state = 'start'; setScreens('start');
    $('startsub').textContent = 'THANK YOU FOR VISITING · CLICK TO ENTER AGAIN';
    $('start').onclick = () => { $('start').onclick = null; initAudio(); music.src = silentWavUrl(); music.play().catch(() => {}); runSplash(); };
  });
  $('hotResume').addEventListener('click', () => { playSfx('click'); closePause(); });
  $('hotSens').addEventListener('click', () => setSens(sens >= 10 ? 1 : sens + 1));
  $('sensUp').addEventListener('click', (e) => { e.stopPropagation(); setSens(sens + 1); });
  $('sensDn').addEventListener('click', (e) => { e.stopPropagation(); setSens(sens - 1); });
  $('hotQuit').addEventListener('click', async () => { playSfx('click'); if (document.pointerLockElement) document.exitPointerLock(); await showMenu(); });
  $('mute').addEventListener('click', () => setMuted(!muted));
}

/* ---------------------------------------------------------------- boot */
function fatal(msg) {
  const el = $('err'); el.style.display = 'flex'; el.innerHTML = `<div>${msg}</div>`;
}

async function boot() {
  const hint = document.createElement('div');
  hint.id = 'clickhint'; hint.className = 'hidden'; hint.textContent = 'CLICK TO LOOK AROUND';
  $('hud').appendChild(hint);
  setMuted(muted);
  renderer.setSize(RW, RH, false);

  try {
    const r = await fetch('CF.ini');
    if (r.ok) ini = parseIni(await r.text());
  } catch (e) { /* defaults */ }
  const res = Math.max(1, Math.min(3, +setting('Resolution_Scale', 1) || 1));
  renderer.setSize(RW * res, RH * res, false);
  canvas.style.width = RW + 'px'; canvas.style.height = RH + 'px';
  if (setting('Title', '')) $('starttitle').textContent = setting('Title', '');

  if (!(await roomExists(1, 1))) {
    fatal('Could not find <b>DATA/NIGHT_1/ROOM_1</b>.<br>If you opened index.html straight from a folder, the browser blocks file loading &mdash; use the published GitHub Pages link or a local web server instead.');
    return;
  }
  // title assets
  const [menubg, pausebg, night, arr, exit, msg] = await Promise.all([
    findImage(TITLE, 'MENU', ['jpg', 'png']), findImage(TITLE, 'PAUSE', ['png', 'jpg']), findImage(TITLE, 'NIGHT'),
    findImage(TITLE, 'ARR'), findImage(TITLE, 'EXIT'), findImage(TITLE, 'MSG_BOX'),
  ]);
  if (menubg) $('menubg').src = menubg.url;
  if (pausebg) $('pausebg').src = pausebg.url;
  if (arr) { $('arrL').src = arr.url; $('arrR').src = arr.url; }
  if (exit) $('exitbtn').src = exit.url;
  nightImg = night;
  if (night) $('nightlabel').style.backgroundImage = `url("${night.url}")`;
  nightCount = Math.max(1, await countNights());
  updateNightLabel();
  wireMenu();

  const qs = new URLSearchParams(location.search);
  state = 'start'; setScreens('start');
  $('startsub').textContent = 'CLICK TO ENTER';
  const go = async () => {
    $('start').onclick = null;
    initAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    // unlock the shared <audio> element for later src changes (iOS)
    music.src = silentWavUrl(); music.play().catch(() => {});
    loadSfx('click', TITLE, 'Click'); loadSfx('warp', TITLE, 'Warp'); loadSfx('splash1', TITLE, 'Splash_1'); loadSfx('splash2', TITLE, 'Splash_2');
    await sleep(60);
    if (qs.get('room')) { await enterRoom(+qs.get('night') || 1, +qs.get('room') || 1); return; }
    if (setting('Skip_Splash', 0)) showMenu(); else runSplash();
  };
  $('start').onclick = go;
  $('fs').addEventListener('click', toggleFullscreen);
}

window.__bap = { get state() { return state; }, get room() { return room && { n: room.n, m: room.m }; }, enterRoom, showMenu, warpNext, player: () => player, camera, renderer, scene };
requestAnimationFrame(frame);
boot();
