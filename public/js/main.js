import * as THREE from 'three';
import { HEROES, FACTIONS, heroPool } from '/shared/heroes.js';
import { MAP, collideCircle, rayVsWalls, inSite } from '/shared/map.js';
import { makeCharacter, makeSentry, makeBomb } from './chars.js';
import { AUDIO } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ================= 网络 =================
let ws, myId = null, isHost = false, myTeam = null, myHero = null, winRounds = 5;
let roomPlayers = [];

function connect() {
  return new Promise((resolve) => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onopen = () => resolve();
    ws.onmessage = (ev) => handleMsg(JSON.parse(ev.data));
    ws.onclose = () => { addChat('game', '⚠️ 与服务器断开，请刷新页面', true); };
  });
}
function sendWS(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// ================= 界面切换 =================
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  $(id).classList.add('on');
}

// ================= 大厅 =================
function renderLobby() {
  $('room-code').textContent = lobbyCode || '----';
  for (const team of ['monkey', 'timor']) {
    const list = $(`team-${team}-list`);
    list.innerHTML = '';
    roomPlayers.filter(p => p.team === team).forEach(p => {
      const d = document.createElement('div');
      d.className = 'p-row';
      d.innerHTML = `<span>${p.id === myId ? '👉 ' : ''}${esc(p.name)}${p.id === hostId ? ' 👑' : ''}</span><span style="color:${p.hero ? HEROES[p.hero].color : '#5a6a8b'}">${p.hero ? HEROES[p.hero].name : '未选英雄'}</span>`;
      list.appendChild(d);
    });
  }
  const grid = $('hero-grid');
  grid.innerHTML = '';
  if (myTeam) {
    for (const h of heroPool(myTeam)) {
      const c = document.createElement('div');
      c.className = 'hero-card' + (myHero === h.id ? ' sel' : '');
      c.innerHTML = `<div class="hero-dot" style="background:${h.color}"></div>
        <div class="hc-name" style="color:${h.color}">${h.name}</div>
        <div class="hc-info">${h.weapon.name}<br>Q ${h.skill.name}：${h.skill.desc}<br>被动：${h.passiveDesc}</div>`;
      c.onclick = () => { AUDIO.click(); myHero = h.id; sendWS({ t: 'hero', hero: h.id }); renderLobby(); };
      grid.appendChild(c);
    }
  }
  const specs = roomPlayers.filter(p => p.spectator);
  document.getElementById('lobby-hint').textContent = specs.length ? '观战: ' + specs.map(p => p.name).join('、') + '（开局后仍可加入观战）' : '选择阵营和英雄；人数不足将由 AI 补齐 3v3';
  $('btn-start').style.display = isHost ? '' : 'none';
}

$('btn-create').onclick = async () => {
  AUDIO.click();
  const name = $('name-input').value.trim() || '无名玩家';
  await connect();
  sendWS({ t: 'create', name });
};
$('btn-join').onclick = async () => {
  AUDIO.click();
  const code = $('code-input').value.trim();
  if (code.length !== 4) { $('name-err').textContent = '请输入 4 位房间码'; return; }
  const name = $('name-input').value.trim() || '无名玩家';
  await connect();
  sendWS({ t: 'join', code, name });
};
$('btn-side-monkey').onclick = () => { AUDIO.click(); myTeam = 'monkey'; sendWS({ t: 'side', side: 'monkey' }); };
$('btn-side-timor').onclick = () => { AUDIO.click(); myTeam = 'timor'; sendWS({ t: 'side', side: 'timor' }); };
$('btn-start').onclick = () => { AUDIO.click(); sendWS({ t: 'start' }); };

$('lobby-chat-input').onkeydown = (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) { sendWS({ t: 'chat', text: e.target.value.trim() }); e.target.value = ''; }
};

