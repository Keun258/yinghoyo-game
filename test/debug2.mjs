import WebSocket from 'ws';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const c = { ws: new WebSocket('ws://localhost:3000'), msgs: [], self: null, id: null, code: null };
const d = { ws: new WebSocket('ws://localhost:3000'), msgs: [], self: null, id: null };
for (const cl of [c, d]) cl.ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  cl.msgs.push(m);
  if (m.t === 'snap') cl.self = m.players.find(p => p.id === cl.id);
  if (m.t === 'joined') { cl.id = m.id; cl.code = m.code; }
});
await new Promise(r => c.ws.on('open', r));
await new Promise(r => d.ws.on('open', r));
c.ws.send(JSON.stringify({ t: 'create', name: '射手' })); await sleep(300);
d.ws.send(JSON.stringify({ t: 'join', code: c.code, name: '靶子' })); await sleep(300);
c.ws.send(JSON.stringify({ t: 'side', side: 'monkey' }));
d.ws.send(JSON.stringify({ t: 'side', side: 'timor' })); await sleep(150);
c.ws.send(JSON.stringify({ t: 'hero', hero: 'wangchengxue' }));
d.ws.send(JSON.stringify({ t: 'hero', hero: 'dadiwen' })); await sleep(150);
c.ws.send(JSON.stringify({ t: 'start' })); await sleep(2600);
async function walkTo(cl, x, z) {
  while (true) {
    if (!cl.self) { await sleep(80); continue; }
    const dx = x - cl.self.x, dz = z - cl.self.z;
    if (Math.hypot(dx, dz) < 0.8) return;
    cl.ws.send(JSON.stringify({ t: 'input', x: cl.self.x + dx * 0.3, y: 0, z: cl.self.z + dz * 0.3, ry: Math.atan2(dx, dz) }));
    await sleep(60);
  }
}
await walkTo(c, -28, 8);
await walkTo(d, -28, -12);
console.log('就位', c.self.x.toFixed(1), c.self.z.toFixed(1), '|', d.self.x.toFixed(1), d.self.z.toFixed(1));
for (let i = 0; i < 5; i++) {
  const s = c.self, t = d.self;
  const dd = { x: t.x - s.x, y: -0.3, z: t.z - s.z - 3.4 };
  const ll = Math.hypot(dd.x, dd.y, dd.z);
  const before = c.msgs.filter(m => m.t === 'shot').length;
  c.ws.send(JSON.stringify({ t: 'shoot', ox: s.x, oy: 1.9, oz: s.z + 3.4, dx: dd.x / ll, dy: dd.y / ll, dz: dd.z / ll }));
  await sleep(950);
  const shots = c.msgs.filter(m => m.t === 'shot').length;
  console.log(`第${i + 1}枪: 曳光广播${shots > before ? '有' : '无'} 靶子HP=${d.self?.hp} alive=${d.self?.alive}`);
}
process.exit(0);
