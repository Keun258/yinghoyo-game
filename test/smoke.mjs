// 协议级冒烟测试 v2：完整走通 下包→拆包→换边→比赛结束
import WebSocket from 'ws';
const url = 'ws://localhost:3000';
let fails = 0;
const log = [];
const check = (cond, label) => { log.push((cond ? '✅' : '❌') + ' ' + label); if (!cond) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mkClient(name) {
  const c = { name, ws: new WebSocket(url), msgs: [], snaps: [], id: null, code: null };
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'snap') { c.snaps.push(m); c.self = m.players.find(p => p.id === c.id); }
    if (m.t === 'joined') { c.id = m.id; c.code = m.code; }
  });
  return new Promise(r => c.ws.on('open', () => r(c)));
}
const send = (c, o) => c.ws.send(JSON.stringify(o));
const got = (c, t, pred) => c.msgs.some(m => m.t === t && (!pred || pred(m)));
const waitFor = async (c, t, timeout = 15000, pred) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const m = c.msgs.find(m => m.t === t && (!pred || pred(m)));
    if (m) return m;
    await sleep(200);
  }
  return null;
};
async function walkTo(c, x, z, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (!c.self) { await sleep(100); continue; }
    const dx = x - c.self.x, dz = z - c.self.z;
    if (Math.hypot(dx, dz) < 1) return true;
    send(c, { t: 'input', x: c.self.x + dx * 0.3, y: 0, z: c.self.z + dz * 0.3, ry: Math.atan2(dx, dz) });
    await sleep(60);
  }
  return false;
}

const a = await mkClient('甲方');
send(a, { t: 'create', name: '甲方' });
await sleep(300);
const b = await mkClient('乙方');
send(b, { t: 'join', code: a.code, name: '乙方' });
await sleep(300);
send(a, { t: 'side', side: 'monkey' });
send(b, { t: 'side', side: 'timor' });
await sleep(150);
send(a, { t: 'hero', hero: 'yinghao' });
send(b, { t: 'hero', hero: 'dadiwen' });
await sleep(150);
send(a, { t: 'start' });
await sleep(400);
check(got(a, 'match_start'), '比赛开始');
check(a.snaps.length > 3, '快照推送中');
check(a.snaps.at(-1).players.length === 4, 'AI 补齐 2v2');
check(a.snaps.at(-1).bomb.carrier === a.id, '甲方（猴子）携带播放器');

const arrived = await walkTo(a, -22, -16);
check(arrived, `甲方抵达 A 点 (${a.self?.x.toFixed(1)},${a.self?.z.toFixed(1)})`);
send(a, { t: 'interact', hold: true });
const planted = await waitFor(a, 'planted', 6000);
check(!!planted, '下包成功（搏击操播放中）');
send(a, { t: 'interact', hold: false });

if (planted) {
  const barr = await walkTo(b, planted.x, planted.z);
  check(barr, `乙方抵达包点 (${b.self?.x.toFixed(1)},${b.self?.z.toFixed(1)})`);
  send(b, { t: 'interact', hold: true });
  const re1 = await waitFor(a, 'round_end', 12000);
  send(b, { t: 'interact', hold: false });
  check(!!re1, `第1回合结束: winner=${re1?.winner} reason=${re1?.reason}`);
  check(re1?.reason === 'defuse', '拆包成功判定');
}

const matchEnd = await waitFor(a, 'match_end', 150000);
check(!!matchEnd, `比赛结束 winner=${matchEnd?.winner} 比分 ${matchEnd?.wins?.monkey}:${matchEnd?.wins?.timor}`);
if (matchEnd) {
  check(matchEnd.board.length === 4, '结算面板含全部玩家');
  check(matchEnd.wins[matchEnd.winner] === 2, '抢2局制正确');
  const rounds = a.msgs.filter(m => m.t === 'round_start').length;
  check(rounds >= 2, `进行了 ${rounds} 回合（换边已触发）`);
}

console.log(log.join('\n'));
console.log(fails === 0 ? '\n🎉 全部通过' : `\n💥 ${fails} 项失败`);
process.exit(fails ? 1 : 0);