function addChat(where, html, sys = false, name = null, team = null) {
  const log = where === 'lobby' ? $('lobby-chat-log') : $('game-chat-log');
  const d = document.createElement('div');
  d.className = 'cm';
  d.innerHTML = sys ? `<i style="color:#9aa9c7">${esc(html)}</i>` : `<b style="color:${team === 'monkey' ? '#ff8a8a' : '#8ab8ff'}">${esc(name)}:</b> ${esc(html)}`;
  log.appendChild(d);
  while (log.children.length > 25) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

// ================= 消息分发 =================
let lobbyCode = null, hostId = null;

function handleMsg(m) {
  switch (m.t) {
    case 'spectate_join':
      myId = m.id; lobbyCode = m.code; winRounds = m.winRounds;
      spectateMode = true; inGame = true;
      initGame();
      show('screen-game');
      document.getElementById('hud-bottom').style.display = 'none';
      document.getElementById('spectate-label').style.display = 'block';
      banner('👁 观战模式 · 点击画面切换视角 · 比赛结束后自动进入大厅', 4000);
      break;
    case 'joined':
      myId = m.id; hostId = m.host; isHost = m.host === myId; lobbyCode = m.code; winRounds = m.cfg.winRounds;
      show('screen-lobby');
      break;
    case 'err': $('name-err').textContent = m.msg; break;
    case 'lobby':
      hostId = m.host; isHost = m.host === myId;
      spectateMode = false;
      document.getElementById('hud-bottom').style.display = '';
      roomPlayers = m.players;
      const me = m.players.find(p => p.id === myId);
      if (me) { myTeam = me.team; myHero = me.hero; }
      if (inGame) { endGameToLobby(); } else { show('screen-lobby'); renderLobby(); }
      break;
    case 'match_start':
      inGame = true;
      initGame();
      show('screen-game');
      banner('比赛开始！' + (myTeam === 'monkey' ? '机械猴子先进攻' : '帝汶家族先进攻'), 2500);
      break;
    case 'round_start': onRoundStart(m); break;
    case 'phase': if (m.phase === 'combat') banner('开战！', 1200); break;
    case 'snap': onSnap(m); break;
    case 'shot': fxTracer(m.from, m.to, m.color); if (!m.sentry) AUDIO.shoot(); break;
    case 'damaged': onDamaged(m); break;
    case 'hitmark': onHitmark(m); break;
    case 'kill': onKill(m); break;
    case 'died': onDied(m); break;
    case 'planted':
      banner('💣 搏击操已开始播放！', 2000);
      AUDIO.startBGM();
      $('bomb-banner').style.display = 'block';
      bombPlanted(m);
      break;
    case 'bomb_pick': break;
    case 'round_end': onRoundEnd(m); break;
    case 'match_end': onMatchEnd(m); break;
    case 'sentry_add': addSentryFx(m); break;
    case 'sentry_hit': break;
    case 'sentry_die': removeSentryFx(m.id); break;
    case 'fx': onFx(m); break;
    case 'chat':
      addChat('lobby', m.text, m.sys, m.name, m.team);
      if (inGame) addChat('game', m.text, m.sys, m.name, m.team);
      break;
  }
}

// ================= 游戏 =================
let inGame = false, gameInited = false, spectateMode = false;
let scene, camera, renderer, clock;
let chars = new Map();      // pid -> char state
let sentriesFx = new Map(); // sid -> fx
let gasFx = [];             // {group, key}
let bombFx = null, bombState = { planted: false, x: 0, z: 0 };
let selfP = { x: 0, y: 0, z: 0, vy: 0, ry: 0, hp: 100, alive: false, fly: false, slow: false, armor: false, hasBomb: false, skillCd: 0 };
let targets = new Map();    // pid -> {x,y,z,ry}
let camYaw = 0, camPitch = -0.25, viewmodel = null, vmKick = 0;
let keys = {}, chatting = false, dead = false, spectateIdx = 0;
let lastSnap = null, forceSelfPos = false, shake = 0, lastShotAt = 0;
let roundInfo = { round: 1, wins: { monkey: 0, timor: 0 }, attacking: 'monkey' };

function initGame() {
  if (gameInited) { resetMatchVisuals(); return; }
  gameInited = true;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1526);
  scene.fog = new THREE.Fog(0x0d1526, 45, 110);
  camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 200);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.domElement.style.pointerEvents = 'auto';
  $('screen-game').appendChild(renderer.domElement);
  clock = new THREE.Clock();

  // 星空
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 400; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.45 + 0.08, r = 150;
    starPos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaac4ff, size: 0.7, sizeAttenuation: false })));

  viewmodel = new THREE.Group();
  const vg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.5 }));
  const vgTip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12), new THREE.MeshStandardMaterial({ color: 0xffd54d, emissive: 0x664400, emissiveIntensity: 0.8 }));
  vgTip.position.z = -0.3;
  viewmodel.add(vg, vgTip);
  viewmodel.position.set(0.28, -0.22, -0.5);
  camera.add(viewmodel);
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0xbdd2ff, 0x2a3550, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
  sun.position.set(30, 45, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, far: 120 });
  scene.add(sun);

  buildMap();
  bindGameInput();
  requestAnimationFrame(gameLoop);
}

