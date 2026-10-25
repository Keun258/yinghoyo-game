import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { HEROES, heroPool } from './shared/heroes.js';
import { MAP, collideCircle, rayVsWalls, hasLOS, findPath, inSite } from './shared/map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const FAST = process.env.FAST === '1'; // 测试模式：缩短所有计时

// ---------- 数值配置 ----------
const CFG = FAST
  ? { prep: 2, combat: 15, bomb: 8, plant: 1.5, defuse: 2, roundEnd: 2, matchEnd: 4, winRounds: 2, swapAfter: 1, teamSize: 2 }
  : { prep: 8, combat: 100, bomb: 45, plant: 4, defuse: 5, roundEnd: 5, matchEnd: 10, winRounds: 5, swapAfter: 4, teamSize: 3 };
const TICK = 1 / 20;
const GAS = { radius: 3, dps: 8, duration: 8 };
const SENTRY = { hp: 60, range: 12, dmg: 6, interval: 0.8, radius: 0.5 };
const NOVA = { radius: 6, slow: 0.6, duration: 3 };
const DASH = { dist: 8, time: 0.25, dmg: 25, knock: 6 };
const FLY = { duration: 6, lifesteal: 0.3 };
const ARMOR = { duration: 6, reduction: 0.5, slow: 0.3 };
const GRAVITY = 14, JUMP_V = 5.5;

// ---------- 静态文件 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/public/index.html';
  else if (!p.startsWith('/shared/')) p = '/public' + p;
  const fp = path.join(__dirname, path.normalize(p));
  if (!fp.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- 房间 ----------
const rooms = new Map();
let nextPid = 1;

function mkRoom(code) {
  const room = {
    code, host: null, players: new Map(), phase: 'lobby',
    game: null, tickTimer: null,
  };
  rooms.set(code, room);
  return room;
}

function send(p, obj) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); }
function broadcast(room, obj) { const s = JSON.stringify(obj); for (const p of room.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(s); }

function lobbyState(room) {
  return {
    t: 'lobby', code: room.code, host: room.host,
    players: [...room.players.values()].filter(p => !p.bot).map(p => ({ id: p.id, name: p.name, team: p.team, hero: p.hero, spectator: !!p.spectator })),
  };
}

const BOT_NAMES = { monkey: ['猴一', '猴三', '猴四', '猴五', '猴七', '猴八'], timor: ['西帝汶', '小帝汶', '中帝汶', '南帝汶', '稳帝汶'] };

function mkBot(room, team, hero) {
  const id = nextPid++;
  const pool = BOT_NAMES[team];
  const used = new Set([...room.players.values()].map(p => p.name));
  const name = pool.find(n => !used.has(n)) || (team === 'monkey' ? '猴十八' : '大帝汶亲卫');
  const p = {
    id, bot: true, ws: null, name, team, hero,
    x: 0, y: 0, z: 0, vy: 0, ry: 0, hp: HEROES[hero].hp, alive: false,
    slowUntil: 0, slowPct: 0, hasteUntil: 0, armorUntil: 0, flyUntil: 0,
    lastShot: 0, skillReadyAt: 0, plantHold: 0, defuseHold: 0, hasBomb: false,
    kills: 0, deaths: 0,
    ai: { path: [], goal: null, mode: 'idle', target: null, aimErr: 1.6, strafe: 1, strafeAt: 0, fleeUntil: 0, guard: null },
  };
  room.players.set(id, p);
  return p;
}

// ---------- 战斗 ----------
function rayVsPlayer(ox, oy, oz, dx, dy, dz, p, maxDist) {
  // 圆柱 r=0.45，高度 0..1.7（飞行时位置 y 已含高度）
  const r = 0.55, h = 1.7;
  const cx = p.x - ox, cz = p.z - oz;
  const a = dx * dx + dz * dz;
  if (a > 1e-8) {
    const b = -(cx * dx + cz * dz);
    const c = cx * cx + cz * cz - r * r;
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0 || t > maxDist) return null;
    const y = oy + dy * t;
    if (y >= p.y && y <= p.y + h) return t;
  }
  return null;
}

function applyDamage(room, target, dmg, src, knock) {
  if (!target.alive || room.game.phase === 'end') return;
  const g = room.game;
  const now = g.now;
  if (target.armorUntil > now) dmg *= (1 - ARMOR.reduction);
  if (src && src.hero === 'wangchengxue' && target.slowUntil > now) dmg *= 1.2;
  target.hp -= dmg;
  if (src && src.hero === 'dongdiwen' && src.flyUntil > now) {
    src.hp = Math.min(HEROES[src.hero].hp, src.hp + dmg * FLY.lifesteal);
  }
  if (knock && src) {
    const kf = target.hero === 'dadiwen' ? knock * 0.5 : knock;
    const d = Math.hypot(target.x - src.x, target.z - src.z) || 1;
    const c = collideCircle(target.x + (target.x - src.x) / d * kf * 0.3, target.z + (target.z - src.z) / d * kf * 0.3, 0.45);
    target.x = c.x; target.z = c.z;
  }
  // 受击打断下包/拆包
  target.plantHold = 0; target.defuseHold = 0;
  send(target, { t: 'damaged', hp: Math.max(0, Math.round(target.hp)), from: src ? src.name : null });
  if (src) send(src, { t: 'hitmark', kill: target.hp <= 0 });
  if (target.hp <= 0) killPlayer(room, target, src);
}

