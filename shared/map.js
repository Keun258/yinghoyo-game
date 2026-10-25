// 高塘爆破图 — 服务器与客户端共享（坐标：X 东西，Z 南北；北=-Z 为防守方半场）
const B = (x, z, w, d, h = 4) => ({ x, z, w, d, h });      // 建筑
const C = (x, z) => ({ x, z, w: 2, d: 2, h: 1.2 });        // 矮箱掩体

export const MAP = {
  SIZE: 40, // 半边长，地面 80x80
  walls: [
    B(0, -41, 84, 2, 5), B(0, 41, 84, 2, 5), B(-41, 0, 2, 84, 5), B(41, 0, 2, 84, 5), // 围墙
    B(0, -2, 8, 10),        // 中路主楼
    B(-14, 8, 10, 6), B(14, 8, 10, 6),   // 两侧中场楼
    B(-22, -4, 6, 6), B(22, -4, 6, 6),   // A/B 点前楼
    B(-10, -22, 8, 5), B(10, -22, 8, 5), // 防守方前场楼
    B(0, -28, 6, 4),         // 防守出生点前掩体楼
    B(-30, 14, 6, 8), B(30, 14, 6, 8),   // 进攻方两侧楼
    B(0, 18, 10, 5),         // 进攻方中路掩体楼
    B(-32, -14, 5, 10), B(32, -14, 5, 10), // A/B 点外侧翼墙
    // 矮箱
    C(-25, -18), C(-19, -13), C(25, -18), C(19, -13),
    C(0, -12), C(-6, 26), C(6, 26), C(-22, -30), C(22, -30),
    C(-12, -8), C(12, -8),
  ],
  sites: {
    A: { x: -22, z: -16, hw: 6, hd: 5, name: 'A点 · 帝汶岛蚊巢' },
    B: { x: 22, z: -16, hw: 6, hd: 5, name: 'B点 · 搏击操能量核心' },
  },
  spawns: {
    att: [{ x: 0, z: 34 }, { x: -4, z: 33 }, { x: 4, z: 33 }],
    def: [{ x: 0, z: -34 }, { x: -4, z: -33 }, { x: 4, z: -33 }],
  },
  // 寻路路点（AI 用 BFS 导航）
  nodes: [
    { x: 0, z: 34 },      // 0 进攻出生
    { x: -22, z: 30 }, { x: 22, z: 30 },           // 1,2 南侧两翼
    { x: -8, z: 18 }, { x: 8, z: 18 },             // 3,4 中场南入口
    { x: -28, z: 8 }, { x: 28, z: 8 },             // 5,6 西侧/东侧走廊
    { x: -8, z: 0 }, { x: 8, z: 0 },               // 7,8 中路两侧
    { x: -28, z: -12 }, { x: 28, z: -12 },         // 9,10 A/B 外侧接近
    { x: -22, z: -16 }, { x: 22, z: -16 },         // 11,12 A/B 包点
    { x: -15, z: -12 }, { x: 15, z: -12 },         // 13,14 A/B 内侧接近
    { x: 0, z: -14 },                              // 15 中北路
    { x: 0, z: -22 },                              // 16 防守前场中
    { x: -22, z: -27 }, { x: 22, z: -27 },         // 17,18 A/B 后方
    { x: 0, z: -34 },                              // 19 防守出生
    { x: -22, z: 12 }, { x: 22, z: 12 },           // 20,21 西南/东南
    { x: 0, z: 26 },                               // 22 南中路
  ],
  edges: [
    [0, 22], [0, 1], [0, 2], [22, 3], [22, 4], [1, 20], [2, 21],
    [20, 5], [21, 6], [3, 7], [4, 8], [3, 20], [4, 21],
    [5, 9], [6, 10], [7, 13], [8, 14], [7, 15], [8, 15],
    [9, 11], [13, 11], [10, 12], [14, 12], [15, 16], [15, 13], [15, 14],
    [11, 17], [12, 18], [16, 17], [16, 18], [17, 19], [18, 19], [16, 19],
    [1, 22], [2, 22], [20, 22], [21, 22], [5, 20], [6, 21],
  ],
};

// ---------- 碰撞与射线（纯函数，双端共用）----------
export function collideCircle(px, pz, r) {
  let x = Math.max(-MAP.SIZE + r, Math.min(MAP.SIZE - r, px));
  let z = Math.max(-MAP.SIZE + r, Math.min(MAP.SIZE - r, pz));
  for (const wl of MAP.walls) {
    const hw = wl.w / 2, hd = wl.d / 2;
    const cx = Math.max(wl.x - hw, Math.min(wl.x + hw, x));
    const cz = Math.max(wl.z - hd, Math.min(wl.z + hd, z));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 === 0) { // 圆心在墙内，往最近边推
        const pushW = hw + r - Math.abs(x - wl.x), pushD = hd + r - Math.abs(z - wl.z);
        if (pushW < pushD) x = wl.x + Math.sign(x - wl.x || 1) * (hw + r);
        else z = wl.z + Math.sign(z - wl.z || 1) * (hd + r);
      } else {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r; z = cz + (dz / d) * r;
      }
    }
  }
  return { x, z };
}

// 3D 射线 vs 所有墙体（AABB slab），返回最近距离或 null
export function rayVsWalls(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = null;
  for (const wl of MAP.walls) {
    const minX = wl.x - wl.w / 2, maxX = wl.x + wl.w / 2;
    const minZ = wl.z - wl.d / 2, maxZ = wl.z + wl.d / 2;
    const minY = 0, maxY = wl.h;
    let tmin = 0, tmax = maxDist;
    for (const [o, d, mn, mx] of [[ox, dx, minX, maxX], [oy, dy, minY, maxY], [oz, dz, minZ, maxZ]]) {
      if (Math.abs(d) < 1e-8) { if (o < mn || o > mx) { tmin = 1; tmax = 0; break; } continue; }
      let t1 = (mn - o) / d, t2 = (mx - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    }
    if (tmax >= tmin && tmin > 0 && tmin < maxDist && (best === null || tmin < best)) best = tmin;
  }
  return best;
}

// 视线检查：两点间是否有墙挡住（高度 eyeH 处）
export function hasLOS(x1, z1, x2, z2, eyeH = 1.5) {
  const dx = x2 - x1, dz = z2 - z1;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.01) return true;
  return rayVsWalls(x1, eyeH, z1, dx / dist, 0, dz / dist, dist) === null;
}

// BFS 寻路
const ADJ = MAP.nodes.map(() => []);
for (const [a, b] of MAP.edges) { ADJ[a].push(b); ADJ[b].push(a); }

export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  MAP.nodes.forEach((n, i) => {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

export function findPath(fromX, fromZ, toX, toZ) {
  const start = nearestNode(fromX, fromZ), goal = nearestNode(toX, toZ);
  const prev = new Array(MAP.nodes.length).fill(-1);
  const q = [start]; prev[start] = start;
  while (q.length) {
    const cur = q.shift();
    if (cur === goal) break;
    for (const nb of ADJ[cur]) if (prev[nb] === -1) { prev[nb] = cur; q.push(nb); }
  }
  if (prev[goal] === -1) return [{ x: toX, z: toZ }];
  const path = [];
  for (let n = goal; n !== start; n = prev[n]) path.unshift({ x: MAP.nodes[n].x, z: MAP.nodes[n].z });
  path.push({ x: toX, z: toZ });
  return path;
}

export function inSite(x, z, site) {
  return Math.abs(x - site.x) <= site.hw && Math.abs(z - site.z) <= site.hd;
}