function buildMap() {
  // 地面
  const ground = new THREE.Mesh(new THREE.BoxGeometry(84, 1, 84),
    new THREE.MeshStandardMaterial({ color: 0x2a3f66, roughness: 0.95 }));
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(80, 40, 0x46639b, 0x35496e);
  grid.position.y = 0.02;
  scene.add(grid);

  // 墙体
  let wallIdx = 0;
  for (const wl of MAP.walls) {
    const isCrate = wl.h <= 1.3;
    const m = new THREE.Mesh(new THREE.BoxGeometry(wl.w, wl.h, wl.d),
      new THREE.MeshStandardMaterial({ color: isCrate ? 0x8a6a3f : (wallIdx++ % 2 ? 0x3d5580 : 0x36497a), roughness: 0.85 }));
    m.position.set(wl.x, wl.h / 2, wl.z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // 包点标识
  for (const [key, s] of Object.entries(MAP.sites)) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(s.hw * 2, s.hd * 2),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xc77dff : 0xffb84d, transparent: true, opacity: 0.18 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(s.x, 0.03, s.z);
    scene.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.min(s.hw, s.hd) - 0.4, Math.min(s.hw, s.hd), 40),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xc77dff : 0xffb84d, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.04, s.z);
    scene.add(ring);
  }

  // 包点悬浮字母
  for (const [key, s] of Object.entries(MAP.sites)) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 90px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = key === 'A' ? '#c77dff' : '#ffb84d'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#fff'; ctx.fillText(key, 64, 64);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.9 }));
    sp.scale.set(2.5, 2.5, 1);
    sp.position.set(s.x, 5.5, s.z);
    scene.add(sp);
  }

  // 包点氛围光
  const lightA = new THREE.PointLight(0xc77dff, 30, 26); lightA.position.set(MAP.sites.A.x, 5, MAP.sites.A.z); scene.add(lightA);
  const lightB = new THREE.PointLight(0xffb84d, 30, 26); lightB.position.set(MAP.sites.B.x, 5, MAP.sites.B.z); scene.add(lightB);
  // 三条车道的地面引导色带
  const laneMat = new THREE.MeshBasicMaterial({ color: 0x3d5a99, transparent: true, opacity: 0.35 });
  for (const [lx, lz, lw, ld] of [[-22, 8, 3, 44], [22, 8, 3, 44], [0, 12, 2.2, 30]]) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(lw, ld), laneMat);
    lane.rotation.x = -Math.PI / 2; lane.position.set(lx, 0.015, lz - 8);
    scene.add(lane);
  }

  // A点 帝汶岛蚊巢
  const nest = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.9 - i * 0.15, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a2a7a, roughness: 0.6, emissive: 0x2a0a4a, emissiveIntensity: 0.5 }));
    s.position.set((Math.random() - 0.5) * 2, 0.6 + i * 0.8, (Math.random() - 0.5) * 2);
    nest.add(s);
  }
  nest.position.set(MAP.sites.A.x, 0, MAP.sites.A.z - 6);
  scene.add(nest);

  // B点 搏击操能量核心 + 乔纳森神像
  const statue = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.7 });
  const sBody = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 0.7), gold); sBody.position.y = 2.1;
  const sHead = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), gold); sHead.position.y = 3.6;
  const sArmL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), gold);
  sArmL.position.set(-0.75, 2.7, 0); sArmL.rotation.z = 0.7; // 搏击操Pose
  const sArmR = sArmL.clone(); sArmR.position.x = 0.75; sArmR.rotation.z = -0.7;
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x3a4a6b, roughness: 0.7 }));
  base.position.y = 0.5;
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.5),
    new THREE.MeshStandardMaterial({ color: 0x66ffcc, emissive: 0x22cc88, emissiveIntensity: 1.2 }));
  core.position.y = 4.6;
  statue.add(base, sBody, sHead, sArmL, sArmR, core);
  statue.position.set(MAP.sites.B.x, 0, MAP.sites.B.z - 6);
  statue.traverse(o => { o.castShadow = true; });
  scene.add(statue);

  // 朱玮岩岩浆带（西南角彩蛋）
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(10, 6),
    new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xcc2200, emissiveIntensity: 0.8 }));
  lava.rotation.x = -Math.PI / 2;
  lava.position.set(-33, 0.05, 32);
  scene.add(lava);
  for (let i = 0; i < 3; i++) {
    const amber = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xffbb33, transparent: true, opacity: 0.65, roughness: 0.2 }));
    amber.position.set(-31 + i * 2, 0.7, 29);
    scene.add(amber);
  }
}