function killPlayer(room, victim, killer) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;
  victim.plantHold = 0; victim.defuseHold = 0;
  const g = room.game;
  if (victim.hasBomb) { victim.hasBomb = false; g.bomb.carrier = null; g.bomb.dropped = { x: victim.x, z: victim.z }; }
  if (killer && killer.team !== victim.team) {
    killer.kills++;
    if (killer.hero === 'yinghao') killer.hasteUntil = g.now + 3;
  }
  broadcast(room, { t: 'kill', killer: killer ? { name: killer.name, team: killer.team, hero: killer.hero } : null, victim: { name: victim.name, team: victim.team, hero: victim.hero } });
  send(victim, { t: 'died', by: killer ? killer.name : '毒雾' });
  // 帝汶哨戒主人死亡不销毁哨戒
  checkRoundWin(room);
}

function handleShoot(room, p, msg) {
  const g = room.game;
  if (!p.hero || !p.alive || !g || (g.phase !== 'combat' && g.phase !== 'planted')) return;
  const now = g.now;
  const w = HEROES[p.hero].weapon;
  if (now - p.lastShot < w.interval * 0.9) return;
  p.lastShot = now;
  p.plantHold = 0; p.defuseHold = 0; // 开枪打断交互

  // ---- 第1步：准星射线（相机原点+方向）找出瞄准点 ----
  let cox = +msg.ox, coy = +msg.oy, coz = +msg.oz;
  if (!isFinite(cox) || !isFinite(coy) || !isFinite(coz) || Math.hypot(cox - p.x, coz - p.z) > 5) {
    cox = p.x; coy = p.y + 1.5; coz = p.z; // 不可信相机原点时退回玩家视角
  }
  const cl = Math.hypot(msg.dx, msg.dy, msg.dz) || 1;
  const cdx = msg.dx / cl, cdy = msg.dy / cl, cdz = msg.dz / cl;
  const camRange = w.range + 6;
  let aimD = camRange, aimTarget = null, aimSentry = null;
  const camWall = rayVsWalls(cox, coy, coz, cdx, cdy, cdz, camRange);
  if (camWall !== null) aimD = camWall;
  for (const q of room.players.values()) {
    if (q === p || !q.alive || q.team === p.team) continue;
    const t = rayVsPlayer(cox, coy, coz, cdx, cdy, cdz, q, aimD);
    if (t !== null && t < aimD) { aimD = t; aimTarget = q; aimSentry = null; }
  }
  for (const s of g.sentries) {
    if (s.team === p.team) continue;
    const t = rayVsSphere(cox, coy, coz, cdx, cdy, cdz, s.x, s.y + 0.5, s.z, SENTRY.radius, aimD);
    if (t !== null && t < aimD) { aimD = t; aimSentry = s; aimTarget = null; }
  }
  // 瞄准点不能落在玩家身后（相机贴墙时）
  const camToP = Math.hypot(cox - p.x, coz - p.z);
  if (aimD < camToP + 0.6) aimD = camToP + 0.6;
  const ax = cox + cdx * aimD, ay = coy + cdy * aimD, az = coz + cdz * aimD;

  // ---- 第2步：枪口射线（玩家眼位 → 瞄准点），墙面可挡 ----
  const ex = p.x, ey = p.y + 1.5, ez = p.z;
  let mdx = ax - ex, mdy = ay - ey, mdz = az - ez;
  const ml = Math.hypot(mdx, mdy, mdz) || 1;
  mdx /= ml; mdy /= ml; mdz /= ml;
  const maxDist = Math.min(ml + 0.6, camRange);

  for (let pel = 0; pel < (w.pellets || 1); pel++) {
    let dx = mdx + (Math.random() - 0.5) * w.spread * 2;
    let dy = mdy + (Math.random() - 0.5) * w.spread * 2;
    let dz = mdz + (Math.random() - 0.5) * w.spread * 2;
    const l2 = Math.hypot(dx, dy, dz); dx /= l2; dy /= l2; dz /= l2;
    let dist = maxDist;
    const wallD = rayVsWalls(ex, ey, ez, dx, dy, dz, dist);
    if (wallD !== null) dist = wallD;
    let hitP = null, hitD = dist;
    for (const q of room.players.values()) {
      if (q === p || !q.alive || q.team === p.team) continue;
      const t = rayVsPlayer(ex, ey, ez, dx, dy, dz, q, dist);
      if (t !== null && t < hitD) { hitD = t; hitP = q; }
    }
    let hitS = null;
    for (const s of g.sentries) {
      if (s.team === p.team) continue;
      const t = rayVsSphere(ex, ey, ez, dx, dy, dz, s.x, s.y + 0.5, s.z, SENTRY.radius, hitD);
      if (t !== null && t < hitD) { hitD = t; hitS = s; hitP = null; }
    }
    if (hitP) {
      let dmg = w.dmg;
      if (w.falloffStart && hitD > w.falloffStart) {
        dmg *= Math.max(w.falloffMin, 1 - (hitD - w.falloffStart) / (w.range - w.falloffStart) * (1 - w.falloffMin));
      }
      applyDamage(room, hitP, dmg, p);
    } else if (hitS) {
      hitS.hp -= w.dmg;
      broadcast(room, { t: 'sentry_hit', id: hitS.id, hp: hitS.hp });
      if (hitS.hp <= 0) {
        g.sentries = g.sentries.filter(s => s !== hitS);
        broadcast(room, { t: 'sentry_die', id: hitS.id });
      }
    }
    if (pel === 0 || hitP || hitS) {
      broadcast(room, { t: 'shot', from: [ex, ey - 0.15, ez], to: [ex + dx * hitD, ey + dy * hitD, ez + dz * hitD], color: HEROES[p.hero].color, pid: p.id });
    }
  }
}

function rayVsSphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxDist) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return null;
  const t = tca - Math.sqrt(r * r - d2);
  return (t >= 0 && t <= maxDist) ? t : null;
}

// ---------- 技能 ----------
function handleSkill(room, p, msg) {
  const g = room.game;
  if (!p.hero || !p.alive || !g || (g.phase !== 'combat' && g.phase !== 'planted')) return;
  const now = g.now;
  if (now < p.skillReadyAt) return;
  const dir = msg && typeof msg.dx === 'number' ? msg : null;
  switch (p.hero) {
    case 'yinghao': {
      p.skillReadyAt = now + HEROES.yinghao.skill.cd;
      const ry = dir ? Math.atan2(dir.dx, dir.dz) : p.ry;
      const nx = p.x + Math.sin(ry) * DASH.dist, nz = p.z + Math.cos(ry) * DASH.dist;
      // 冲刺路径上的敌人
      for (const q of room.players.values()) {
        if (q.team === p.team || !q.alive) continue;
        const d = distToSeg(q.x, q.z, p.x, p.z, nx, nz);
        if (d < 1.5) applyDamage(room, q, DASH.dmg, p, DASH.knock);
      }
      const c = collideCircle(nx, nz, 0.45);
      p.x = c.x; p.z = c.z;
      p.dashFx = { x1: msg.ox ?? p.x, z1: msg.oz ?? p.z };
      broadcast(room, { t: 'fx', kind: 'dash', x1: p.x, z1: p.z, x2: c.x, z2: c.z, color: HEROES[p.hero].color });
      break;
    }
    case 'houliu': {
      p.skillReadyAt = now + HEROES.houliu.skill.cd;
      // 毒气弹落点：朝准星方向，遇墙即止，最远15米
      let gx = p.x, gz = p.z;
      if (dir) {
        const l = Math.hypot(dir.dx, dir.dz) || 1;
        const wallD = rayVsWalls(p.x, 1.2, p.z, dir.dx / l, 0, dir.dz / l, 15);
        const d = (wallD !== null ? wallD : 15) - 0.5;
        gx = p.x + (dir.dx / l) * d; gz = p.z + (dir.dz / l) * d;
      }
      const c = collideCircle(gx, gz, GAS.radius * 0.5);
      g.gases.push({ x: c.x, z: c.z, until: now + GAS.duration, owner: p.id });
      broadcast(room, { t: 'fx', kind: 'gas', x: c.x, z: c.z, duration: GAS.duration });
      break;
    }
    case 'dongdiwen': {
      p.skillReadyAt = now + HEROES.dongdiwen.skill.cd;
      p.flyUntil = now + FLY.duration;
      broadcast(room, { t: 'fx', kind: 'fly', pid: p.id, duration: FLY.duration });
      break;
    }
    case 'dadiwen': {
      p.skillReadyAt = now + HEROES.dadiwen.skill.cd;
      const sx = p.x + Math.sin(p.ry) * 1.2, sz = p.z + Math.cos(p.ry) * 1.2;
      const c = collideCircle(sx, sz, 0.6);
      const s = { id: 's' + (g.sentrySeq++), x: c.x, y: 0, z: c.z, hp: SENTRY.hp, team: p.team, lastShot: 0, owner: p.id };
      g.sentries.push(s);
      broadcast(room, { t: 'sentry_add', id: s.id, x: s.x, z: s.z, team: s.team });
      break;
    }
    case 'wangchengxue': {
      p.skillReadyAt = now + HEROES.wangchengxue.skill.cd;
      for (const q of room.players.values()) {
        if (q.team === p.team || !q.alive) continue;
        if (Math.hypot(q.x - p.x, q.z - p.z) <= NOVA.radius) {
          q.slowUntil = now + NOVA.duration; q.slowPct = NOVA.slow;
        }
      }
      broadcast(room, { t: 'fx', kind: 'nova', x: p.x, z: p.z, radius: NOVA.radius });
      break;
    }
    case 'zhangjiaxuan': {
      p.skillReadyAt = now + HEROES.zhangjiaxuan.skill.cd;
      p.armorUntil = now + ARMOR.duration;
      broadcast(room, { t: 'fx', kind: 'armor', pid: p.id, duration: ARMOR.duration });
      break;
    }
  }
}

