// 命中判定测试 v2：西侧走廊无遮挡视线，验证相机偏移补偿
import WebSocket from 'ws';
const url = 'ws://localhost:3000';
let fails = 0;
const check = (cond, label) => { console.log((cond ? '✅' : '❌') + ' ' + label); if (!cond) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mkClient(name) {
  const c = { name, ws: new WebSocket(url), msgs: [], id: null, code: null, self: null };
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'snap') c.self = m.players.find(p => p.id === c.id);
    if (m.t === 'joined') { c.id = m.id; c.code = m.code; }
  });
  return new Promise(r => c.ws.on('open', () => r(c)));
}
const send = (c, o) => c.ws.send(JSON.stringify(o));
async function walkTo(c, x, z, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (!c.self) { await sleep(80); continue; }
    const dx = x - c.self.x, dz = z - c.self.z;
    if (Math.hypot(dx, dz) < 0.8) return true;
    send(c, { t: 'input', x: c.self.x + dx * 0.3, y: 0, z: c.self.z + dz * 0.3, ry: Math.atan2(dx, dz) });
    await sleep(60);
  }
  return false;
}

const a = await mkClient('射手');
send(a, { t: 'create', name: '射手' });
await sleep(300);
const b = await mkClient('靶子');
send(b, { t: 'join', code: a.code, name: '靶子' });
await sleep(300);
send(a, { t: 'side', side: 'monkey' });
send(b, { t: 'side', side: 'timor' });
await sleep(150);
send(a, { t: 'hero', hero: 'wangchengxue' });
send(b, { t: 'hero', hero: 'dadiwen' });
await sleep(150);
send(a, { t: 'start' });
await sleep(2600);

// 双方走到西走廊对枪位（x=-28 走廊无遮挡）
const okA = await walkTo(a, -28, 8);
const okB = await walkTo(b, -28, -12);
check(okA && okB, `就位: 射手(${a.self?.x.toFixed(1)},${a.self?.z.toFixed(1)}) 靶子(${b.self?.x.toFixed(1)},${b.self?.z.toFixed(1)})`);

// 相机在射手身后（+Z 方向 3.4m），准星指向靶子胸口
const s = a.self, t0 = b.self;
const cam = { x: s.x, y: 1.9, z: s.z + 3.4 };
const d = { x: t0.x - cam.x, y: 1.2 - cam.y, z: t0.z - cam.z };
const l = Math.hypot(d.x, d.y, d.z);
const hpBefore = b.self.hp;
send(a, { t: 'shoot', ox: cam.x, oy: cam.y, oz: cam.z, dx: d.x / l, dy: d.y / l, dz: d.z / l });
await sleep(400);
check(b.self.hp < hpBefore, `准星即所得：靶子血量 ${hpBefore} → ${b.self.hp}`);
check(a.msgs.some(m => m.t === 'hitmark'), '射手收到命中反馈');

for (let i = 0; i < 5 && b.self?.alive; i++) {
  const s2 = a.self, t2 = b.self;
  const dd = { x: t2.x - s2.x, y: -0.3, z: t2.z - s2.z - 3.4 };
  const ll = Math.hypot(dd.x, dd.y, dd.z);
  send(a, { t: 'shoot', ox: s2.x, oy: 1.9, oz: s2.z + 3.4, dx: dd.x / ll, dy: dd.y / ll, dz: dd.z / ll });
  await sleep(1100);
}
check(!b.self?.alive, '靶子被连续射击击杀');
check(a.msgs.some(m => m.t === 'kill'), '击杀播报');

console.log(fails === 0 ? '\n🎉 命中测试通过' : `\n💥 ${fails} 项失败`);
process.exit(fails ? 1 : 0);