// ---------- 输入 ----------
function bindGameInput() {
  addEventListener('keydown', (e) => {
    if (chatting) return;
    keys[e.code] = true;
    if (e.code === 'KeyQ') trySkill();
    if (e.code === 'KeyE') { keys.interact = true; sendWS({ t: 'interact', hold: true }); }
    if (e.code === 'Tab') { e.preventDefault(); renderScoreboard(); $('scoreboard').style.display = 'block'; }
    if (e.code === 'Enter') { e.preventDefault(); openGameChat(); }
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'KeyE') { keys.interact = false; sendWS({ t: 'interact', hold: false }); }
    if (e.code === 'Tab') $('scoreboard').style.display = 'none';
  });
  renderer.domElement.addEventListener('click', () => {
    if (!chatting && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
    if (dead) cycleSpectate();
  });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    camYaw -= e.movementX * 0.0026;
    camPitch = Math.max(-1.4, Math.min(1.4, camPitch - e.movementY * 0.0026));
  });
  addEventListener('mousedown', (e) => {
    if (e.button === 0 && document.pointerLockElement === renderer.domElement) keys.shoot = true;
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) keys.shoot = false; });
  // 分享链接预填房间码（如 ?code=1234）
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) document.getElementById('code-input').value = urlCode;

addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  $('game-chat-input').onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && e.target.value.trim()) { sendWS({ t: 'chat', text: e.target.value.trim() }); e.target.value = ''; closeGameChat(); }
    else if (e.key === 'Escape' || (e.key === 'Enter' && !e.target.value.trim())) closeGameChat();
  };
}
function openGameChat() { chatting = true; const i = $('game-chat-input'); i.style.display = 'block'; i.focus(); document.exitPointerLock(); }
function closeGameChat() { chatting = false; $('game-chat-input').style.display = 'none'; renderer.domElement.focus(); }

function trySkill() {
  if (!selfP.alive || selfP.skillCd > 0) return;
  const d = camDir();
  sendWS({ t: 'skill', dx: d.x, dz: d.z });
  AUDIO.skill();
}
function camDir() {
  return new THREE.Vector3(-Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), -Math.cos(camYaw) * Math.cos(camPitch)).normalize();
}

// ---------- 快照处理 ----------
function onSnap(m) {
  lastSnap = m; window.__snap = m;
  roundInfo = { round: m.round, wins: m.wins, attacking: m.attacking };
  const me = m.players.find(p => p.id === myId);
  if (me) {
    if (forceSelfPos) { selfP.x = me.x; selfP.z = me.z; selfP.y = me.y; selfP.vy = 0; forceSelfPos = false; }
    selfP.hp = me.hp; selfP.alive = me.alive;
    selfP.slow = me.slow; selfP.armor = me.armor; selfP.fly = me.fly;
    selfP.hasBomb = me.hasBomb; selfP.skillCd = me.skillCd;
    if (!me.alive && !dead) onDiedLocal();
    if (me.alive && dead) { dead = false; $('spectate-label').style.display = 'none'; }
  }
  for (const ps of m.players) {
    if (ps.id === myId) { targets.set(ps.id, { x: selfP.x, y: selfP.y, z: selfP.z, ry: camYaw + Math.PI }); continue; }
    targets.set(ps.id, { x: ps.x, y: ps.y, z: ps.z, ry: ps.ry });
    if (!chars.has(ps.id)) {
      const c = makeCharacter(ps.hero, ps.name + (ps.bot ? ' 🤖' : ''), HEROES[ps.hero].color);
      scene.add(c.group);
      chars.set(ps.id, c);
      c.group.position.set(ps.x, ps.y, ps.z);
    }
  }
  // 角色动画状态
  for (const [pid, c] of chars) {
    const ps = m.players.find(p => p.id === pid);
    if (ps) c.userState = { alive: ps.alive, fly: ps.fly, armor: ps.armor };
  }
  // 炸弹视觉
  if (!m.bomb.planted && m.bomb.dropped) showBombMesh(m.bomb.dropped.x, m.bomb.dropped.z);
  if (m.bomb.planted) { $('bomb-banner').style.display = 'block'; $('bomb-timer').textContent = Math.ceil(m.bomb.timer); }
  syncGasFx(m.gases);
  updateHUD(m);
}