function distToSeg(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const l2 = dx * dx + dz * dz || 1e-8;
  let t = ((px - x1) * dx + (pz - z1) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

// ---------- 回合状态机 ----------
function attackingTeam(room) {
  const swapped = room.game.roundNum > CFG.swapAfter;
  return swapped ? 'timor' : 'monkey';
}

function startMatch(room) {
  room.phase = 'game';
  room.game = {
    now: 0, roundNum: 1, wins: { monkey: 0, timor: 0 },
    phase: 'prep', phaseEnd: CFG.prep,
    bomb: { carrier: null, planted: false, x: 0, z: 0, timer: 0, plantProg: 0, defuseProg: 0, dropped: null },
    sentries: [], gases: [], sentrySeq: 1,
    log: [],
  };
  startRound(room);
  broadcast(room, { t: 'match_start', winRounds: CFG.winRounds, swapAfter: CFG.swapAfter });
  broadcastGame(room, true);
}

function startRound(room) {
  const g = room.game;
  g.phase = 'prep';
  g.phaseEnd = g.now + CFG.prep;
  g.bomb = { carrier: null, planted: false, x: 0, z: 0, timer: 0, plantProg: 0, defuseProg: 0, dropped: null };
  g.sentries = []; g.gases = [];
  const att = attackingTeam(room);
  let ai = 0, di = 0;
  for (const p of room.players.values()) {
    if (p.spectator) continue;
    const isAtt = p.team === att;
    const sp = isAtt ? MAP.spawns.att[ai++ % 3] : MAP.spawns.def[di++ % 3];
    p.x = sp.x; p.z = sp.z; p.y = 0; p.vy = 0; p.ry = isAtt ? Math.PI : 0;
    p.hp = HEROES[p.hero].hp; p.alive = true;
    p.slowUntil = 0; p.hasteUntil = 0; p.armorUntil = 0; p.flyUntil = 0;
    p.plantHold = 0; p.defuseHold = 0; p.hasBomb = false; p.skillReadyAt = 0; p.lastShot = 0;
    if (p.bot) p.ai = { path: [], goal: null, mode: 'idle', target: null, aimErr: 1.6, strafe: 1, strafeAt: 0, fleeUntil: 0, guard: null };
  }
  const attackers = [...room.players.values()].filter(p => p.team === att && !p.bot);
  const carrier = attackers[0] || [...room.players.values()].find(p => p.team === att);
  if (carrier) { carrier.hasBomb = true; g.bomb.carrier = carrier.id; }
  broadcast(room, {
    t: 'round_start', round: g.roundNum, wins: g.wins, attacking: att,
    phase: 'prep', phaseLen: CFG.prep, carrier: g.bomb.carrier,
  });
}

function checkRoundWin(room) {
  const g = room.game;
  if (!g || g.phase === 'end') return;
  const att = attackingTeam(room);
  const def = att === 'monkey' ? 'timor' : 'monkey';
  const attAlive = [...room.players.values()].some(p => p.team === att && p.alive);
  const defAlive = [...room.players.values()].some(p => p.team === def && p.alive);
  if (!defAlive) return endRound(room, att, 'wipe');
  if (!attAlive && !g.bomb.planted) return endRound(room, def, 'wipe');
}

function endRound(room, winner, reason) {
  const g = room.game;
  if (g.phase === 'end') return;
  g.phase = 'end';
  g.phaseEnd = g.now + CFG.roundEnd;
  g.wins[winner]++;
  for (const p of room.players.values()) { p.plantHold = 0; p.defuseHold = 0; }
  broadcast(room, { t: 'round_end', winner, reason, wins: g.wins, round: g.roundNum });
}

function endMatch(room) {
  const g = room.game;
  const winner = g.wins.monkey > g.wins.timor ? 'monkey' : 'timor';
  const board = [...room.players.values()]
    .map(p => ({ name: p.name, team: p.team, hero: p.hero, kills: p.kills, deaths: p.deaths, bot: p.bot }))
    .sort((a, b) => b.kills - a.kills);
  broadcast(room, { t: 'match_end', winner, wins: g.wins, board });
  g.phase = 'match_end';
  g.phaseEnd = g.now + CFG.matchEnd;
}

function backToLobby(room) {
  room.phase = 'lobby';
  room.game = null;
  for (const p of room.players.values()) { p.kills = 0; p.deaths = 0; p.spectator = false; }
  broadcast(room, lobbyState(room));
}

// ---------- 主循环 ----------
function gameTick(room) {
  const g = room.game;
  if (!g) return;
  g.now += TICK;
  const now = g.now;

  if (g.phase === 'prep' && now >= g.phaseEnd) {
    g.phase = 'combat';
    g.phaseEnd = now + CFG.combat;
    broadcast(room, { t: 'phase', phase: 'combat', phaseLen: CFG.combat });
  } else if (g.phase === 'combat') {
    if (now >= g.phaseEnd) {
      const def = attackingTeam(room) === 'monkey' ? 'timor' : 'monkey';
      endRound(room, def, 'time');
    }
  } else if (g.phase === 'planted') {
    g.bomb.timer -= TICK;
    if (g.bomb.timer <= 0) return endRound(room, attackingTeam(room), 'explode');
  } else if (g.phase === 'end' && now >= g.phaseEnd) {
    if (g.wins.monkey >= CFG.winRounds || g.wins.timor >= CFG.winRounds) return endMatch(room);
    g.roundNum++;
    return startRound(room);
  } else if (g.phase === 'match_end' && now >= g.phaseEnd) {
    return backToLobby(room);
  }

  // 毒雾伤害
  for (const gas of g.gases) {
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - gas.x, p.z - gas.z) <= GAS.radius && p.y < 2) {
        p.gasAcc = (p.gasAcc || 0) + GAS.dps * TICK;
        if (p.gasAcc >= 1) { const d = Math.floor(p.gasAcc); p.gasAcc -= d; applyDamage(room, p, d, room.players.get(gas.owner)); }
      }
    }
  }
  g.gases = g.gases.filter(gas => gas.until > now);

  // 哨戒
  for (const s of g.sentries) {
    if (now - s.lastShot < SENTRY.interval) continue;
    let best = null, bd = SENTRY.range;
    for (const p of room.players.values()) {
      if (!p.alive || p.team === s.team) continue;
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < bd && hasLOS(s.x, s.z, p.x, p.z)) { bd = d; best = p; }
    }
    if (best) {
      s.lastShot = now;
      broadcast(room, { t: 'shot', from: [s.x, 1.1, s.z], to: [best.x, best.y + 1.2, best.z], color: '#4da6ff', sentry: true });
      applyDamage(room, best, SENTRY.dmg, room.players.get(s.owner));
    }
  }

  // 交互进度（下包/拆包）
  for (const p of room.players.values()) {
    if (!p.alive) { p.plantHold = 0; p.defuseHold = 0; continue; }
    if (p.plantHold > 0 && g.phase === 'combat' && !g.bomb.planted && p.hasBomb) {
      const site = Object.values(MAP.sites).find(s => inSite(p.x, p.z, s));
      if (site) {
        g.bomb.plantProg += TICK;
        if (g.bomb.plantProg >= CFG.plant) {
          g.bomb.planted = true; g.bomb.x = p.x; g.bomb.z = p.z;
          g.bomb.timer = CFG.bomb; p.hasBomb = false; g.bomb.carrier = null;
          g.phase = 'planted';
          broadcast(room, { t: 'planted', x: p.x, z: p.z, timer: CFG.bomb });
        }
      } else p.plantHold = 0;
    }
    if (p.defuseHold > 0 && g.bomb.planted) {
      if (Math.hypot(p.x - g.bomb.x, p.z - g.bomb.z) <= 2.2) {
        g.bomb.defuseProg += TICK;
        if (g.bomb.defuseProg >= CFG.defuse) {
          const def = attackingTeam(room) === 'monkey' ? 'timor' : 'monkey';
          return endRound(room, def, 'defuse');
        }
      } else p.defuseHold = 0;
    }
  }

  // 捡包
  if (g.bomb.dropped && !g.bomb.planted) {
    const att = attackingTeam(room);
    for (const p of room.players.values()) {
      if (p.alive && p.team === att && Math.hypot(p.x - g.bomb.dropped.x, p.z - g.bomb.dropped.z) < 1.2) {
        p.hasBomb = true; g.bomb.carrier = p.id; g.bomb.dropped = null;
        broadcast(room, { t: 'bomb_pick', pid: p.id });
        break;
      }
    }
  }

  // AI
  for (const p of room.players.values()) if (p.bot && p.alive) botTick(room, p);

  broadcastGame(room);
}

