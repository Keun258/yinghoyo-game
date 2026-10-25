// 观战系统测试：比赛中途加入 → 观战 → 收快照 → 聊天互通 → 比赛结束自动回大厅转正
import WebSocket from 'ws';
const url = 'ws://localhost:3000';
let fails = 0;
const check = (cond, label) => { console.log((cond ? '✅' : '❌') + ' ' + label); if (!cond) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mkClient(name) {
  const c = { name, ws: new WebSocket(url), msgs: [], snaps: [], id: null, code: null };
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'snap') c.snaps.push(m);
    if (m.t === 'joined' || m.t === 'spectate_join') { c.id = m.id; c.code = m.code; }
  });
  return new Promise(r => c.ws.on('open', () => r(c)));
}
const send = (c, o) => c.ws.send(JSON.stringify(o));

const a = await mkClient('房主');
send(a, { t: 'create', name: '房主' });
await sleep(300);
send(a, { t: 'side', side: 'monkey' });
await sleep(150);
send(a, { t: 'hero', hero: 'yinghao' });
await sleep(150);
send(a, { t: 'start' });
await sleep(3000); // 比赛已进入 combat 阶段

// 观战者中途加入
const s = await mkClient('吃瓜群众');
send(s, { t: 'join', code: a.code, name: '吃瓜群众' });
await sleep(500);
check(s.msgs.some(m => m.t === 'spectate_join'), '中途加入收到观战模式');
check(s.snaps.length > 0, `观战者收到比赛快照 ${s.snaps.length} 帧`);
check(s.snaps.at(-1).players.every(p => p.hero), '快照中无观战者占位');

// 聊天互通
send(s, { t: 'chat', text: '加油加油' });
await sleep(300);
check(a.msgs.some(m => m.t === 'chat' && m.text === '加油加油'), '观战者聊天玩家可见');

// 观战者不能影响比赛（不带包、不算人头）
check(!s.snaps.at(-1).players.some(p => p.name === '吃瓜群众'), '观战者不出现在战局中');

// 比赛结束 → 观战者收到大厅广播并转正
const t0 = Date.now();
let lobby = null;
while (Date.now() - t0 < 150000) {
  lobby = s.msgs.find(m => m.t === 'lobby');
  if (lobby) break;
  await sleep(500);
}
check(!!lobby, '比赛结束后观战者收到大厅');
check(lobby && lobby.players.some(p => p.name === '吃瓜群众' && !p.spectator), '观战者已转正为大厅玩家');
// 转正后可以选边
send(s, { t: 'side', side: 'timor' });
await sleep(300);
const lob2 = s.msgs.filter(m => m.t === 'lobby').pop();
check(lob2.players.find(p => p.name === '吃瓜群众')?.team === 'timor', '转正后可选阵营');

console.log(fails === 0 ? '\n🎉 观战测试通过' : `\n💥 ${fails} 项失败`);
process.exit(fails ? 1 : 0);