function onRoundStart(m) {
  AUDIO.stopBGM();
  $('bomb-banner').style.display = 'none';
  roundInfo = { round: m.round, wins: m.wins, attacking: m.attacking };
  // 清理上一回合视觉
  for (const [, c] of chars) { scene.remove(c.group); }
  chars.clear(); targets.clear();
  for (const [, s] of sentriesFx) scene.remove(s.group);
  sentriesFx.clear();
  clearGasFx();
  if (bombFx) { scene.remove(bombFx.group); bombFx = null; }
  bombState = { planted: false, x: 0, z: 0 };
  forceSelfPos = true;
  camYaw = (m.attacking === myTeam) ? 0 : Math.PI;
  camPitch = 0;
  dead = false;
  if (!spectateMode) $('spectate-label').style.display = 'none';
  const attName = m.attacking === 'monkey' ? '机械猴子' : '帝汶家族';
  banner(`第 ${m.round} 回合 · ${attName}进攻`, 2500);
  renderPips();
}

function onRoundEnd(m) {
  AUDIO.stopBGM();
  $('bomb-banner').style.display = 'none';
  if (m.reason === 'explode') { fxExplosion(bombState.x, bombState.z); AUDIO.explode(); }
  const wName = m.winner === 'monkey' ? '🐵 机械猴子' : '🦟 帝汶家族';
  const reasons = { wipe: '全歼敌军', explode: '搏击操播放完毕，能量引爆！', defuse: '进度条拖完了，拆包成功！', time: '时间耗尽，猴子未能播放搏击操' };
  banner(`${wName} 获胜 — ${reasons[m.reason] || ''}`, 3500);
  if (m.winner === myTeam) AUDIO.win(); else AUDIO.lose();
  renderPips();
}