function speedOf(p, now) {
  let s = HEROES[p.hero].speed;
  if (p.slowUntil > now) s *= 1 - p.slowPct;
  if (p.hasteUntil > now) s *= 1.3;
  if (p.armorUntil > now) s *= 1 - ARMOR.slow;
  if (p.flyUntil > now) s *= 1.15;
  return s;
}

// ---------- AI ----------
function botTick(room, p) {
  const g = room.game;
  const now = g.now;
  const ai = p.ai;
  if (g.phase === 'prep' || g.phase === 'end' || g.phase === 'match_end') return;
  const att = attackingTeam(room);
  const isAtt = p.team === att;

  // 感知最近可见敌人
  let enemy = null, ed = 26;
  for (const q of room.players.values()) {
    if (!q.alive || q.team === p.team) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < ed && hasLOS(p.x, p.z, q.x, q.z)) { ed = d; enemy = q; }
  }

  // 决策目标
  let goal = null;
  if (p.hp < 30 && enemy) { ai.fleeUntil = now + 2.5; }
  if (now < ai.fleeUntil && enemy) {
    goal = { x: p.x + (p.x - enemy.x), z: p.z + (p.z - enemy.z) };
  } else if (isAtt) {
    if (g.bomb.planted) {
      goal = { x: g.bomb.x, z: g.bomb.z }; // 守包
      if (Math.hypot(p.x - g.bomb.x, p.z - g.bomb.z) < 6 && !enemy) goal = null;
    } else if (p.hasBomb) {
      const site = ai.preferSite === 'A' ? MAP.sites.A : MAP.sites.B;
      goal = { x: site.x, z: site.z };
      if (inSite(p.x, p.z, site) && !enemy) {
        p.plantHold = CFG.plant; // 持续下包（进度由 tick 累加）
        return faceAndMaybeShoot(room, p, null, now);
      }
    } else if (g.bomb.dropped) {
      goal = { x: g.bomb.dropped.x, z: g.bomb.dropped.z };
    } else if (enemy) {
      goal = { x: enemy.x, z: enemy.z };
    } else {
      const carrier = room.players.get(g.bomb.carrier);
      goal = carrier && carrier !== p ? { x: carrier.x + 2, z: carrier.z + 2 } : { x: MAP.sites[ai.preferSite || 'A'].x, z: MAP.sites[ai.preferSite || 'A'].z };
    }
  } else {
    if (g.bomb.planted) {
      if (!FAST && Math.hypot(p.x - g.bomb.x, p.z - g.bomb.z) <= 1.8 && !enemy) {
        p.defuseHold = CFG.defuse;
        return faceAndMaybeShoot(room, p, null, now);
      }
      goal = { x: g.bomb.x, z: g.bomb.z };
    } else if (enemy) {
      goal = ed > 12 ? { x: enemy.x, z: enemy.z } : null;
    } else {
      if (!ai.guard) {
        ai.guard = Math.random() < 0.5 ? MAP.sites.A : MAP.sites.B;
        ai.preferSite = ai.guard === MAP.sites.A ? 'A' : 'B';
      }
      const gx = ai.guard.x + (Math.random() - 0.5) * 6, gz = ai.guard.z + (Math.random() - 0.5) * 6;
      if (!ai.guardPos || Math.hypot(p.x - ai.guardPos.x, p.z - ai.guardPos.z) < 1.5) ai.guardPos = { x: gx, z: gz };
      goal = ai.guardPos;
    }
  }
  if (!ai.preferSite) ai.preferSite = Math.random() < 0.5 ? 'A' : 'B';

  // 技能
  if (now >= p.skillReadyAt) botUseSkill(room, p, enemy, ed, isAtt);

  // 移动
  if (goal) {
    if (!ai.goal || Math.hypot(ai.goal.x - goal.x, ai.goal.z - goal.z) > 2 || !ai.path.length) {
      ai.goal = goal;
      ai.path = findPath(p.x, p.z, goal.x, goal.z);
    }
    let wp = ai.path[0];
    if (wp && Math.hypot(p.x - wp.x, p.z - wp.z) < 1.2) { ai.path.shift(); wp = ai.path[0]; }
    const tx = wp ? wp.x : goal.x, tz = wp ? wp.z : goal.z;
    let mx = tx - p.x, mz = tz - p.z;
    const ml = Math.hypot(mx, mz);
    if (ml > 0.3) {
      mx /= ml; mz /= ml;
      // 战斗走位
      if (enemy && ed < 14) {
        if (now > ai.strafeAt) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeAt = now + 0.8 + Math.random(); }
        mx += -mz * 0.7 * ai.strafe; mz += mx * 0.7 * ai.strafe;
        const l2 = Math.hypot(mx, mz); mx /= l2; mz /= l2;
      }
      // 避开毒雾（猴六偶尔犯蠢）
      const inGas = g.gases.find(gas => Math.hypot(p.x + mx * 1.5 - gas.x, p.z + mz * 1.5 - gas.z) < GAS.radius);
      if (inGas && !(p.hero === 'houliu' && Math.random() < 0.3)) { mx = -mx; mz = -mz; }
      const sp = speedOf(p, now) * TICK;
      const c = collideCircle(p.x + mx * sp, p.z + mz * sp, 0.45);
      p.x = c.x; p.z = c.z;
      if (!enemy) p.ry = Math.atan2(mx, mz);
    }
  } else ai.path = [];

  faceAndMaybeShoot(room, p, enemy, now, ed);
}

function faceAndMaybeShoot(room, p, enemy, now, ed) {
  if (!enemy) { p.ai.seenAt = 0; p.ai.aimErr = 1.6; return; }
  if (FAST) return;
  p.ry = Math.atan2(enemy.x - p.x, enemy.z - p.z);
  if (!p.ai.seenAt) p.ai.seenAt = now;
  if (now - p.ai.seenAt < 0.45) return; // 人机反应时间
  p.ai.aimErr = Math.max(0.3, p.ai.aimErr - TICK * 0.45); // 越瞄越准
  if (now - p.lastShot >= HEROES[p.hero].weapon.interval && ed < HEROES[p.hero].weapon.range) {
    const err = p.ai.aimErr * 0.12;
    const dx = enemy.x - p.x + (Math.random() - 0.5) * err * ed;
    const dy = (enemy.y + 1.2) - (p.y + 1.5);
    const dz = enemy.z - p.z + (Math.random() - 0.5) * err * ed;
    handleShoot(room, p, { dx, dy, dz });
  }
}

function botUseSkill(room, p, enemy, ed, isAtt) {
  const now = room.game.now;
  switch (p.hero) {
    case 'yinghao':
      if (enemy && ed > 5 && ed < 11) handleSkill(room, p, { dx: enemy.x - p.x, dz: enemy.z - p.z });
      break;
    case 'houliu':
      if (enemy && ed < 18) handleSkill(room, p, { dx: enemy.x - p.x, dz: enemy.z - p.z });
      else if (!isAtt) {
        const site = p.ai.guard || MAP.sites.A;
        if (Math.hypot(p.x - site.x, p.z - site.z) < 10) handleSkill(room, p, { dx: site.x - p.x, dz: site.z - p.z });
      }
      break;
    case 'dongdiwen':
      if (enemy && (p.hp < 50 || ed < 8)) handleSkill(room, p, null);
      break;
    case 'dadiwen':
      if (!isAtt && p.ai.guard && Math.hypot(p.x - p.ai.guard.x, p.z - p.ai.guard.z) < 8) handleSkill(room, p, null);
      break;
    case 'wangchengxue':
      if (enemy && ed < NOVA.radius - 0.5) handleSkill(room, p, null);
      break;
    case 'zhangjiaxuan':
      if (enemy && ed < 15) handleSkill(room, p, null);
      break;
  }
}