function onMatchEnd(m) {
  AUDIO.stopBGM();
  inGame = false;
  document.exitPointerLock();
  const wName = m.winner === 'monkey' ? '🐵 机械猴子' : '🦟 帝汶家族';
  $('end-title').textContent = `🏆 ${wName} 赢得比赛！(${m.wins.monkey} : ${m.wins.timor})`;
  const tb = $('end-body');
  tb.innerHTML = '';
  m.board.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td>${esc(p.name)}${p.bot ? ' 🤖' : ''}</td>
      <td style="color:${HEROES[p.hero].color}">${HEROES[p.hero].name}</td><td>${p.kills}</td><td>${p.deaths}</td>`;
    tb.appendChild(tr);
  });
  show('screen-end');
}

function endGameToLobby() {
  inGame = false;
  document.exitPointerLock();
  AUDIO.stopBGM();
  show('screen-lobby');
  renderLobby();
}

function resetMatchVisuals() {
  for (const [, c] of chars) scene.remove(c.group);
  chars.clear(); targets.clear();
  for (const [, s] of sentriesFx) scene.remove(s.group);
  sentriesFx.clear();
  clearGasFx();
  if (bombFx) { scene.remove(bombFx.group); bombFx = null; }
}

function onDamaged(m) {
  selfP.hp = m.hp;
  $('hp-num').textContent = m.hp;
  $('hp-fill').style.width = Math.max(0, m.hp / HEROES[myHero].hp * 100) + '%';
  AUDIO.hurt();
  shake = Math.min(0.5, shake + 0.15);
}
function onHitmark(m) {
  const el = $('hitmark');
  el.style.opacity = 1;
  setTimeout(() => el.style.opacity = 0, 120);
  if (m.kill) AUDIO.kill(); else AUDIO.hit();
}
function onKill(m) {
  const kf = document.createElement('div');
  kf.className = 'kf';
  const kColor = m.killer ? (m.killer.team === 'monkey' ? '#ff8a8a' : '#8ab8ff') : '#9aa9c7';
  const vColor = m.victim.team === 'monkey' ? '#ff8a8a' : '#8ab8ff';
  kf.innerHTML = m.killer
    ? `<b style="color:${kColor}">${esc(m.killer.name)}</b> 🔫 <b style="color:${vColor}">${esc(m.victim.name)}</b>`
    : `<b style="color:${vColor}">${esc(m.victim.name)}</b> ☠️ 毒雾`;
  $('killfeed').appendChild(kf);
  while ($('killfeed').children.length > 5) $('killfeed').firstChild.remove();
  setTimeout(() => kf.remove(), 5000);
}
function onDied(m) { /* 服务器告知死亡（本地已由 snap 处理） */ }
function onDiedLocal() {
  dead = true;
  $('spectate-label').style.display = 'block';
  document.exitPointerLock();
}
function cycleSpectate() {
  if (!lastSnap) return;
  spectateIdx++;
}

// ---------- 特效 ----------
const tracers = [], particles = [], rings = [];
function fxTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.9 }));
  scene.add(line);
  tracers.push({ line, ttl: 0.12 });
  // 命中粒子
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }));
    p.position.set(...to);
    particles.push({ mesh: p, vel: new THREE.Vector3((Math.random() - .5) * 4, Math.random() * 4, (Math.random() - .5) * 4), ttl: 0.4 });
    scene.add(p);
  }
}
function fxExplosion(x, z) {
  const light = new THREE.PointLight(0xffaa33, 60, 40);
  light.position.set(x, 3, z);
  scene.add(light);
  setTimeout(() => scene.remove(light), 600);
  for (let i = 0; i < 40; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.08, 1, 0.5 + Math.random() * 0.3) }));
    p.position.set(x, 1, z);
    const a = Math.random() * Math.PI * 2;
    particles.push({ mesh: p, vel: new THREE.Vector3(Math.cos(a) * (3 + Math.random() * 8), 4 + Math.random() * 8, Math.sin(a) * (3 + Math.random() * 8)), ttl: 1.2 });
    scene.add(p);
  }
  shake = 1.2;
}
function onFx(m) {
  if (m.kind === 'nova') {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 32),
      new THREE.MeshBasicMaterial({ color: 0x7de8ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(m.x, 0.1, m.z);
    scene.add(ring);
    rings.push({ mesh: ring, ttl: 0.6, maxR: m.radius });
    AUDIO.skill();
  } else if (m.kind === 'dash') {
    fxTracer([m.x1, 1, m.z1], [m.x2, 1, m.z2], m.color);
  }
  // gas / fly / armor 由快照持续状态驱动
}
function syncGasFx(gases) {
  // 简化：按数量对齐
  while (gasFx.length < gases.length) {
    const grp = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1.1 + Math.random() * 0.7, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x66cc44, transparent: true, opacity: 0.28, depthWrite: false }));
      b.position.set((Math.random() - .5) * 3.5, 0.7 + Math.random(), (Math.random() - .5) * 3.5);
      grp.add(b);
    }
    scene.add(grp);
    gasFx.push({ group: grp, seed: Math.random() * 10 });
  }
  while (gasFx.length > gases.length) scene.remove(gasFx.pop().group);
  gases.forEach((gs, i) => gasFx[i].group.position.set(gs.x, 0, gs.z));
}
function clearGasFx() { for (const gf of gasFx) scene.remove(gf.group); gasFx = []; }
function addSentryFx(m) { const s = makeSentry(); s.group.position.set(m.x, 0, m.z); scene.add(s.group); sentriesFx.set(m.id, s); }
function removeSentryFx(id) { const s = sentriesFx.get(id); if (s) { scene.remove(s.group); sentriesFx.delete(id); } }
function showBombMesh(x, z) {
  if (!bombFx) { bombFx = makeBomb(); scene.add(bombFx.group); }
  bombFx.group.position.set(x, 0, z);
}
function bombPlanted(m) {
  showBombMesh(m.x, m.z);
  bombState = { planted: true, x: m.x, z: m.z };
}

// ---------- HUD ----------
function banner(text, ms) {
  const b = $('banner');
  b.textContent = text;
  b.style.opacity = 1;
  clearTimeout(banner._t);
  banner._t = setTimeout(() => b.style.opacity = 0, ms);
}
function renderPips() {
  for (const team of ['monkey', 'timor']) {
    const el = $(`pips-${team}`);
    el.innerHTML = '';
    for (let i = 0; i < winRounds; i++) {
      const p = document.createElement('div');
      p.className = 'pip';
      if (i < roundInfo.wins[team]) p.style.background = team === 'monkey' ? '#ff5a5a' : '#4da6ff';
      el.appendChild(p);
    }
  }
}
function renderScoreboard() {
  if (!lastSnap) return;
  $('sb-round').textContent = roundInfo.round;
  const tb = $('sb-body');
  tb.innerHTML = '';
  [...lastSnap.players].sort((a, b) => b.kills - a.kills).forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(p.name)}${p.bot ? ' 🤖' : ''}${p.id === myId ? ' 👉' : ''}</td>
      <td style="color:${HEROES[p.hero].color}">${HEROES[p.hero].name}</td>
      <td style="color:${p.team === 'monkey' ? '#ff8a8a' : '#8ab8ff'}">${FACTIONS[p.team].name}</td>
      <td>${p.kills}</td><td>${p.deaths}</td>`;
    tb.appendChild(tr);
  });
}
function updateHUD(m) {
  $('round-timer').textContent = m.phase === 'planted' ? Math.ceil(m.bomb.timer) : Math.ceil(m.phaseLeft);
  $('round-timer').style.color = m.phase === 'planted' ? '#ff8a5a' : '#fff';
  if (m.phase === 'planted') AUDIO.setTempo(m.bomb.timer < 6 ? 2 : m.bomb.timer < 15 ? 1.5 : 1);
  $('skill-cd').textContent = selfP.skillCd > 0 ? Math.ceil(selfP.skillCd) : 'Q';
  $('skill-cd').style.color = selfP.skillCd > 0 ? '#8fa3c8' : '#ffd54d';
  if (myHero) $('skill-name').textContent = HEROES[myHero].skill.name;
  // 交互提示
  const ib = $('interact-box');
  const attTeam = m.attacking;
  const meTeam = myTeam;
  let showBar = false;
  if (selfP.alive && m.phase === 'combat' && selfP.hasBomb && meTeam === attTeam) {
    const site = Object.values(MAP.sites).find(s => inSite(selfP.x, selfP.z, s));
    if (site) {
      showBar = true;
      $('interact-label').textContent = '按住 E 播放搏击操';
      $('interact-fill').style.width = (m.bomb.plantProg * 100) + '%';
    }
  }
  if (selfP.alive && m.bomb.planted && meTeam !== attTeam) {
    const d = Math.hypot(selfP.x - m.bomb.x, selfP.z - m.bomb.z);
    if (d < 2.2) {
      showBar = true;
      $('interact-label').textContent = '按住 E 拖动进度条拆包';
      $('interact-fill').style.width = (m.bomb.defuseProg * 100) + '%';
    }
  }
  ib.style.display = showBar ? 'block' : 'none';
}

// ---------- 主循环 ----------
const SPEED_BASE = () => HEROES[myHero] ? HEROES[myHero].speed : 5.4;

function gameLoop() {
  requestAnimationFrame(gameLoop);
  if (!inGame) return;
  const dt = Math.min(clock.getDelta(), 0.05);

  // ---- 本地移动 ----
  if (selfP.alive && !chatting && lastSnap) {
    let mx = 0, mz = 0;
    if (keys['KeyW']) mz -= 1;
    if (keys['KeyS']) mz += 1;
    if (keys['KeyA']) mx -= 1;
    if (keys['KeyD']) mx += 1;
    const moving = mx || mz;
    let sp = SPEED_BASE();
    if (selfP.slow) sp *= 0.4;
    if (selfP.armor) sp *= 0.7;
    if (selfP.fly) sp *= 1.15;
    if (moving) {
      const l = Math.hypot(mx, mz); mx /= l; mz /= l;
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
      const wx = mx * cos - mz * sin, wz = -mx * sin - mz * cos;
      // 相机 -Z 朝前：W 应朝相机前方
      const fx2 = -sin, fz2 = -cos;
      const rx = -fz2, rz = fx2;
      const dx = rx * mx + fx2 * (-mz), dz = rz * mx + fz2 * (-mz);
      const c = collideCircle(selfP.x + dx * sp * dt, selfP.z + dz * sp * dt, 0.45);
      selfP.x = c.x; selfP.z = c.z;
    }
    // 垂直
    if (selfP.fly) {
      if (keys['Space']) selfP.y = Math.min(7, selfP.y + 4 * dt);
      else if (keys['ShiftLeft']) selfP.y = Math.max(0, selfP.y - 4 * dt);
      selfP.vy = 0;
    } else {
      if (keys['Space'] && selfP.y <= 0.01) selfP.vy = 5.5;
      selfP.vy -= 14 * dt;
      selfP.y += selfP.vy * dt;
      if (selfP.y <= 0) { selfP.y = 0; selfP.vy = 0; }
    }
    selfP.ry = camYaw + Math.PI;
    selfP.moving = !!moving;
    // 发送输入
    sendWS({ t: 'input', x: selfP.x, y: selfP.y, z: selfP.z, ry: selfP.ry });
    // 射击
    if (keys.shoot && selfP.alive && myHero) {
      const w = HEROES[myHero].weapon;
      const now = performance.now() / 1000;
      if (now - lastShotAt >= w.interval) {
        lastShotAt = now;
        const d = camDir();
        sendWS({ t: 'shoot', ox: camera.position.x, oy: camera.position.y, oz: camera.position.z, dx: d.x, dy: d.y, dz: d.z });
        camPitch = Math.min(1.4, camPitch + 0.012); vmKick = 0.09; // 后坐力
      }
    }
  }

  // ---- 角色渲染 ----
  for (const [pid, c] of chars) {
    const t = targets.get(pid);
    if (!t) continue;
    const k = 1 - Math.pow(0.0001, dt);
    c.group.position.lerp(new THREE.Vector3(t.x, t.y, t.z), pid === myId ? 1 : k);
    let dr = t.ry - c.group.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    c.group.rotation.y += dr * (pid === myId ? 1 : k);
    const us = c.userState || {};
    c.group.visible = !(pid === myId && !dead); // 第一人称隐藏自己
    c.update(dt, { moving: pid === myId ? selfP.moving : true, flying: us.fly, armorOn: us.armor, dead: us.alive === false });
  }
  for (const [, s] of sentriesFx) s.update(dt);
  if (bombFx) bombFx.update(dt, lastSnap && lastSnap.bomb.timer < 10);
  for (const gf of gasFx) gf.group.rotation.y += dt * 0.3;

  // ---- 特效生命周期 ----
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].ttl -= dt;
    tracers[i].line.material.opacity = Math.max(0, tracers[i].ttl / 0.12);
    if (tracers[i].ttl <= 0) { scene.remove(tracers[i].line); tracers.splice(i, 1); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.ttl -= dt;
    p.vel.y -= 12 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.ttl <= 0) { scene.remove(p.mesh); particles.splice(i, 1); }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.ttl -= dt;
    const s = (1 - r.ttl / 0.6) * r.maxR;
    r.mesh.scale.set(s, s, 1);
    r.mesh.material.opacity = r.ttl / 0.6 * 0.8;
    if (r.ttl <= 0) { scene.remove(r.mesh); rings.splice(i, 1); }
  }

  // ---- 相机（第一人称） ----
  if ((dead || spectateMode) && lastSnap) {
    // 观战：第三人称跟随队友
    const mates = spectateMode ? lastSnap.players.filter(p => p.alive) : lastSnap.players.filter(p => p.team === myTeam && p.alive && p.id !== myId);
    const mate = mates.length ? mates[spectateIdx % mates.length] : null;
    if (mate) $('spectate-name').textContent = mate.name;
    const anchor = mate ? new THREE.Vector3(mate.x, mate.y + 1.5, mate.z) : new THREE.Vector3(selfP.x, selfP.y + 1.5, selfP.z);
    const back = new THREE.Vector3(Math.sin(camYaw), 0.6, Math.cos(camYaw)).multiplyScalar(3.2);
    camera.position.copy(anchor.clone().add(back));
    camera.lookAt(anchor.x, anchor.y, anchor.z);
  } else {
    camera.rotation.order = 'YXZ';
    camera.position.set(selfP.x, selfP.y + 1.55, selfP.z);
    camera.rotation.set(camPitch, camYaw, 0);
  }
  if (shake > 0) {
    camera.position.x += (Math.random() - .5) * shake * 0.25;
    camera.position.y += (Math.random() - .5) * shake * 0.25;
    shake = Math.max(0, shake - dt * 2.5);
  }
  // 第一人称持枪视图模型：后坐力+行走摆动
  if (viewmodel) {
    viewmodel.visible = !dead;
    vmKick = Math.max(0, vmKick - dt * 0.6);
    viewmodel.position.z = -0.5 + vmKick;
    viewmodel.position.y = -0.22 + (selfP.moving && selfP.alive && selfP.y < 0.05 ? Math.sin(performance.now() * 0.012) * 0.014 : 0);
  }

  renderer.render(scene, camera);
}