// ---------- 快照 ----------
function broadcastGame(room, force) {
  const g = room.game;
  if (!g) return;
  const snap = {
    t: 'snap',
    phase: g.phase,
    phaseLeft: Math.max(0, Math.round((g.phaseEnd - g.now) * 10) / 10),
    round: g.roundNum, wins: g.wins, attacking: attackingTeam(room),
    bomb: {
      planted: g.bomb.planted, x: g.bomb.x, z: g.bomb.z,
      timer: Math.max(0, Math.round(g.bomb.timer * 10) / 10),
      carrier: g.bomb.carrier, dropped: g.bomb.dropped,
      plantProg: Math.min(1, g.bomb.plantProg / CFG.plant),
      defuseProg: Math.min(1, g.bomb.defuseProg / CFG.defuse),
    },
    players: [...room.players.values()].filter(p => !p.spectator).map(p => ({
      id: p.id, name: p.name, team: p.team, hero: p.hero, bot: !!p.bot,
      x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100,
      ry: Math.round(p.ry * 100) / 100,
      hp: Math.max(0, Math.round(p.hp)), alive: p.alive,
      slow: p.slowUntil > g.now, armor: p.armorUntil > g.now, fly: p.flyUntil > g.now,
      hasBomb: p.hasBomb, kills: p.kills, deaths: p.deaths,
      skillCd: Math.max(0, Math.round((p.skillReadyAt - g.now) * 10) / 10),
    })),
    sentries: g.sentries.map(s => ({ id: s.id, x: s.x, z: s.z, hp: s.hp, team: s.team })),
    gases: g.gases.map(gas => ({ x: gas.x, z: gas.z, left: Math.round((gas.until - g.now) * 10) / 10 })),
  };
  broadcast(room, snap);
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const id = nextPid++;
  let room = null, me = null;

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const name = String(msg.name || '').slice(0, 12);

    if (msg.t === 'create' || msg.t === 'join') {
      if (room) return;
      let code;
      if (msg.t === 'create') {
        do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
        room = mkRoom(code);
      } else {
        code = String(msg.code || '');
        room = rooms.get(code);
        if (!room) return sendWs({ t: 'err', msg: '房间不存在' }, ws);
      }
      me = {
        id, ws, bot: false, name: name || '玩家' + id, team: null, hero: null,
        x: 0, y: 0, z: 0, vy: 0, ry: 0, hp: 100, alive: false,
        slowUntil: 0, slowPct: 0, hasteUntil: 0, armorUntil: 0, flyUntil: 0,
        lastShot: 0, skillReadyAt: 0, plantHold: 0, defuseHold: 0, hasBomb: false,
        kills: 0, deaths: 0,
      };
      if (room.phase === 'game') {
        me.spectator = true;
        room.players.set(id, me);
        sendWs({ t: 'spectate_join', code: room.code, id, winRounds: CFG.winRounds }, ws);
        broadcast(room, { t: 'chat', sys: true, text: me.name + ' 进入观战' });
        return;
      }
      room.players.set(id, me);
      if (!room.host) room.host = id;
      sendWs({ t: 'joined', code: room.code, id, host: room.host, fast: FAST, cfg: { winRounds: CFG.winRounds } }, ws);
      broadcast(room, lobbyState(room));
      return;
    }
    if (!room || !me) return;

    switch (msg.t) {
      case 'side': {
        if (room.phase !== 'lobby') return;
        const team = msg.side === 'timor' ? 'timor' : 'monkey';
        me.team = team;
        if (me.hero && HEROES[me.hero].faction !== 'neutral' && HEROES[me.hero].faction !== team) me.hero = null;
        broadcast(room, lobbyState(room));
        break;
      }
      case 'hero': {
        if (room.phase !== 'lobby' || !me.team) return;
        if (heroPool(me.team).some(h => h.id === msg.hero)) me.hero = msg.hero;
        broadcast(room, lobbyState(room));
        break;
      }
      case 'start': {
        if (room.phase !== 'lobby' || room.host !== id) return;
        // 未选边玩家自动分边
        const counts = { monkey: 0, timor: 0 };
        for (const p of room.players.values()) if (p.team && !p.spectator) counts[p.team]++;
        for (const p of room.players.values()) if (!p.team && !p.spectator) p.team = counts.monkey <= counts.timor ? (counts.monkey++, 'monkey') : (counts.timor++, 'timor');
        for (const p of room.players.values()) {
          if (!p.hero && !p.spectator) {
            const pool = heroPool(p.team).filter(h => ![...room.players.values()].some(q => q.hero === h.id));
            p.hero = (pool[0] || heroPool(p.team)[0]).id;
          }
        }
        // AI 补齐
        for (const team of ['monkey', 'timor']) {
          let need = CFG.teamSize - [...room.players.values()].filter(p => p.team === team).length;
          while (need-- > 0) {
            const pool = heroPool(team).filter(h => ![...room.players.values()].some(q => q.hero === h.id));
            const h = pool.length ? pool[Math.floor(Math.random() * pool.length)] : heroPool(team)[0];
            mkBot(room, team, h.id);
          }
        }
        startMatch(room);
        break;
      }
      case 'input': {
        if (!me.alive || !room.game) return;
        const g = room.game;
        // 速度校验
        const dt = Math.min(0.3, Math.max(0.01, (g.now - (me.lastInputAt || g.now - 0.05)) ));
        me.lastInputAt = g.now;
        const maxD = speedOf(me, g.now) * dt * (FAST ? 30 : 2.2) + 0.5;
        let nx = +msg.x || 0, nz = +msg.z || 0;
        if (Math.hypot(nx - me.x, nz - me.z) > maxD) {
          const d = Math.hypot(nx - me.x, nz - me.z);
          nx = me.x + (nx - me.x) / d * maxD; nz = me.z + (nz - me.z) / d * maxD;
        }
        // 准备阶段空气墙：进攻方 z>2，防守方 z<-2
        if (g.phase === 'prep') {
          const att = attackingTeam(room);
          if (me.team === att) nz = Math.max(2, nz); else nz = Math.min(-2, nz);
        }
        const c = collideCircle(nx, nz, 0.45);
        me.x = c.x; me.z = c.z;
        me.y = Math.max(0, Math.min(8, +msg.y || 0));
        me.ry = +msg.ry || 0;
        break;
      }
      case 'shoot': handleShoot(room, me, msg); break;
      case 'skill': handleSkill(room, me, msg); break;
      case 'interact': {
        if (!me.alive || !room.game) return;
        const g = room.game;
        if (msg.hold) {
          if (g.phase === 'combat' && me.hasBomb && !g.bomb.planted) me.plantHold = CFG.plant;
          else if (g.bomb.planted && me.team !== attackingTeam(room)) me.defuseHold = CFG.defuse;
        } else { me.plantHold = 0; me.defuseHold = 0; }
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').slice(0, 100);
        if (text.trim()) broadcast(room, { t: 'chat', name: me.name, team: me.team, text });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.players.delete(id);
    if (room.host === id) {
      const next = [...room.players.values()].find(p => !p.bot);
      room.host = next ? next.id : null;
    }
    if (room.players.size === 0 || ![...room.players.values()].some(p => !p.bot)) {
      rooms.delete(room.code); // 无真人，销毁房间
      return;
    }
    if (room.phase === 'lobby') broadcast(room, lobbyState(room));
    else if (room.game) {
      broadcast(room, { t: 'chat', sys: true, text: `${me.name} 断线，由 AI 接管` });
      // 简化：直接移除，回合胜利判定会自然处理
      checkRoundWin(room);
    }
  });
});

function sendWs(obj, ws) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// 所有进行中的房间共用一个主循环
setInterval(() => {
  for (const room of rooms.values()) if (room.phase === 'game') gameTick(room);
}, TICK * 1000);

server.listen(PORT, () => {
  console.log(`\n🐵 应猴传说：高塘爆破战 服务器已启动 (FAST=${FAST ? 'ON' : 'off'})`);
  console.log(`   本机访问:   http://localhost:${PORT}`);
  for (const name of Object.keys(os.networkInterfaces())) {
    for (const net of os.networkInterfaces()[name] || []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`   局域网分享: http://${net.address}:${PORT}  <-- 发给同一 Wi-Fi 下的同学`);
    }
  }
  console.log('');
});







